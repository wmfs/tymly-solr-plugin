/* eslint-env mocha */
'use strict'

const expect = require('chai').expect
const buildStorageQuery = require('../lib/components/state-resources/search/build-storage-query')

const ROLES = ['tymlyTest_boss', '$authenticated']
const SEARCH_FIELDS = ['title', 'description', 'id', 'roles', 'domain', 'launches']

function filters (overrides = {}) {
  return {
    offset: 0,
    limit: 10,
    categoryRestriction: [],
    showActiveEventsOnly: false,
    ...overrides
  }
}

const build = (filterOverrides = {}, userRoles = ROLES, searchFields = SEARCH_FIELDS) =>
  buildStorageQuery({ filters: filters(filterOverrides), searchFields, userRoles })

describe('build Postgres (fallback) search query', () => {
  it('filters by role, with paging, all as parameters', () => {
    const { query, queryParams, countQuery, countParams } = build()

    expect(query).to.eql('select * from tymly.solr_data where (roles && $1::text[]) limit $2 offset $3')
    expect(queryParams).to.eql([ROLES, 10, 0])
    expect(countQuery).to.eql('select count(*) as total from tymly.solr_data where (roles && $1::text[])')
    expect(countParams).to.eql([ROLES])
  })

  it('searches the searchable columns for every word, using one parameter per word', () => {
    const { query, queryParams } = build({ query: 'High Street' })

    expect(query).to.include('(cast(title as text) ilike $1 and cast(title as text) ilike $2)')
    expect(query).to.include('(cast(description as text) ilike $1 and cast(description as text) ilike $2)')
    expect(query).to.not.include('cast(roles')
    expect(query).to.not.include('cast(launches')
    expect(queryParams.slice(0, 2)).to.eql(['%High%', '%Street%'])
  })

  it('adds domain, active event and category filters as parameters', () => {
    const { query, queryParams } = build({
      domain: 'search',
      showActiveEventsOnly: true,
      categoryRestriction: ['prevention', 'protection']
    })

    expect(query).to.eql(
      'select * from tymly.solr_data where (roles && $1::text[]) and (domain = $2) and (active_event = true) ' +
      'and (category = any($3::text[])) limit $4 offset $5'
    )
    expect(queryParams).to.eql([ROLES, 'search', ['prevention', 'protection'], 10, 0])
  })

  describe('injection attempts never reach the SQL text', () => {
    const attempts = [
      { name: 'domain', overrides: { domain: "x' or '1'='1" } },
      { name: 'domain with a statement', overrides: { domain: "x'; drop table tymly.solr_data; --" } },
      { name: 'category', overrides: { categoryRestriction: ["x' or '1'='1"] } }
    ]

    for (const { name, overrides } of attempts) {
      it(name, () => {
        const { query, countQuery, queryParams } = build(overrides)
        const value = Object.values(overrides)[0]

        expect(query).to.not.include("'")
        expect(countQuery).to.not.include("'")
        expect(queryParams).to.deep.include(value)
      })
    }

    it('search words are parameters, with % and _ treated literally', () => {
      const { query, queryParams } = build({ query: "50% o'brien x'or'1" })
      expect(query).to.not.include("'")
      // existing cleaning removes ' and _; % is escaped for ilike
      expect(queryParams.slice(0, 3)).to.eql(['%50\\%%', '%obrien%', '%xor1%'])
    })

    it('ignores search fields that are not plain column names', () => {
      const { query } = build({ query: 'x' }, ROLES, ['title', 'title) or (1=1', 'Bad-Name'])
      expect(query).to.include('cast(title as text)')
      expect(query).to.not.include('1=1')
      expect(query).to.not.include('Bad-Name')
    })
  })

  it('keeps compound words whole so they still match', () => {
    const { queryParams } = build({ query: 'FSC-00123 FSC493/2024 Stoke-on-Trent' })
    expect(queryParams.slice(0, 3)).to.eql(['%FSC-00123%', '%FSC493/2024%', '%Stoke-on-Trent%'])
  })

  it('never uses a negative limit or offset', () => {
    const { queryParams } = build({ limit: -1, offset: -10 })
    expect(queryParams.slice(-2)).to.eql([0, 0])
  })

  it('falls back to $authenticated if no roles are passed', () => {
    expect(build({}, []).queryParams[0]).to.eql(['$authenticated'])
  })
})
