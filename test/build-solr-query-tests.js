/* eslint-env mocha */
'use strict'

const expect = require('chai').expect
const querystring = require('querystring')
const buildSolrQuery = require('../lib/components/state-resources/search/build-solr-query')
const { escapeTerm, quoteValue } = require('../lib/components/state-resources/search/escape')
const { loadRelevanceSettings } = require('../lib/components/state-resources/search/relevance')

const ROLES = ['tymlyTest_boss', '$authenticated']
const ALLOWED_FIELDS = new Set(['id', 'title', 'description', 'modified', 'launches', 'score'])

function filters (overrides = {}) {
  return {
    orderBy: 'created desc',
    offset: 0,
    limit: 10,
    categoryRestriction: [],
    showActiveEventsOnly: false,
    showNonActiveEventsOnly: false,
    ...overrides
  }
}

function build ({ event = {}, filterOverrides = {}, userRoles = ROLES, relevance } = {}) {
  return buildSolrQuery({
    event,
    filters: filters(filterOverrides),
    userRoles,
    allowedFields: ALLOWED_FIELDS,
    relevance
  })
}

const searchFor = (query, options = {}) => build({ filterOverrides: { query }, ...options })

// The params object form-encoded, as the Solr client sends it
const sentToSolr = params => querystring.parse(querystring.stringify(params))

describe('build Solr query', () => {
  describe('escaping helpers', () => {
    it('escapes Lucene special characters in a search word', () => {
      expect(escapeTerm('ABC493/2024')).to.eql('ABC493\\/2024')
      expect(escapeTerm('a+b-c')).to.eql('a\\+b\\-c')
      expect(escapeTerm('x)OR(roles:*')).to.eql('x\\)OR\\(roles\\:\\*')
      expect(escapeTerm('"quoted"')).to.eql('\\"quoted\\"')
      expect(escapeTerm('a&&b||c')).to.eql('a\\&\\&b\\|\\|c')
    })

    it('lower-cases AND/OR/NOT typed as words so they are not operators', () => {
      expect(escapeTerm('AND')).to.eql('and')
      expect(escapeTerm('OR')).to.eql('or')
      expect(escapeTerm('NOT')).to.eql('not')
      expect(escapeTerm('Oregon')).to.eql('Oregon')
    })

    it('quotes a value and escapes quotes and backslashes inside it', () => {
      expect(quoteValue('search')).to.eql('"search"')
      expect(quoteValue('a"b\\c')).to.eql('"a\\"b\\\\c"')
    })
  })

  describe('basic query', () => {
    it('matches everything, filtered by the user\'s roles', () => {
      const params = build()
      expect(params.q).to.eql('*:*')
      expect(params.fq).to.eql(['roles:("tymlyTest_boss" OR "$authenticated")'])
      expect(params.sort).to.eql('created desc, id asc')
      expect(params.start).to.eql(0)
      expect(params.rows).to.eql(10)
      expect(params).to.not.have.property('fl')
    })

    it('falls back to $authenticated if no roles are passed', () => {
      expect(build({ userRoles: [] }).fq).to.eql(['roles:("$authenticated")'])
    })

    it('puts each filter in its own fq', () => {
      const params = build({
        filterOverrides: {
          domain: 'search',
          docType: 'test_audit',
          author: 'jim.smith',
          categoryRestriction: ['prevention', 'protection'],
          showActiveEventsOnly: true
        }
      })
      expect(params.fq).to.eql([
        'roles:("tymlyTest_boss" OR "$authenticated")',
        'domain:"search"',
        'docType:"test_audit"',
        'author:"jim.smith"',
        '{!tag=category}category:("prevention" OR "protection")',
        'activeEvent:true'
      ])
    })

    it('filters non-active events', () => {
      expect(build({ filterOverrides: { showNonActiveEventsOnly: true } }).fq).to.include('activeEvent:false')
    })

    it('asks for category and docType counts across all matches', () => {
      const params = build({ filterOverrides: { categoryRestriction: ['prevention'] } })
      expect(params.facet).to.eql('true')
      // the category facet ignores the category filter, so the other categories still have counts
      expect(params['facet.field']).to.eql(['{!ex=category}category', 'docType'])
    })

    it('without search text: no eDisMax, no highlighting, the chosen sort', () => {
      const params = build()
      expect(params).to.not.have.property('defType')
      expect(params).to.not.have.property('hl')
      expect(params.sort).to.eql('created desc, id asc')
    })

    it('adds nothing to search for with an empty or emoji-only query', () => {
      expect(searchFor('   ').q).to.eql('*:*')
      expect(searchFor('🔥🚒').q).to.eql('*:*')
    })
  })

  describe('search text (eDisMax)', () => {
    it('ranks matches with eDisMax and the default relevance settings', () => {
      const params = searchFor('High Street')
      expect(params.q).to.eql('High Street')
      expect(params.defType).to.eql('edismax')
      expect(params.qf).to.eql('title^2 searchText searchPrefix^0.5 searchShingle^0.5 searchKeys^3')
      expect(params.pf).to.eql('title^3 description^2')
      expect(params.mm).to.eql('2<-1 5<75%')
      expect(params.sow).to.eql('true')
      expect(params.hl).to.eql('true')
      expect(params['hl.fl']).to.eql('title,description')
    })

    it('search text is never a filter, so it cannot change which records a user may see', () => {
      expect(searchFor('High Street').fq).to.eql(['roles:("tymlyTest_boss" OR "$authenticated")'])
    })

    it('allows two other words between phrase words (ps), and HTML-escapes highlights', () => {
      const params = searchFor('The Bull and Gate')
      expect(params.ps).to.eql('2')
      expect(params['hl.encoder']).to.eql('html')
    })

    it('sorts by best match first, then by the chosen sort', () => {
      expect(searchFor('High Street').sort).to.eql('score desc, created desc, id asc')
      expect(build({ filterOverrides: { query: 'x', orderBy: 'rating desc' } }).sort).to.eql('score desc, rating desc, id asc')
      expect(build({ filterOverrides: { query: 'x', orderBy: 'score desc' } }).sort).to.eql('score desc, id asc')
    })

    it('keeps apostrophes and ordinary punctuation', () => {
      expect(searchFor("  Ada's  St.  ").q).to.eql("Ada's St.")
    })

    it('escapes characters with a meaning in Lucene syntax', () => {
      expect(searchFor('price^2 kebab] (x) a:b').q).to.eql('price\\^2 kebab\\] \\(x\\) a\\:b')
    })

    it('still turns a hyphen into a space when the word is not a compound word', () => {
      expect(searchFor('Road- -Name').q).to.eql('Road Name')
    })

    it('leaves out stopwords', () => {
      expect(searchFor('The Bull and Gate').q).to.eql('Bull Gate')
    })

    it('keeps stopwords when they are all the user typed', () => {
      expect(searchFor('the and').q).to.eql('the and')
    })

    it('boosts a record whose docId is exactly the search text', () => {
      expect(searchFor(' 90034567890 ').bq).to.eql(['docId:"90034567890"^10'])
      expect(searchFor('x"y').bq).to.eql(['docId:"x\\"y"^10'])
    })

    it('boosts values found by a blueprint boost pattern', () => {
      const relevance = loadRelevanceSettings({
        postcodes: {
          boostPatterns: [{ pattern: '\\b[A-Z]{1,2}[0-9][A-Z0-9]? ?[0-9][A-Z]{2}\\b', flags: 'i', field: 'additionalTerms', boost: 5, removeSpaces: true }]
        }
      })
      expect(searchFor('zz9 0td', { relevance }).bq).to.eql([
        'docId:"zz9 0td"^10',
        'additionalTerms:"zz90td"^5'
      ])
      expect(searchFor('Adas Exampleton ZZ23AY', { relevance }).bq).to.include('additionalTerms:"ZZ23AY"^5')
      expect(searchFor('High Street', { relevance }).bq).to.have.length(1)
    })

    it('blueprint stopwords are left out too', () => {
      const relevance = loadRelevanceSettings({ companies: { stopwords: ['Ltd'] } })
      expect(searchFor('Acme Ltd', { relevance }).q).to.eql('Acme')
    })
  })

  describe('compound words such as references', () => {
    it('searches a compound word as a phrase, not as separate words', () => {
      expect(searchFor('ABC493/2024').q).to.eql('"ABC493/2024"')
    })

    it('works for any format, not just Tymly references', () => {
      for (const ref of ['XYZ127/2026', 'XYZ-00123', '2026-ABC-56', 'abc45/2024']) {
        expect(searchFor(ref).q).to.eql(`"${ref}"`)
      }
    })

    it('combines a compound word with other words', () => {
      expect(searchFor('ABC493/2024 Smith').q).to.eql('"ABC493/2024" Smith')
    })

    it('ignores punctuation around a compound word', () => {
      expect(searchFor('(ABC493/2024),').q).to.eql('"ABC493/2024"')
    })

    it('searches hyphenated place names and number ranges as phrases too', () => {
      expect(searchFor('Upton-on-Sea').q).to.eql('"Upton-on-Sea"')
      expect(searchFor('14-20 Overfield Road').q).to.eql('"14-20" Overfield Road')
    })

    it('a compound-looking word with quotes is escaped normally, not quoted', () => {
      expect(searchFor('ABC1/2"x').q).to.eql('ABC1\\/2\\"x')
    })
  })

  describe('injection attempts', () => {
    const attempts = [
      { name: 'extra URL parameter in domain', overrides: { domain: 'search&rows=100000&fq=*:*' } },
      { name: 'boolean clause in domain', overrides: { domain: 'x OR roles:*' } },
      { name: 'closing quote in docType', overrides: { docType: 'x" OR roles:"*' } },
      { name: 'parentheses in author', overrides: { author: 'x) OR (*:*' } },
      { name: 'clause in a category', overrides: { categoryRestriction: ['x") OR (roles:*'] } }
    ]

    for (const { name, overrides } of attempts) {
      it(`${name}: stays inside one quoted value and the role filter is unchanged`, () => {
        const sent = sentToSolr(build({ filterOverrides: overrides }))

        // still exactly one q, one sort, one rows - nothing added by the input
        expect(sent.q).to.eql('*:*')
        expect(sent.rows).to.eql('10')
        expect(sent.sort).to.eql('created desc, id asc')

        // the role filter is still the first fq and identical to a normal search
        expect(sent.fq[0]).to.eql('roles:("tymlyTest_boss" OR "$authenticated")')

        // the injected value appears only inside escaped quotes
        const value = Object.values(overrides)[0]
        const raw = Array.isArray(value) ? value[0] : value
        expect(sent.fq.join('\n')).to.include(quoteValue(raw))
      })
    }

    it('a search word cannot add a clause or a parameter', () => {
      const sent = sentToSolr(build({ filterOverrides: { query: 'a&rows=9999 x"]OR[roles/{} OR *:* {!lucene}' } }))
      expect(sent.rows).to.eql('10')
      // one fq, so querystring gives a string rather than an array
      expect(sent.fq).to.eql('roles:("tymlyTest_boss" OR "$authenticated")')
      expect(sent.q).to.eql('a\\&rows=9999 x\\"\\]OR\\[roles\\/\\{\\} or \\*\\:\\* \\{\\!lucene\\}')
    })

    it('a tag cannot close its quotes', () => {
      const sent = sentToSolr(build({ event: { tags: ['x") OR roles:("$everyone'] } }))
      expect(sent.fq).to.include('tags:("x\\") OR roles:(\\"$everyone")')
    })

    it('a rating that is not a number is ignored', () => {
      expect(build({ event: { rating: '3 OR roles:*' } }).fq).to.have.length(1)
    })
  })

  describe('sort', () => {
    it('allows known fields with asc/desc', () => {
      expect(build({ filterOverrides: { orderBy: 'rating desc' } }).sort).to.eql('rating desc, id asc')
      expect(build({ filterOverrides: { orderBy: 'modified ASC' } }).sort).to.eql('modified asc, id asc')
      expect(build({ filterOverrides: { orderBy: 'rating desc, created asc' } }).sort).to.eql('rating desc, created asc, id asc')
    })

    it('falls back to created desc for anything else', () => {
      for (const orderBy of ['title asc', 'created', 'created desc&rows=1000', 'roles desc', 'created sideways', '', undefined]) {
        expect(build({ filterOverrides: { orderBy } }).sort, String(orderBy)).to.eql('created desc, id asc')
      }
    })
  })

  describe('fields (fl)', () => {
    it('keeps fields in the schema and drops the rest', () => {
      const params = build({ event: { fields: ['title', 'description', 'secret&wt=xml', 'roles'] } })
      expect(params.fl).to.eql('title,description')
    })

    it('omits fl when no requested field is allowed', () => {
      expect(build({ event: { fields: ['nope'] } })).to.not.have.property('fl')
    })
  })

  describe('eventTimestamp', () => {
    it('accepts an ISO date range', () => {
      const params = build({ event: { eventTimestamp: '2026-11-20T00:00:00Z TO 2026-11-20T23:59:59Z' } })
      expect(params.fq).to.include('eventTimestamp:[2026-11-20T00:00:00Z TO 2026-11-20T23:59:59Z]')
    })

    it('accepts a range that a caller has already URL-encoded', () => {
      const params = build({ event: { eventTimestamp: '2026-11-20T00:00:00Z%20TO%202026-11-20T23:59:59Z' } })
      expect(params.fq).to.include('eventTimestamp:[2026-11-20T00:00:00Z TO 2026-11-20T23:59:59Z]')
    })

    it('accepts date maths', () => {
      const params = build({ event: { eventTimestamp: 'NOW/DAY-7DAYS TO NOW' } })
      expect(params.fq).to.include('eventTimestamp:[NOW/DAY-7DAYS TO NOW]')
    })

    it('rejects anything else', () => {
      for (const eventTimestamp of ['* TO *] OR roles:[* TO *', 'yesterday', '2026-11-20 TO 2026-11-21', 'NOW TO NOW&rows=1']) {
        expect(() => build({ event: { eventTimestamp } }), eventTimestamp).to.throw('Invalid eventTimestamp')
      }
    })
  })

  describe('location', () => {
    it('adds a geofilt filter and sorts by distance', () => {
      const params = build({ event: { location: { lat: 52.48, lng: -1.89 } } })
      expect(params.fq).to.include('{!geofilt d=1}')
      expect(params.sfield).to.eql('point')
      expect(params.pt).to.eql('52.48,-1.89')
      expect(params.sort).to.eql('geodist() asc, id asc')
    })

    it('rejects a location that is not two numbers in range', () => {
      for (const location of [{ lat: 'x', lng: 1 }, { lat: 91, lng: 0 }, { lat: 0, lng: '1&rows=9' }]) {
        expect(() => build({ event: { location } })).to.throw('Invalid location')
      }
    })
  })

  describe('paging', () => {
    it('never sends a negative start or rows', () => {
      const params = build({ filterOverrides: { offset: -5, limit: -1 } })
      expect(params.start).to.eql(0)
      expect(params.rows).to.eql(0)
    })

    it('caps rows and start, so one search can\'t return everything', () => {
      const params = build({ filterOverrides: { offset: 1e9, limit: 100000 } })
      expect(params.rows).to.eql(buildSolrQuery.MAX_ROWS)
      expect(params.start).to.eql(buildSolrQuery.MAX_START)
      expect(build({ filterOverrides: { limit: 25 } }).rows).to.eql(25)
    })

    it('ends every sort with id, so tied records keep the same order between pages', () => {
      expect(build({ filterOverrides: { orderBy: 'id desc' } }).sort).to.eql('id desc')
      expect(build({ filterOverrides: { orderBy: 'rating desc, id asc' } }).sort).to.eql('rating desc, id asc')
    })
  })
})
