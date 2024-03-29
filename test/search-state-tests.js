/* eslint-env mocha */

'use strict'

const expect = require('chai').expect
const tymly = require('@wmfs/tymly')
const path = require('path')
const process = require('process')
const sqlScriptRunner = require('./fixtures/sql-script-runner.js')
const STATE_MACHINE_NAME = 'tymlyTest_search_1_0'

process.on('unhandledRejection', (reason, p) => {
  console.log('Unhandled Rejection at: Promise', p, 'reason:', reason)
  // application specific logging, throwing an error, or other logic here
})

describe('tymly-solr-plugin search state resource tests', function () {
  this.timeout(process.env.TIMEOUT || 5000)

  let tymlyService; let statebox = null; let client; let rbacAdmin

  before(async () => {
    if (process.env.PG_CONNECTION_STRING && !/^postgres:\/\/[^:]+:[^@]+@(?:localhost|127\.0\.0\.1).*$/.test(process.env.PG_CONNECTION_STRING)) {
      console.log(`Skipping tests due to unsafe PG_CONNECTION_STRING value (${process.env.PG_CONNECTION_STRING})`)
      this.skip()
      return
    }

    const tymlyServices = await tymly.boot(
      {
        pluginPaths: [
          path.resolve(__dirname, './../lib'),
          require.resolve('@wmfs/tymly-pg-plugin'),
          require.resolve('@wmfs/tymly-rbac-plugin'),
          require.resolve('@wmfs/tymly-cardscript-plugin')
        ],
        blueprintPaths: [
          path.resolve(__dirname, './fixtures/school-blueprint')
        ],
        config: {
          solrSchemaFields: [
            'id',
            'actorName',
            'characterName',
            'roles',
            'launches'
          ]
        }
      }
    )

    tymlyService = tymlyServices.tymly
    statebox = tymlyServices.statebox
    rbacAdmin = tymlyServices.rbacAdmin
    client = tymlyServices.storage.client
  })

  describe('setup', () => {
    it('create test resources', async () => {
      await sqlScriptRunner(
        './db-scripts/setup.sql',
        client
      )
    })

    it('John Smith is the boss and a minor', () => {
      return rbacAdmin.ensureUserRoles(
        'john.smith',
        ['tymlyTest_boss', 'tymlyTest_minor']
      )
    })

    it('ensure Jane Smith is a minor', () => {
      return rbacAdmin.ensureUserRoles(
        'jane.smith',
        ['tymlyTest_minor']
      )
    })
  }) // setup

  describe('search', () => {
    describe('user with boss and minor role', () => {
      it('no input returns everything', async () => {
        const searchResults = await search(null, 'john.smith')
        expect(searchResults.totalHits).to.eql(24)
      })
      it('search for staff', async () => {
        const searchResults = await search('Hagrid', 'john.smith')
        expect(searchResults.totalHits).to.eql(1)
        expect(searchResults.results[0].character_name).to.eql('RUBEUS HAGRID')
        expect(searchResults.results[0].launches.length).to.equal(1)
      })
      it('search for student', async () => {
        const searchResults = await search('Hermione', 'john.smith')

        expect(searchResults.totalHits).to.eql(1)
        expect(searchResults.results[0].character_name).to.eql('HERMIONE GRANGER')
        expect(searchResults.results[0].launches.length).to.equal(2)
      })
      it('search for muggle', async () => {
        const searchResults = await search('William', 'john.smith')

        expect(searchResults.totalHits).to.eql(1)
        expect(searchResults.results[0].character_name).to.eql('Themself')
        expect(searchResults.results[0].launches.length).to.equal(2)
      })
    })

    describe('user with minor role', () => {
      it('no input returns all but staff', async () => {
        const searchResults = await search(null, 'jane.smith')

        expect(searchResults.totalHits).to.eql(15)
        expect(searchResults.results.length).to.eql(15)
      })
      it('search for staff', async () => {
        const searchResults = await search('Hagrid', 'jane.smith')
        expect(searchResults.totalHits).to.eql(0)
      })
      it('search for student', async () => {
        const searchResults = await search('Hermione', 'jane.smith')

        expect(searchResults.totalHits).to.eql(1)
        expect(searchResults.results[0].character_name).to.eql('HERMIONE GRANGER')
        expect(searchResults.results[0].launches.length).to.equal(1)
      })
      it('search for muggle', async () => {
        const searchResults = await search('William', 'jane.smith')

        expect(searchResults.totalHits).to.eql(1)
        expect(searchResults.results[0].character_name).to.eql('Themself')
        expect(searchResults.results[0].launches.length).to.equal(1)
      })
    })

    describe('user with no role', () => {
      it('no input returns only muggles', async () => {
        const searchResults = await search(null, 'jim.smith')

        expect(searchResults.totalHits).to.eql(5)
        expect(searchResults.results.length).to.eql(5)
      })
      it('search for staff', async () => {
        const searchResults = await search('Hagrid', 'jim.smith')
        expect(searchResults.totalHits).to.eql(0)
      })
      it('search for student', async () => {
        const searchResults = await search('Hermione', 'jim.smith')

        expect(searchResults.totalHits).to.eql(0)
      })
      it('search for muggle', async () => {
        const searchResults = await search('William', 'jim.smith')

        expect(searchResults.totalHits).to.eql(1)
        expect(searchResults.results[0].character_name).to.eql('Themself')
        expect(searchResults.results[0].launches.length).to.equal(1)
      })
    })
    describe('no user id', () => {
      it('fail to search when no user id', async () => {
        const executionDescription = await statebox.startExecution(
          {}, // input
          STATE_MACHINE_NAME, // state machine name
          {
            sendResponse: 'COMPLETE'
          }
        )

        expect(executionDescription.status).to.eql('FAILED')
        expect(executionDescription.errorCode).to.eql('noUserIdSearchFail')
        expect(executionDescription.errorMessage).to.eql('No user ID found when trying to search.')
      })
    })
  })

  describe('teardown', () => {
    it('cleanup test resources', async () => {
      await sqlScriptRunner(
        './db-scripts/cleanup.sql',
        client
      )
    })
  })

  after(async () => {
    await tymlyService.shutdown()
  })

  async function search (query, userId) {
    const executionDescription = await statebox.startExecution(
      {
        query,
        limit: 100
      }, // input
      STATE_MACHINE_NAME, // state machine name
      {
        sendResponse: 'COMPLETE',
        userId
      } // options
    )

    expect(executionDescription.currentStateName).to.eql('Search')
    expect(executionDescription.currentResource).to.eql('module:search')
    expect(executionDescription.stateMachineName).to.eql(STATE_MACHINE_NAME)
    expect(executionDescription.status).to.eql('SUCCEEDED')

    return executionDescription.ctx.searchResults
  } // search
})
