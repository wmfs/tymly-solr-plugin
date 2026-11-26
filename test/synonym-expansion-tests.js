/* eslint-env mocha */

'use strict'

const expect = require('chai').expect
const buildSolrQuery = require('../lib/components/state-resources/search/build-solr-query')
const { loadRelevanceSettings } = require('../lib/components/state-resources/search/relevance')

const GROUPS = [['saw', 'safe and well'], ['fsc', 'fire safety concern'], ['rd', 'road']]

function q (query, groups = GROUPS) {
  return buildSolrQuery.textQuery(query, loadRelevanceSettings(), groups).q
}

describe('synonym phrases are searched both ways', () => {
  it('the short form and the phrase give the same query', () => {
    expect(q('saw visit')).to.eql('(saw OR "safe and well") visit')
    expect(q('safe and well visit')).to.eql('(saw OR "safe and well") visit')
  })

  it('ignores case and punctuation round the words', () => {
    expect(q('Safe And Well, Smith')).to.eql('(saw OR "safe and well") Smith')
    expect(q('SAW')).to.eql('(saw OR "safe and well")')
  })

  it('works anywhere in the search, and for several groups', () => {
    expect(q('smith fsc saw')).to.eql('smith (fsc OR "fire safety concern") (saw OR "safe and well")')
    expect(q('fire safety concern 12 high street')).to.eql('(fsc OR "fire safety concern") 12 high street')
  })

  it('leaves single-word groups to Solr\'s own synonym list', () => {
    expect(q('station rd')).to.eql('station rd')
  })

  it('never matches inside a reference', () => {
    expect(q('SAW12/2024')).to.eql('"SAW12/2024"')
  })

  it('only matches the whole phrase', () => {
    expect(q('safe and sound')).to.eql('safe sound')
    expect(q('well safe')).to.eql('well safe')
  })

  it('no groups: unchanged', () => {
    expect(q('safe and well', [])).to.eql('safe well')
  })
})
