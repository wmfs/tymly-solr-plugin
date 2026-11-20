/* eslint-env mocha */

const expect = require('chai').expect
const process = require('process')
const parseTags = require('../lib/components/state-resources/search/parse-tags-filter')

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
  // application specific logging, throwing an error, or other logic here
})

describe('search tags tests', function () {
  this.timeout(process.env.TIMEOUT || 5000)

  const tests = [
    {
      input: ['NO_INCIDENT', 'Highgate (C01)'],
      expected: 'tags:("NO_INCIDENT" AND "Highgate (C01)")',
      desc: 'NO_INCIDENT AND Highgate (C01)'
    },
    {
      input: [['CANCELLED'], 'NO_INCIDENT', 'Highgate (C01)'],
      expected: 'tags:("CANCELLED" AND "NO_INCIDENT" AND "Highgate (C01)")',
      desc: 'CANCELLED AND NO_INCIDENT AND Highgate (C01)'
    },
    {
      input: ['NO_INCIDENT', 'Highgate (C01)', ['CANCELLED']],
      expected: 'tags:("NO_INCIDENT" AND "Highgate (C01)" AND "CANCELLED")',
      desc: 'NO_INCIDENT AND Highgate (C01) AND CANCELLED'
    },
    {
      input: [['CANCELLED', 'CONFIRMED'], 'NO_INCIDENT', 'Highgate (C01)'],
      expected: 'tags:(("CANCELLED" OR "CONFIRMED") AND "NO_INCIDENT" AND "Highgate (C01)")',
      desc: '(CANCELLED OR CONFIRMED) AND NO_INCIDENT AND Highgate (C01)'
    },
    {
      input: ['NO_INCIDENT', 'Highgate (C01)', ['CANCELLED', 'CONFIRMED']],
      expected: 'tags:("NO_INCIDENT" AND "Highgate (C01)" AND ("CANCELLED" OR "CONFIRMED"))',
      desc: 'NO_INCIDENT AND Highgate (C01) AND (CANCELLED OR CONFIRMED)'
    },
    {
      input: [['CANCELLED', 'CONFIRMED']],
      expected: 'tags:(("CANCELLED" OR "CONFIRMED"))',
      desc: '(CANCELLED OR CONFIRMED)'
    },
    {
      input: [['CANCELLED', 'CONFIRMED'], ['NO_INCIDENT', 'Highgate (C01)']],
      expected: 'tags:(("CANCELLED" OR "CONFIRMED") AND ("NO_INCIDENT" OR "Highgate (C01)"))',
      desc: '(CANCELLED OR CONFIRMED) AND (NO_INCIDENT OR Highgate (C01))'
    },
    {
      input: ['He said "hi"', 'back\\slash'],
      expected: 'tags:("He said \\"hi\\"" AND "back\\\\slash")',
      desc: 'quotes and backslashes inside tags are escaped'
    },
    {
      input: ['x") OR roles:("$everyone'],
      expected: 'tags:("x\\") OR roles:(\\"$everyone")',
      desc: 'a tag cannot close the quotes and add its own clause'
    },
    {
      input: ['', [''], [], 'NO_INCIDENT'],
      expected: 'tags:("NO_INCIDENT")',
      desc: 'empty tags and empty groups are ignored'
    },
    {
      input: [],
      expected: '',
      desc: 'no tags gives no filter'
    },
    {
      input: undefined,
      expected: '',
      desc: 'undefined gives no filter'
    }
  ]

  for (const { input, expected, desc } of tests) {
    it(`Search tags - ${desc}`, () => {
      const tags = parseTags(input)
      expect(tags).to.eql(expected)
    })
  }
})
