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

  let tymlyService, statebox = null, client, rbacAdmin

  before((done) => {
    if (process.env.PG_CONNECTION_STRING && !/^postgres:\/\/[^:]+:[^@]+@(?:localhost|127\.0\.0\.1).*$/.test(process.env.PG_CONNECTION_STRING)) {
      console.log(`Skipping tests due to unsafe PG_CONNECTION_STRING value (${process.env.PG_CONNECTION_STRING})`)
      this.skip()
      done()
    }

    tymly.boot(
      {
        pluginPaths: [
          path.resolve(__dirname, './../lib'),
          require.resolve('@wmfs/tymly-pg-plugin'),
          require.resolve('@wmfs/tymly-rbac-plugin')
        ],
        blueprintPaths: [
          path.resolve(__dirname, './fixtures/school-blueprint')
        ],
        config: {
          solrSchemaFields: [
            'id',
            'actorName',
            'characterName',
            'roles'
          ]
        }
      },
      function (err, tymlyServices) {
        expect(err).to.eql(null)
        tymlyService = tymlyServices.tymly
        statebox = tymlyServices.statebox
        rbacAdmin = tymlyServices.rbacAdmin
        client = tymlyServices.storage.client
        done()
      }
    )
  })

  describe('setup', () => {
    it('create test resources', function (done) {
      sqlScriptRunner(
        './db-scripts/setup.sql',
        client,
        function (err) {
          expect(err).to.equal(null)
          if (err) {
            done(err)
          } else {
            done()
          }
        }
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
        expect(searchResults.totalHits).to.eql(19)
        expect(searchResults.results[0].character_name).to.eql('RUBEUS HAGRID')
        expect(searchResults.results[1].character_name).to.eql('SEVERUS SNAPE')
        expect(searchResults.results[2].character_name).to.eql('GEORGE WEASLEY')
      })
      it('search for data with boss role', async () => {
        const searchResults = await search('Hagrid', 'john.smith')
        expect(searchResults.totalHits).to.eql(1)
        expect(searchResults.results[0].character_name).to.eql('RUBEUS HAGRID')
      })
      it('search for data with minor role', async () => {
        const searchResults = await search('Hermione', 'john.smith')

        expect(searchResults.totalHits).to.eql(1)
        expect(searchResults.results[0].character_name).to.eql('HERMIONE GRANGER')
      })
    })

    describe('user with minor role', () => {
      it('no results when user role is a minor', async () => {
        const searchResults = await search(null, 'jane.smith')

        expect(searchResults.totalHits).to.eql(0)
        expect(searchResults.results.length).to.eql(0)
      })
    })

    describe('user with no role', () => {
      it('no results when user without any roles', async () => {
        const searchResults = await search(null, 'jim.smith')

        expect(searchResults.totalHits).to.eql(0)
        expect(searchResults.results.length).to.eql(0)
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
    it('cleanup test resources', function (done) {
      sqlScriptRunner(
        './db-scripts/cleanup.sql',
        client,
        function (err) {
          expect(err).to.equal(null)
          if (err) {
            done(err)
          } else {
            done()
          }
        }
      )
    })
  })

  after(async () => {
    await tymlyService.shutdown()
  })

  async function search (query, userId) {
    const executionDescription = await statebox.startExecution(
      {
        query: query,
        limit: 100
      }, // input
      STATE_MACHINE_NAME, // state machine name
      {
        sendResponse: 'COMPLETE',
        userId: userId
      } // options
    )

    expect(executionDescription.currentStateName).to.eql('Search')
    expect(executionDescription.currentResource).to.eql('module:search')
    expect(executionDescription.stateMachineName).to.eql(STATE_MACHINE_NAME)
    expect(executionDescription.status).to.eql('SUCCEEDED')

    return executionDescription.ctx.searchResults
  } // search
})
