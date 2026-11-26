/* eslint-env mocha */

'use strict'

const expect = require('chai').expect
const buildSolrQuery = require('../lib/components/state-resources/search/build-solr-query')
const { loadRelevanceSettings } = require('../lib/components/state-resources/search/relevance')

// like a UK address blueprint: an area, a space, then the start of the second part (e.g. B75 7L)
const relevance = loadRelevanceSettings({
  postcodes: {
    prefixPatterns: [{ pattern: '\\b[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{0,2}\\b', flags: 'i', field: 'searchKeys', removeSpaces: true }]
  }
})
const q = text => buildSolrQuery.textQuery(text, relevance, []).q

describe('prefix patterns (e.g. partial postcodes)', () => {
  it('searches a partial postcode as "starts with", instead of as separate words', () => {
    expect(q('b75 7l')).to.eql('searchKeys:b757l*')
    expect(q('B75 7LA')).to.eql('searchKeys:b757la*')
  })

  it('keeps the other words, in place, and the clause counts as one word', () => {
    expect(q('sherifoot lane b75 7l')).to.eql('sherifoot lane searchKeys:b757l*')
    expect(q('b6 6nu aston')).to.eql('searchKeys:b66nu* aston')
  })

  it('leaves anything that isn\'t an area followed by the start of a second part', () => {
    expect(q('b75')).to.eql('b75')
    expect(q('a38 road')).to.eql('a38 road')
    expect(q('m6 junction 10')).to.eql('m6 junction 10')
    expect(q('FSC493/2024')).to.eql('"FSC493/2024"')
  })

  it('escapes the value, so a pattern can never add Solr syntax', () => {
    const loose = loadRelevanceSettings({ x: { prefixPatterns: [{ pattern: 'ab\\S+', field: 'searchKeys' }] } })
    expect(buildSolrQuery.textQuery('ab"):roles', loose, []).q).to.eql('searchKeys:ab\\"\\)\\:roles*')
  })

  it('no prefix patterns: unchanged', () => {
    expect(buildSolrQuery.textQuery('b75 7l', loadRelevanceSettings(), []).q).to.eql('b75 7l')
  })
})
