/* eslint-env mocha */

const expect = require('chai').expect
const process = require('process')
const parseRating = require('../lib/components/state-resources/search/parse-rating-filter')

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
  // application specific logging, throwing an error, or other logic here
})

describe('search rating tests', function () {
  this.timeout(process.env.TIMEOUT || 5000)

  const tests = [
    {
      input: 3,
      expected: 'rating:3',
      desc: 'Rating equals 3 (number)'
    },
    {
      input: '3',
      expected: 'rating:3',
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
      expected: 'rating:[0 TO 2]',
      desc: 'Rating is between 0 and 2 (numbers)'
    },
    {
      input: ['0', '2'],
      expected: 'rating:[0 TO 2]',
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
    },
    {
      input: '3 OR roles:*',
      expected: '',
      desc: 'Text after a number is rejected'
    },
    {
      input: ['0', '2] OR roles:[* TO *'],
      expected: '',
      desc: 'Text in a range is rejected'
    },
    {
      input: ' 4 ',
      expected: 'rating:4',
      desc: 'Rating string is re-serialised as a number'
    },
    {
      input: NaN,
      expected: '',
      desc: 'NaN is rejected'
    }
  ]

  for (const { input, expected, desc } of tests) {
    it(`Search tags - ${desc}`, () => {
      const result = parseRating(input)
      expect(result).to.eql(expected)
    })
  }
})
