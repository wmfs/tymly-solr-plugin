/* eslint-env mocha */

'use strict'

const expect = require('chai').expect
const { normaliseQuery, logSearch } = require('../lib/components/state-resources/search/search-log')
const validateClick = require('../lib/components/state-resources/log-search-click/validate-click')
const { parseRetentionDays } = require('../lib/components/services/search-analytics')

describe('search analytics helpers (sc-34389)', () => {
  describe('normaliseQuery', () => {
    const cases = [
      ['  Hagrid  ', 'hagrid'],
      ['14   Overfield\tRoad', '14 overfield road'],
      ['FSC493/2024', 'fsc493/2024'],
      ['', ''],
      ['   ', ''],
      [undefined, ''],
      [null, ''],
      [42, '']
    ]
    for (const [input, expected] of cases) {
      it(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
        expect(normaliseQuery(input)).to.equal(expected)
      })
    }

    it('caps the length at 500 characters', () => {
      expect(normaliseQuery('a'.repeat(600))).to.have.length(500)
    })
  })

  describe('logSearch', () => {
    function mockModel () {
      const created = []
      return {
        created,
        create: async (doc, options) => {
          created.push(doc)
          return { idProperties: { id: 'log-1' } }
        }
      }
    }

    it('creates one search_log row and returns its id', async () => {
      const model = mockModel()
      const id = await logSearch(model, {
        userId: 'jane',
        filters: { query: ' Hagrid ', domain: 'search', categoryRestriction: ['school'], offset: 10 },
        hitCount: '3',
        durationMs: 12.6
      })
      expect(id).to.equal('log-1')
      expect(model.created).to.eql([{
        userId: 'jane',
        query: 'hagrid',
        domain: 'search',
        categoryRestriction: ['school'],
        resultOffset: 10,
        hitCount: 3,
        durationMs: 13
      }])
    })

    it('logs a search with categories but no text', async () => {
      const model = mockModel()
      const id = await logSearch(model, { userId: 'jane', filters: { categoryRestriction: ['school'] }, hitCount: 24, durationMs: 1 })
      expect(id).to.equal('log-1')
      expect(model.created[0]).to.include({ query: '', hitCount: 24 })
      expect(model.created[0].categoryRestriction).to.eql(['school'])
    })

    it('does not log a search with no text and no categories', async () => {
      const model = mockModel()
      const id = await logSearch(model, { userId: 'jane', filters: {}, hitCount: 24, durationMs: 1 })
      expect(id).to.equal(null)
      expect(model.created).to.have.length(0)
    })
  })

  describe('validateClick', () => {
    const valid = {
      searchLogId: '6f1c2c1e-3b1a-11ef-9a2b-0242ac120002',
      docId: 'staff#1',
      position: 1
    }

    it('accepts a valid click', () => {
      expect(validateClick({ ...valid, docType: 'staff', stateMachineName: 'tymlyTest_boss_1_0' })).to.eql({
        ...valid,
        docType: 'staff',
        stateMachineName: 'tymlyTest_boss_1_0'
      })
    })

    it('optional fields default to null', () => {
      expect(validateClick(valid)).to.eql({ ...valid, docType: null, stateMachineName: null })
    })

    const invalid = {
      'no input': undefined,
      'searchLogId not a uuid': { ...valid, searchLogId: "x' or '1'='1" },
      'missing docId': { ...valid, docId: undefined },
      'empty docId': { ...valid, docId: '' },
      'position 0': { ...valid, position: 0 },
      'position as a string': { ...valid, position: '1' },
      'position not an integer': { ...valid, position: 1.5 },
      'docType not a string': { ...valid, docType: { a: 1 } },
      'stateMachineName too long': { ...valid, stateMachineName: 'x'.repeat(201) }
    }
    for (const [label, input] of Object.entries(invalid)) {
      it(`rejects: ${label}`, () => {
        expect(validateClick(input)).to.equal(null)
      })
    }
  })

  describe('parseRetentionDays', () => {
    const cases = [
      [undefined, 365],
      ['', 365],
      ['90', 90],
      [30, 30],
      ['0', 365],
      ['-5', 365],
      ['1.5', 365],
      ['forever', 365]
    ]
    for (const [input, expected] of cases) {
      it(`${JSON.stringify(input)} -> ${expected}`, () => {
        expect(parseRetentionDays(input)).to.equal(expected)
      })
    }
  })
})
