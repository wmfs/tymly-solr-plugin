/* eslint-env mocha */

const expect = require('chai').expect
const process = require('process')
const parseRating = require('../lib/components/state-resources/search/parse-rating-filter')

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
  // application specific logging, throwing an error,%20OR%20other logic here
})

describe('search rating tests', function () {
  this.timeout(process.env.TIMEOUT || 5000)

  const tests = [
    {
      input: 3,
      expected: '%20AND%20rating:3',
      desc: 'Rating equals 3 (number)'
    },
    {
      input: '3',
      expected: '%20AND%20rating:3',
      desc: 'Rating equals 3 (string)'
    },
    {
      input: null,
      expected: '',
      desc: 'Rating is null'
    },
    {
      input: '',
      expected: '',
      desc: 'Rating is empty string'
    },
    {
      input: undefined,
      expected: '',
      desc: 'Rating is undefined'
    },
    {
      input: [0, 2],
      expected: '%20AND%20rating:[0%20TO%202]',
      desc: 'Rating is between 0 and 2 (numbers)'
    },
    {
      input: ['0', '2'],
      expected: '%20AND%20rating:[0%20TO%202]',
      desc: 'Rating is between 0 and 2 (strings)'
    },
    {
      input: ['a', 2],
      expected: '',
      desc: 'Array but invalid minimum'
    },
    {
      input: [0, null],
      expected: '',
      desc: 'Array but invalid maximum'
    },
    {
      input: [],
      expected: '',
      desc: 'Rating is empty array'
    }
  ]

  for (const { input, expected, desc } of tests) {
    it(`Search tags - ${desc}`, () => {
      const result = parseRating(input)
      expect(result).to.eql(expected)
    })
  }
})
