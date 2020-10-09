/* eslint-env mocha */

const expect = require('chai').expect
const process = require('process')
const parseTags = require('../lib/components/state-resources/search/parse-tags-filter')

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
  // application specific logging, throwing an error,%20OR%20other logic here
})

describe('search tags tests', function () {
  this.timeout(process.env.TIMEOUT || 5000)

  const tests = [
    {
      input: ['NO_INCIDENT', 'Highgate (C01)'],
      expected: 'tags:("NO_INCIDENT"%20AND%20"Highgate%20(C01)")',
      desc: 'NO_INCIDENT AND Highgate (C01)'
    },
    {
      input: [['CANCELLED'], 'NO_INCIDENT', 'Highgate (C01)'],
      expected: 'tags:("CANCELLED"%20AND%20"NO_INCIDENT"%20AND%20"Highgate%20(C01)")',
      desc: 'CANCELLED AND NO_INCIDENT AND Highgate (C01)'
    },
    {
      input: ['NO_INCIDENT', 'Highgate (C01)', ['CANCELLED']],
      expected: 'tags:("NO_INCIDENT"%20AND%20"Highgate%20(C01)"%20AND%20"CANCELLED")',
      desc: 'NO_INCIDENT AND Highgate (C01) AND CANCELLED'
    },
    {
      input: [['CANCELLED', 'CONFIRMED'], 'NO_INCIDENT', 'Highgate (C01)'],
      expected: 'tags:(("CANCELLED"%20OR%20"CONFIRMED")%20AND%20"NO_INCIDENT"%20AND%20"Highgate%20(C01)")',
      desc: '(CANCELLED OR CONFIRMED) AND NO_INCIDENT AND Highgate (C01)'
    },
    {
      input: ['NO_INCIDENT', 'Highgate (C01)', ['CANCELLED', 'CONFIRMED']],
      expected: 'tags:("NO_INCIDENT"%20AND%20"Highgate%20(C01)"%20AND%20("CANCELLED"%20OR%20"CONFIRMED"))',
      desc: 'NO_INCIDENT AND Highgate (C01) AND (CANCELLED OR CONFIRMED)'
    },
    {
      input: [['CANCELLED', 'CONFIRMED']],
      expected: 'tags:(("CANCELLED"%20OR%20"CONFIRMED"))',
      desc: '(CANCELLED OR CONFIRMED)'
    },
    {
      input: [['CANCELLED', 'CONFIRMED'], ['NO_INCIDENT', 'Highgate (C01)']],
      expected: 'tags:(("CANCELLED"%20OR%20"CONFIRMED")%20AND%20("NO_INCIDENT"%20OR%20"Highgate%20(C01)"))',
      desc: '(CANCELLED OR CONFIRMED) AND (NO_INCIDENT OR Highgate (C01))'
    }
  ]

  for (const { input, expected, desc } of tests) {
    it(`Search tags - ${desc}`, () => {
      const tags = parseTags(input)
      expect(tags).to.eql('%20AND%20' + expected)
    })
  }
})
