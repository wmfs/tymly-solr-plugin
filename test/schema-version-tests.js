/* eslint-env mocha */
'use strict'

const expect = require('chai').expect
const { PROPS, stableStringify, schemaHash, schemaSource, stampProps, describeStamp } = require('../solr/lib/schema-version')
const { loadWantedSchema } = require('../solr/apply-schema')

describe('Solr schema version stamp', () => {
  it('the same schema always gives the same version, whatever order its keys are in', () => {
    expect(stableStringify({ b: 1, a: [{ d: 2, c: 3 }] })).to.eql(stableStringify({ a: [{ c: 3, d: 2 }], b: 1 }))
    expect(schemaHash({ b: 1, a: 2 })).to.eql(schemaHash({ a: 2, b: 1 }))
  })

  it('any change to the schema gives a different version', () => {
    const schema = loadWantedSchema()
    const changed = JSON.parse(JSON.stringify(schema))
    changed.fields[0].stored = !changed.fields[0].stored
    expect(schemaHash(schema)).to.match(/^[0-9a-f]{12}$/)
    expect(schemaHash(changed)).to.not.eql(schemaHash(schema))
  })

  it('records the version, when it was applied and where from', () => {
    const props = stampProps('abc123def456', 'commit 1234567', new Date('2026-11-24T10:00:00Z'))
    expect(props).to.eql({
      [PROPS.hash]: 'abc123def456',
      [PROPS.appliedAt]: '2026-11-24T10:00:00.000Z',
      [PROPS.source]: 'commit 1234567'
    })
  })

  it('says where the schema files came from', () => {
    expect(schemaSource(__dirname)).to.match(/^commit [0-9a-f]+( with uncommitted changes)?$|^not a git checkout$/)
    expect(schemaSource('/')).to.eql('not a git checkout')
  })

  describe('comparing Solr with the files here', () => {
    const recorded = stampProps('abc123def456', 'commit 1234567', new Date('2026-11-24T10:00:00Z'))

    it('matches', () => {
      const { matches, lines } = describeStamp(recorded, 'abc123def456')
      expect(matches).to.eql(true)
      expect(lines.join(' ')).to.include('abc123def456').and.include('commit 1234567').and.include('matches')
    })

    it('differs', () => {
      const { matches, lines } = describeStamp(recorded, 'fff000fff000')
      expect(matches).to.eql(false)
      expect(lines.join(' ')).to.include('does NOT match')
    })

    it('nothing recorded yet', () => {
      for (const none of [{}, undefined, null]) {
        const { matches, lines } = describeStamp(none, 'abc123def456')
        expect(matches).to.eql(false)
        expect(lines[0]).to.include('no schema version recorded')
      }
    })
  })
})
