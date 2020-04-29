/* eslint-env mocha */

'use strict'

const expect = require('chai').expect
const tymly = require('@wmfs/tymly')
const path = require('path')
const process = require('process')
const sqlScriptRunner = require('./fixtures/sql-script-runner.js')

describe('tymly-solr-plugin remove docs resource tests', function () {
  this.timeout(process.env.TIMEOUT || 6000)

  let tymlyService, statebox, client

  before(function () {
    if (process.env.PG_CONNECTION_STRING && !/^postgres:\/\/[^:]+:[^@]+@(?:localhost|127\.0\.0\.1).*$/.test(process.env.PG_CONNECTION_STRING)) {
      console.log(`Skipping tests due to unsafe PG_CONNECTION_STRING value (${process.env.PG_CONNECTION_STRING})`)
      this.skip()
    }
  })

  it('should run the tymly services', async () => {
    const tymlyServices = await tymly.boot(
      {
        pluginPaths: [
          path.resolve(__dirname, './../lib'),
          require.resolve('@wmfs/tymly-pg-plugin'),
          require.resolve('@wmfs/tymly-rbac-plugin'),
          require.resolve('@wmfs/tymly-cardscript-plugin')
        ],
        blueprintPaths: [
          path.resolve(__dirname, './fixtures/incident-blueprint')
        ]
      }
    )

    tymlyService = tymlyServices.tymly
    statebox = tymlyServices.statebox
    client = tymlyServices.storage.client
  })

  if (process.env.SOLR_URL && process.env.SOLR_PATH && process.env.SOLR_PORT && process.env.SOLR_HOST) {
    it('should create test resources', async () => {
      await sqlScriptRunner(
        './db-scripts/incident-setup.sql',
        client
      )
    })

    it('perform reindex', async () => {
      const executionDescription = await statebox.startExecution(
        {},
        'tymlyTest_fullReindex_1_0',
        {
          sendResponse: 'COMPLETE',
          userId: 'test-user-1'
        }
      )

      console.log(JSON.stringify(executionDescription, null, 2))
    })

    it('should wait a while', (done) => {
      setTimeout(done, 5900)
    })

    it('should search to check data is there', async () => {
      const executionDescription = await statebox.startExecution(
        {
          query: 'bad incident',
          offset: 0,
          limit: 10
        },
        'tymlyTest_search_1_0',
        {
          sendResponse: 'COMPLETE',
          userId: 'test-user-1'
        }
      )

      console.log(JSON.stringify(executionDescription, null, 2))
      expect(executionDescription.ctx.searchResults.results.length).to.eql(3)
    })

    it('should execution remove docs state machine', async () => {
      const executionDescription = await statebox.startExecution(
        {},
        'tymlyTest_removeDocs_1_0',
        {
          sendResponse: 'COMPLETE',
          userId: 'test-user-1'
        }
      )

      console.log(JSON.stringify(executionDescription, null, 2))
      expect(executionDescription.currentStateName).to.eql('RemoveDocs')
      expect(executionDescription.currentResource).to.eql('module:removeDocs')
      expect(executionDescription.stateMachineName).to.eql('tymlyTest_removeDocs_1_0')
      expect(executionDescription.status).to.eql('SUCCEEDED')
    })

    it('should search to check data is removed', async () => {
      const executionDescription = await statebox.startExecution(
        {
          query: 'bad incident',
          offset: 0,
          limit: 10
        },
        'tymlyTest_search_1_0',
        {
          sendResponse: 'COMPLETE',
          userId: 'test-user-1'
        }
      )

      console.log(JSON.stringify(executionDescription, null, 2))
      expect(executionDescription.ctx.searchResults.results.length).to.eql(0)
    })
  }

  it('should cleanup test resources', async () => {
    await sqlScriptRunner(
      './db-scripts/cleanup.sql',
      client
    )
  })

  after('should shutdown Tymly', async () => {
    await tymlyService.shutdown()
  })
})
