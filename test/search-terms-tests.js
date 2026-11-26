/* eslint-env mocha */
'use strict'

const expect = require('chai').expect
const { tokeniseSearchText, isCompoundWord } = require('../lib/components/state-resources/search/search-terms')

const SOLR_STRIP = /[_.!~*'()+:]/g

describe('search terms', () => {
  describe('isCompoundWord', () => {
    for (const word of ['ABC493/2024', 'XYZ127/2026', 'XYZ-00123', '2026-ABC-56', 'abc493/2024', '14-20', 'Upton-on-Sea', 'A1/2/3']) {
      it(`${word} is a compound word`, () => {
        expect(isCompoundWord(word)).to.eql(true)
      })
    }

    for (const word of ['2024', 'ABC493', 'ZZ33 0LR', '/2024', 'ABC493/', 'ABC493//2024', 'ABC1/2"x', "Mary's", 'a_b']) {
      it(`${word} is not a compound word`, () => {
        expect(isCompoundWord(word)).to.eql(false)
      })
    }
  })

  describe('tokeniseSearchText', () => {
    it('flags compound words as phrases and keeps them whole', () => {
      expect(tokeniseSearchText('ABC493/2024 high-street flat', { stripPattern: SOLR_STRIP, hyphenToSpace: true })).to.eql([
        { term: 'ABC493/2024', phrase: true },
        { term: 'high-street', phrase: true },
        { term: 'flat', phrase: false }
      ])
    })

    it('cleans other words as before', () => {
      expect(tokeniseSearchText("  Mary's  St.  ", { stripPattern: SOLR_STRIP }).map(t => t.term)).to.eql(['Marys', 'St'])
    })

    it('ignores punctuation around a compound word', () => {
      expect(tokeniseSearchText('(ABC493/2024),', { stripPattern: SOLR_STRIP })).to.eql([{ term: 'ABC493/2024', phrase: true }])
    })

    it('returns nothing for empty, emoji-only or non-string input', () => {
      expect(tokeniseSearchText('   ', { stripPattern: SOLR_STRIP })).to.eql([])
      expect(tokeniseSearchText('🔥🚒', { stripPattern: SOLR_STRIP })).to.eql([])
      expect(tokeniseSearchText(undefined, { stripPattern: SOLR_STRIP })).to.eql([])
    })
  })
})
