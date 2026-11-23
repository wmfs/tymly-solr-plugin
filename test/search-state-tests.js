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

  let tymlyService; let statebox = null; let client; let rbacAdmin; let registry; let searchAnalytics

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
            'domain',
            'category',
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
    registry = tymlyServices.registry
    searchAnalytics = tymlyServices.searchAnalytics
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

  describe('filters (Postgres search)', () => {
    it('domain filter still matches', async () => {
      const searchResults = await searchWith({ domain: 'search' }, 'john.smith')
      expect(searchResults.totalHits).to.eql(24)
    })

    it('category filter still matches', async () => {
      const searchResults = await searchWith({ categoryRestriction: ['school', 'other'] }, 'john.smith')
      expect(searchResults.totalHits).to.eql(24)
    })

    it('an unknown domain matches nothing', async () => {
      const searchResults = await searchWith({ domain: 'nope' }, 'john.smith')
      expect(searchResults.totalHits).to.eql(0)
    })
  })

  describe('injection attempts (Postgres search)', () => {
    it('SQL in domain matches nothing instead of everything', async () => {
      const searchResults = await searchWith({ domain: "x' or '1'='1" }, 'john.smith')
      expect(searchResults.totalHits).to.eql(0)
    })

    it('a statement in domain is treated as a value', async () => {
      const searchResults = await searchWith({ domain: "x'; delete from tymly_test.staff; --" }, 'john.smith')
      expect(searchResults.totalHits).to.eql(0)

      const staff = await client.query('select count(*) as total from tymly_test.staff')
      expect(Number(staff.rows[0].total)).to.be.greaterThan(0)
    })

    it('SQL in categoryRestriction matches nothing instead of everything', async () => {
      const searchResults = await searchWith({ categoryRestriction: ["x' or '1'='1"] }, 'john.smith')
      expect(searchResults.totalHits).to.eql(0)
    })

    it('a user with no roles still cannot see staff', async () => {
      const searchResults = await searchWith({ query: 'Hagrid', domain: "x' or '1'='1" }, 'jim.smith')
      expect(searchResults.totalHits).to.eql(0)
    })

    it('% and _ in search text are literal, not wildcards', async () => {
      const searchResults = await searchWith({ query: '%' }, 'john.smith')
      expect(searchResults.totalHits).to.eql(0)
    })
  })

  describe('search analytics', () => {
    const CLICK_STATE_MACHINE = 'tymly_logSearchClick_1_0'

    let hagridLogId

    before(async () => {
      await client.query('delete from tymly.search_click')
      await client.query('delete from tymly.search_log')
    })

    it('a search logs one row and returns its searchLogId', async () => {
      const historyBefore = await countRows('tymly.search_history')

      const searchResults = await searchWith({ query: '  HAGRID  ', domain: 'search' }, 'john.smith')
      expect(searchResults.totalHits).to.eql(1)
      expect(searchResults.searchLogId).to.be.a('string')
      hagridLogId = searchResults.searchLogId

      const { rows } = await client.query('select * from tymly.search_log')
      expect(rows).to.have.length(1)
      expect(rows[0].id).to.equal(hagridLogId)
      expect(rows[0].user_id).to.equal('john.smith')
      expect(rows[0].query).to.equal('hagrid')
      expect(rows[0].domain).to.equal('search')
      expect(rows[0].hit_count).to.equal(1)
      expect(rows[0].result_offset).to.equal(0)
      expect(rows[0].duration_ms).to.be.at.least(0)

      // search_history no longer grows on every search
      expect(await countRows('tymly.search_history')).to.equal(historyBefore)
    })

    it('a search with no text and no categories is not logged', async () => {
      const searchResults = await search(null, 'john.smith')
      expect(searchResults.searchLogId).to.equal(null)
      expect(await countRows('tymly.search_log')).to.equal(1)
    })

    it('skipLog: a search shown again is not logged', async () => {
      const searchResults = await searchWith({ query: 'Hagrid', skipLog: true }, 'john.smith')
      expect(searchResults.totalHits).to.eql(1)
      expect(searchResults.searchLogId).to.equal(null)
      expect(await countRows('tymly.search_log')).to.equal(1)
    })

    it('a search that finds nothing is in the zero results report', async () => {
      const searchResults = await searchWith({ query: 'Voldemort' }, 'jane.smith')
      expect(searchResults.totalHits).to.eql(0)

      const { rows } = await client.query('select * from tymly.search_report_zero_results')
      expect(rows.map(r => [r.domain, r.query])).to.eql([[null, 'voldemort']])
      expect(Number(rows[0].searches)).to.equal(1)
    })

    it('a search with categories but no text is logged, and left out of the text reports', async () => {
      const searchResults = await searchWith({ categoryRestriction: ['school'] }, 'jane.smith')
      expect(searchResults.searchLogId).to.be.a('string')

      const { rows } = await client.query('select query, category_restriction from tymly.search_log where id = $1', [searchResults.searchLogId])
      expect(rows[0].query).to.equal('')
      expect(rows[0].category_restriction).to.eql(['school'])

      const noClick = await client.query('select query from tymly.search_report_no_click')
      expect(noClick.rows.map(r => r.query)).to.not.include('')

      await client.query('delete from tymly.search_log where id = $1', [searchResults.searchLogId])
    })

    it('the no click report is empty until a domain records clicks', async () => {
      const { rows } = await client.query('select query from tymly.search_report_no_click')
      expect(rows).to.have.length(0)
    })

    it('opening a result logs a click', async () => {
      const execution = await logClick({ searchLogId: hagridLogId, docId: 'staff#1', docType: 'staff', position: 1 }, 'john.smith')
      expect(execution.status).to.eql('SUCCEEDED')

      const { rows } = await client.query('select * from tymly.search_click')
      expect(rows).to.have.length(1)
      expect(rows[0]).to.include({
        search_log_id: hagridLogId,
        user_id: 'john.smith',
        doc_id: 'staff#1',
        doc_type: 'staff',
        position: 1
      })
    })

    it('a clicked search is not in the no click report', async () => {
      const { rows } = await client.query('select * from tymly.search_report_no_click')
      expect(rows).to.have.length(0)
    })

    it('the no click report only covers domains that record clicks', async () => {
      const unclicked = await searchWith({ query: 'Hermione', domain: 'search' }, 'john.smith')
      expect(unclicked.totalHits).to.eql(1)
      // a search from a card, whose clicks aren't recorded
      await client.query(
        "insert into tymly.search_log (user_id, query, domain, hit_count) values ('john.smith', 'afc56', 'fsTaskList', 2)"
      )

      const { rows } = await client.query('select domain, query from tymly.search_report_no_click')
      expect(rows).to.eql([{ domain: 'search', query: 'hermione' }])

      await client.query("delete from tymly.search_log where query in ('hermione', 'afc56')")
    })

    it('the click position report counts the click', async () => {
      const { rows } = await client.query('select * from tymly.search_report_click_position')
      expect(rows).to.have.length(1)
      expect(rows[0].domain).to.equal('search')
      expect(Number(rows[0].clicks)).to.equal(1)
      expect(Number(rows[0].avg_position)).to.equal(1)
      expect(Number(rows[0].pct_first_result)).to.equal(100)
    })

    it("cannot log a click against another user's search", async () => {
      const execution = await logClick({ searchLogId: hagridLogId, docId: 'staff#1', position: 1 }, 'jane.smith')
      expect(execution.status).to.eql('FAILED')
      expect(execution.errorCode).to.eql('unknownSearchLog')
    })

    it('rejects an invalid click', async () => {
      const execution = await logClick({ searchLogId: "x' or '1'='1", docId: 'staff#1', position: 1 }, 'john.smith')
      expect(execution.status).to.eql('FAILED')
      expect(execution.errorCode).to.eql('invalidSearchClick')
    })

    it('retention: the registry key defaults to 365 days (or SEARCH_LOG_RETENTION_DAYS)', () => {
      expect(searchAnalytics.retentionDays).to.equal(Number(process.env.SEARCH_LOG_RETENTION_DAYS) || 365)
    })

    it('retention: deletes rows older than the tymly_searchLogRetentionDays registry key', async () => {
      await registry.set('tymly_searchLogRetentionDays', 30)

      await client.query(
        "insert into tymly.search_log (user_id, query, hit_count, _created) values ('old.user', 'old', 0, now() - interval '40 days'), ('recent.user', 'recent', 0, now() - interval '20 days')"
      )
      expect(await countRows('tymly.search_log')).to.equal(4)

      await searchAnalytics.deleteOldRows()

      expect(searchAnalytics.retentionDays).to.equal(30)
      const { rows } = await client.query('select user_id from tymly.search_log order by user_id')
      expect(rows.map(r => r.user_id)).to.eql(['jane.smith', 'john.smith', 'recent.user'])
      expect(await countRows('tymly.search_click')).to.equal(1)
    })

    it('retention: an invalid registry value keeps the last good one', async () => {
      await registry.set('tymly_searchLogRetentionDays', 'forever')
      await searchAnalytics.deleteOldRows()
      expect(searchAnalytics.retentionDays).to.equal(30)
      expect(await countRows('tymly.search_log')).to.equal(3)

      await registry.set('tymly_searchLogRetentionDays', 365)
    })

    async function countRows (table) {
      const { rows } = await client.query(`select count(*)::int as n from ${table}`)
      return rows[0].n
    }

    function logClick (input, userId) {
      return statebox.startExecution(input, CLICK_STATE_MACHINE, { sendResponse: 'COMPLETE', userId })
    }
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

  async function searchWith (input, userId) {
    const executionDescription = await statebox.startExecution(
      {
        limit: 100,
        ...input
      },
      STATE_MACHINE_NAME,
      {
        sendResponse: 'COMPLETE',
        userId
      }
    )

    expect(executionDescription.status).to.eql('SUCCEEDED')
    return executionDescription.ctx.searchResults
  } // searchWith
})
