/* eslint-env mocha */

'use strict'

const expect = require('chai').expect
const tymly = require('@wmfs/tymly')
const path = require('path')
const process = require('process')
const sqlScriptRunner = require('./fixtures/sql-script-runner.js')

describe('tymly-solr-plugin add docs resource tests', function () {
  this.timeout(process.env.TIMEOUT || 5000)

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
          require.resolve('@wmfs/tymly-cardscript-plugin'),
          require.resolve('@wmfs/tymly-rbac-plugin')
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
      await client.query(`INSERT INTO tymly_test.incident (inc_no, description) VALUES (1, 'A bad incident');`)
    })

    it('should ensure the record to be inserted isn\'t already there', async () => {
      const executionDescription = await statebox.startExecution(
        {
          query: 'A bad incident',
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
      expect(executionDescription.ctx.searchResults.totalHits).to.eql(0)
    })

    it('should get a record and try to add it', async () => {
      const executionDescription = await statebox.startExecution(
        {
          id: 1
        }, // input
        'tymlyTest_addDocs_1_0', // state machine name
        {
          sendResponse: 'COMPLETE',
          userId: 'test-user-1'
        } // options
      )

      expect(executionDescription.currentStateName).to.eql('AddDocs')
      expect(executionDescription.currentResource).to.eql('module:addDocs')
      expect(executionDescription.status).to.eql('SUCCEEDED')
    })

    it('should ensure the record was added', async () => {
      const executionDescription = await statebox.startExecution(
        {
          query: 'A bad incident',
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
      expect(executionDescription.ctx.searchResults.totalHits).to.eql(1)
    })

    it('should remove the test doc', async () => {
      await statebox.startExecution(
        {},
        'tymlyTest_removeDocs_1_0',
        {
          sendResponse: 'COMPLETE',
          userId: 'test-user-1'
        }
      )
    })

    it('should ensure the record has been removed', async () => {
      const executionDescription = await statebox.startExecution(
        {
          offset: 0,
          limit: 10
        },
        'tymlyTest_search_1_0',
        {
          sendResponse: 'COMPLETE',
          userId: 'test-user-1'
        }
      )

      expect(executionDescription.ctx.searchResults.totalHits).to.eql(0)
    })

    it('should wait a while', (done) => {
      setTimeout(done, 4900)
    })
  }

  it('should cleanup test resources', async () => {
    await sqlScriptRunner(
      './db-scripts/cleanup.sql',
      client
    )
  })

  it('should shutdown Tymly', async () => {
    await tymlyService.shutdown()
  })
})
