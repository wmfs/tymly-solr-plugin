/* eslint-env mocha */
'use strict'

const expect = require('chai').expect
const querystring = require('querystring')
const buildSolrQuery = require('../lib/components/state-resources/search/build-solr-query')
const { escapeTerm, quoteValue } = require('../lib/components/state-resources/search/escape')

const ROLES = ['tymlyTest_boss', '$authenticated']
const SEARCH_FIELDS = ['title', 'description', 'doc_id']
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

function build ({ event = {}, filterOverrides = {}, userRoles = ROLES } = {}) {
  return buildSolrQuery({
    event,
    filters: filters(filterOverrides),
    searchFields: SEARCH_FIELDS,
    userRoles,
    allowedFields: ALLOWED_FIELDS
  })
}

// What solr-client actually sends: the params object URL-encoded with querystring.stringify
const sentToSolr = params => querystring.parse(querystring.stringify(params))

describe('build Solr query', () => {
  describe('escaping helpers', () => {
    it('escapes Lucene special characters in a search word', () => {
      expect(escapeTerm('FSC493/2024')).to.eql('FSC493\\/2024')
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
      expect(params.sort).to.eql('created desc')
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
          docType: 'wmfs_audit',
          author: 'jim.smith',
          categoryRestriction: ['prevention', 'protection'],
          showActiveEventsOnly: true
        }
      })
      expect(params.fq).to.eql([
        'roles:("tymlyTest_boss" OR "$authenticated")',
        'domain:"search"',
        'docType:"wmfs_audit"',
        'author:"jim.smith"',
        'category:("prevention" OR "protection")',
        'activeEvent:true'
      ])
    })

    it('filters non-active events', () => {
      expect(build({ filterOverrides: { showNonActiveEventsOnly: true } }).fq).to.include('activeEvent:false')
    })

    it('searches every field for all the words', () => {
      const params = build({ filterOverrides: { query: 'High Street' } })
      expect(params.fq[1]).to.eql('(title:(High AND Street) OR description:(High AND Street) OR docId:(High AND Street))')
    })

    it('keeps the existing cleaning: strips some punctuation from ordinary words', () => {
      const params = build({ filterOverrides: { query: "  Mary's  St.  " } })
      expect(params.fq[1]).to.eql('(title:(Marys AND St) OR description:(Marys AND St) OR docId:(Marys AND St))')
    })

    it('still turns a hyphen into a space when the word is not a compound word', () => {
      const params = build({ filterOverrides: { query: 'Road- -Name' } })
      expect(params.fq[1]).to.include('title:(Road AND Name)')
    })

    it('escapes characters that used to break the query', () => {
      const params = build({ filterOverrides: { query: 'price^2' } })
      expect(params.fq[1]).to.eql('(title:(price\\^2) OR description:(price\\^2) OR docId:(price\\^2))')
    })

    it('adds no search filter for an empty or emoji-only query', () => {
      expect(build({ filterOverrides: { query: '   ' } }).fq).to.have.length(1)
      expect(build({ filterOverrides: { query: '🔥🚒' } }).fq).to.have.length(1)
    })
  })

  describe('compound words such as references (sc-34405)', () => {
    const searchFor = query => build({ filterOverrides: { query } }).fq[1]

    it('searches a compound word as a phrase, not as separate words', () => {
      expect(searchFor('FSC493/2024')).to.eql(
        '(title:("FSC493/2024") OR description:("FSC493/2024") OR docId:("FSC493/2024"))'
      )
    })

    it('works for any format, not just Tymly references', () => {
      expect(searchFor('AUD127/2026')).to.include('title:("AUD127/2026")')
      expect(searchFor('FSC-00123')).to.include('title:("FSC-00123")')
      expect(searchFor('2026-AFC-56')).to.include('title:("2026-AFC-56")')
      expect(searchFor('fsa45/2024')).to.include('title:("fsa45/2024")')
    })

    it('combines a compound word with other words', () => {
      expect(searchFor('FSC493/2024 Smith')).to.include('title:("FSC493/2024" AND Smith)')
    })

    it('ignores punctuation around a compound word', () => {
      expect(searchFor('(FSC493/2024),')).to.include('title:("FSC493/2024")')
    })

    it('searches hyphenated place names and number ranges as phrases too', () => {
      expect(searchFor('Stoke-on-Trent')).to.include('title:("Stoke-on-Trent")')
      expect(searchFor('14-20 Overfield Road')).to.include('title:("14-20" AND Overfield AND Road)')
    })

    it('a compound-looking word with quotes is escaped normally, not quoted', () => {
      expect(searchFor('FSC1/2"x')).to.include('title:(FSC1\\/2\\"x)')
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
        expect(sent.sort).to.eql('created desc')

        // the role filter is still the first fq and identical to a normal search
        expect(sent.fq[0]).to.eql('roles:("tymlyTest_boss" OR "$authenticated")')

        // the injected value appears only inside escaped quotes
        const value = Object.values(overrides)[0]
        const raw = Array.isArray(value) ? value[0] : value
        expect(sent.fq.join('\n')).to.include(quoteValue(raw))
      })
    }

    it('a search word cannot add a clause or a parameter', () => {
      // ( ) : * are stripped by the existing cleaning; the rest must be escaped
      const sent = sentToSolr(build({ filterOverrides: { query: 'a&rows=9999 x"]OR[roles/{}' } }))
      expect(sent.rows).to.eql('10')
      expect(sent.fq).to.have.length(2)
      expect(sent.fq[1]).to.include('a\\&rows=9999')
      expect(sent.fq[1]).to.include('x\\"\\]OR\\[roles\\/\\{\\}')
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
      expect(build({ filterOverrides: { orderBy: 'rating desc' } }).sort).to.eql('rating desc')
      expect(build({ filterOverrides: { orderBy: 'modified ASC' } }).sort).to.eql('modified asc')
      expect(build({ filterOverrides: { orderBy: 'rating desc, created asc' } }).sort).to.eql('rating desc, created asc')
    })

    it('falls back to created desc for anything else', () => {
      for (const orderBy of ['title asc', 'created', 'created desc&rows=1000', 'roles desc', 'created sideways', '', undefined]) {
        expect(build({ filterOverrides: { orderBy } }).sort, String(orderBy)).to.eql('created desc')
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
      expect(params.sort).to.eql('geodist() asc')
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
  })
})
