/* eslint-env mocha */

const expect = require('chai').expect
const tymly = require('@wmfs/tymly')
const path = require('path')
const process = require('process')
const sqlScriptRunner = require('./fixtures/sql-script-runner.js')

const reindexTests = [
  {
    name: 'delta reindex',
    stateName: 'DeltaReindex',
    resource: 'module:deltaReindex',
    stateMachine: 'tymlyTest_deltaReindex_1_0'
  },
  {
    name: 'full reindex',
    stateName: 'FullReindex',
    resource: 'module:fullReindex',
    stateMachine: 'tymlyTest_fullReindex_1_0'
  }
]

for (const test of reindexTests) {
  describe(`tymly-solr-plugin ${test.name} tests`, function () {
    this.timeout(process.env.TIMEOUT || 5000)

    let statebox, tymlyService, client

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
            require.resolve('@wmfs/tymly-pg-plugin')
          ],
          blueprintPaths: [
            path.resolve(__dirname, './fixtures/school-blueprint')
          ],
          config: {
            solrSchemaFields: [
              'id',
              'actorName',
              'characterName'
            ]
          }
        }
      )

      tymlyService = tymlyServices.tymly
      statebox = tymlyServices.statebox
      client = tymlyServices.storage.client
    })

    it(`should start the ${test.stateMachine} state machine`, async () => {
      const executionDescription = await statebox.startExecution(
        {}, // input
        test.stateMachine, // state machine name
        {
          sendResponse: 'COMPLETE'
        } // options
      )

      expect(executionDescription.currentStateName).to.eql(test.stateName)
      expect(executionDescription.currentResource).to.eql(test.resource)
      expect(executionDescription.stateMachineName).to.eql(test.stateMachine)
      expect(executionDescription.status).to.eql('SUCCEEDED')
    })

    it('should cleanup test resources', async () => {
      await sqlScriptRunner(
        './db-scripts/cleanup.sql',
        client
      )
    })

    after('shutdown Tymly', async () => {
      await tymlyService.shutdown()
    })
  })
}
