/* eslint-env mocha */
'use strict'

const expect = require('chai').expect
const { tokeniseSearchText, isCompoundWord } = require('../lib/components/state-resources/search/search-terms')

const SOLR_STRIP = /[_.!~*'()+:]/g

describe('search terms', () => {
  describe('isCompoundWord', () => {
    for (const word of ['FSC493/2024', 'AUD127/2026', 'FSC-00123', '2026-AFC-56', 'fsc493/2024', '14-20', 'Stoke-on-Trent', 'A1/2/3']) {
      it(`${word} is a compound word`, () => {
        expect(isCompoundWord(word)).to.eql(true)
      })
    }

    for (const word of ['2024', 'FSC493', 'B33 0LR', '/2024', 'FSC493/', 'FSC493//2024', 'FSC1/2"x', "Mary's", 'a_b']) {
      it(`${word} is not a compound word`, () => {
        expect(isCompoundWord(word)).to.eql(false)
      })
    }
  })

  describe('tokeniseSearchText', () => {
    it('flags compound words as phrases and keeps them whole', () => {
      expect(tokeniseSearchText('FSC493/2024 high-street flat', { stripPattern: SOLR_STRIP, hyphenToSpace: true })).to.eql([
        { term: 'FSC493/2024', phrase: true },
        { term: 'high-street', phrase: true },
        { term: 'flat', phrase: false }
      ])
    })

    it('cleans other words as before', () => {
      expect(tokeniseSearchText("  Mary's  St.  ", { stripPattern: SOLR_STRIP }).map(t => t.term)).to.eql(['Marys', 'St'])
    })

    it('ignores punctuation around a compound word', () => {
      expect(tokeniseSearchText('(FSC493/2024),', { stripPattern: SOLR_STRIP })).to.eql([{ term: 'FSC493/2024', phrase: true }])
    })

    it('returns nothing for empty, emoji-only or non-string input', () => {
      expect(tokeniseSearchText('   ', { stripPattern: SOLR_STRIP })).to.eql([])
      expect(tokeniseSearchText('🔥🚒', { stripPattern: SOLR_STRIP })).to.eql([])
      expect(tokeniseSearchText(undefined, { stripPattern: SOLR_STRIP })).to.eql([])
    })
  })
})
