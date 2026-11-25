/* eslint-env mocha */

'use strict'

const expect = require('chai').expect
const tymly = require('@wmfs/tymly')
const path = require('path')

describe('search synonyms service', function () {
  this.timeout(process.env.TIMEOUT || 5000)

  let tymlyService, client, searchSynonyms

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
        path.resolve(__dirname, './fixtures/synonyms-blueprint')
      ],
      config: {}
    })
    tymlyService = services.tymly
    client = services.storage.client
    searchSynonyms = services.searchSynonyms
  })

  it('collects synonyms from the blueprints\' search-synonyms directories on boot', () => {
    expect(searchSynonyms.groups).to.eql([['dada', 'defence against the dark arts']])
  })

  it('sends nothing when there is no Solr URL', async () => {
    expect(await searchSynonyms.synced).to.eql({ status: 'noSolr' })
  })

  after(async () => {
    // drop everything this test created
    if (client) await client.query('DROP SCHEMA IF EXISTS tymly CASCADE; DROP SCHEMA IF EXISTS synonyms_test CASCADE')
    if (tymlyService) await tymlyService.shutdown()
  })
})
