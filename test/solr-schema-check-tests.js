/* eslint-env mocha */

'use strict'

const expect = require('chai').expect
const { checkSolrSchema, SEARCH_FIELDS } = require('../lib/components/services/search-synonyms/schema-check')
const { loadWantedSchema } = require('../solr/apply-schema')
const { PROPS, schemaHash } = require('../solr/lib/schema-version')

// Stands in for lib/util/solr-admin.js
function fakeSolr ({ fields, userProps }) {
  return {
    get: async (path) => {
      expect(path).to.equal('/schema/fields')
      return { fields: fields.map(name => ({ name })) }
    },
    getUserProps: async () => userProps
  }
}

describe('checking the Solr schema on boot', () => {
  const localHash = schemaHash(loadWantedSchema())
  const allFields = ['id', 'title', ...SEARCH_FIELDS]

  it('ok when Solr has the search fields and this plugin\'s schema version', async () => {
    const result = await checkSolrSchema(fakeSolr({ fields: allFields, userProps: { [PROPS.hash]: localHash } }))
    expect(result.status).to.equal('ok')
  })

  it('warns when the schema has not been applied, naming the missing fields and what to run', async () => {
    const result = await checkSolrSchema(fakeSolr({ fields: ['id', 'title'], userProps: {} }))
    expect(result.status).to.equal('missingFields')
    expect(result.message).to.include('searchText, searchPrefix, searchShingle')
    expect(result.message).to.include('apply-schema.js')
  })

  it('warns when Solr has a different schema version', async () => {
    const result = await checkSolrSchema(fakeSolr({ fields: allFields, userProps: { [PROPS.hash]: 'aaaaaaaaaaaa' } }))
    expect(result.status).to.equal('differentVersion')
    expect(result.message).to.include(localHash)
  })

  it('says when no version was recorded (applied before version stamps, or by hand)', async () => {
    const result = await checkSolrSchema(fakeSolr({ fields: allFields, userProps: null }))
    expect(result.status).to.equal('notRecorded')
  })
})
