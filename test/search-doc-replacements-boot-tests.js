/* eslint-env mocha */

'use strict'

const expect = require('chai').expect
const tymly = require('@wmfs/tymly')
const path = require('path')

describe('a blueprint replacing another blueprint\'s search doc', function () {
  this.timeout(process.env.TIMEOUT || 5000)

  let tymlyService, client, solr

  before(async function () {
    if (process.env.PG_CONNECTION_STRING && !/^postgres:\/\/[^:]+:[^@]+@(?:localhost|127\.0\.0\.1).*$/.test(process.env.PG_CONNECTION_STRING)) {
      console.log(`Skipping tests due to unsafe PG_CONNECTION_STRING value (${process.env.PG_CONNECTION_STRING})`)
      this.skip()
    }

    const services = await tymly.boot({
      pluginPaths: [
        path.resolve(__dirname, './../lib'),
        require.resolve('@wmfs/tymly-pg-plugin')
      ],
      blueprintPaths: [
        path.resolve(__dirname, './fixtures/school-blueprint'),
        path.resolve(__dirname, './fixtures/replacing-blueprint')
      ],
      config: {
        solrSchemaFields: ['id', 'actorName', 'characterName', 'roles', 'launches']
      }
    })
    tymlyService = services.tymly
    client = services.storage.client
    solr = services.solr
  })

  it('indexes the replacing doc instead of the replaced one', () => {
    expect(Object.keys(solr.searchDocs)).to.include('tymlyTestPlus_staffWithMinors')
    expect(Object.keys(solr.searchDocs)).to.not.include('tymlyTest_staff')
    expect(solr.replacedSearchDocs).to.eql({ tymlyTest_staff: 'tymlyTestPlus_staffWithMinors' })
  })

  it('the solr_data view has the staff once, with the replacing doc\'s roles', () => {
    expect(solr.createViewSQL.match(/FROM tymly_test\.staff/g)).to.have.length(1)
    expect(solr.createViewSQL).to.include('tymlyTest_minor')
  })

  after(async () => {
    // drop everything this test created
    if (client) await client.query('DROP SCHEMA IF EXISTS tymly CASCADE; DROP SCHEMA IF EXISTS tymly_test CASCADE; DROP SCHEMA IF EXISTS tymly_test_plus CASCADE')
    if (tymlyService) await tymlyService.shutdown()
  })
})
