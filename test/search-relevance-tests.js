/* eslint-env mocha */
'use strict'

const expect = require('chai').expect
const { DEFAULT_RELEVANCE, loadRelevanceSettings } = require('../lib/components/state-resources/search/relevance')
const { facetCounts } = require('../lib/components/state-resources/search')

describe('search relevance settings', () => {
  it('uses the plugin defaults when no blueprint has search-relevance components', () => {
    const relevance = loadRelevanceSettings(undefined)
    expect(relevance.qf).to.eql(DEFAULT_RELEVANCE.qf)
    expect([...relevance.stopwords]).to.eql(['and', 'of', 'the'])
    expect(relevance.boostPatterns).to.eql([])
  })

  it('adds every blueprint\'s stopwords, lower-cased', () => {
    const relevance = loadRelevanceSettings({
      one: { stopwords: ['Ltd', ' PLC '] },
      two: { stopwords: ['llp'] }
    })
    expect([...relevance.stopwords]).to.eql(['and', 'of', 'the', 'ltd', 'plc', 'llp'])
  })

  it('loads boost patterns', () => {
    const relevance = loadRelevanceSettings({
      codes: { boostPatterns: [{ pattern: '\\bAB\\d+\\b', flags: 'i', field: 'additionalTerms', boost: 5, removeSpaces: true }] }
    })
    const [bp] = relevance.boostPatterns
    expect(bp.field).to.eql('additionalTerms')
    expect(bp.boost).to.eql(5)
    expect(bp.removeSpaces).to.eql(true)
    expect('x ab12 AB34'.match(bp.regex)).to.eql(['ab12', 'AB34'])
  })

  it('skips invalid entries with a warning instead of failing', () => {
    const warnings = []
    const relevance = loadRelevanceSettings({
      bad: {
        stopwords: [3, ''],
        boostPatterns: [
          { pattern: '(', field: 'title', boost: 1 },
          { pattern: 'x', field: 'title:*', boost: 1 },
          { pattern: 'x', field: 'title', boost: 0 },
          { pattern: 'x', field: 'title', boost: '2' }
        ]
      },
      empty: null
    }, w => warnings.push(w))

    expect(relevance.boostPatterns).to.have.length(1)
    expect(relevance.boostPatterns[0].boost).to.eql(2)
    expect(warnings).to.have.length(5)
  })
})

describe('facet counts', () => {
  it('turns Solr\'s [value, count, ...] lists into objects', () => {
    expect(facetCounts({ facet_fields: { category: ['gazetteer', 12, 'audit', 3], docType: [] } })).to.eql({
      category: { gazetteer: 12, audit: 3 },
      docType: {}
    })
  })

  it('returns no facets when Solr sent none', () => {
    expect(facetCounts(undefined)).to.eql({})
  })
})
