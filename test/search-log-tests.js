/* eslint-env mocha */

'use strict'

const expect = require('chai').expect
const { normaliseQuery, logSearch } = require('../lib/components/state-resources/search/search-log')
const validateClick = require('../lib/components/state-resources/log-search-click/validate-click')

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
    function mockClient () {
      const calls = []
      return {
        calls,
        query: async (sql, params) => {
          calls.push({ sql, params })
          return { rows: [{ id: 'log-1' }] }
        }
      }
    }

    it('inserts one parameterised row and returns its id', async () => {
      const client = mockClient()
      const id = await logSearch(client, {
        userId: 'jane',
        filters: { query: ' Hagrid ', domain: 'search', categoryRestriction: ['school'], offset: 10 },
        hitCount: '3',
        durationMs: 12.6
      })
      expect(id).to.equal('log-1')
      expect(client.calls).to.have.length(1)
      expect(client.calls[0].params).to.eql(['jane', 'hagrid', 'search', ['school'], 10, 3, 13])
      expect(client.calls[0].sql).to.not.include('Hagrid')
    })

    it('does not log a search with no text', async () => {
      const client = mockClient()
      const id = await logSearch(client, { userId: 'jane', filters: {}, hitCount: 24, durationMs: 1 })
      expect(id).to.equal(null)
      expect(client.calls).to.have.length(0)
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
})
