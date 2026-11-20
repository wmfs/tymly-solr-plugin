/* eslint-env mocha */
'use strict'

const expect = require('chai').expect
const tymly = require('@wmfs/tymly')
const path = require('path')
const process = require('process')

const FULL_REINDEX = 'tymly_fullReindex_1_0'
const SEARCH = 'tymly_search_1_0'
const SOLR_ADMIN = 'tymly_solrAdmin'
const SOLR_ENV_VARS = ['SOLR_HOST', 'SOLR_PORT', 'SOLR_PATH']

const blueprintDir = path.resolve(__dirname, '../lib/blueprints/solr-blueprint')
const fullReindexDefinition = require(path.join(blueprintDir, 'state-machines/full-reindex.json'))
const solrAdminTemplateRole = require(path.join(blueprintDir, 'template-roles/solr-admin.json'))

describe('tymly_fullReindex_1_0 access restrictions', function () {
  this.timeout(process.env.TIMEOUT || 5000)

  describe('state machine definition', () => {
    const restrictions = fullReindexDefinition.restrictions || []
    const roleIds = restrictions.map(r => r.roleId)

    it('has restrictions', () => {
      expect(restrictions.length).to.be.greaterThan(0)
    })

    it('only allows the Solr admin role', () => {
      expect(roleIds).to.eql([SOLR_ADMIN])
    })

    it('does not allow $authenticated or $everyone', () => {
      expect(roleIds).to.not.include('$authenticated')
      expect(roleIds).to.not.include('$everyone')
    })

    it('ships the tymly_solrAdmin template role in the plugin blueprint', () => {
      expect(solrAdminTemplateRole.label).to.be.a('string')
      expect(solrAdminTemplateRole.label.length).to.be.greaterThan(0)
      expect(solrAdminTemplateRole.description).to.be.a('string')
      expect(solrAdminTemplateRole.description.length).to.be.greaterThan(0)
    })
  })

  describe('authorisation when starting the state machine', () => {
    const allowedUsers = [
      { userId: 'solr-admin', reason: 'has tymly_solrAdmin' },
      { userId: 'ops-lead', reason: 'has a role that inherits tymly_solrAdmin' },
      { userId: 'super-admin', reason: 'has a role granted every state machine (like wmfs_wmfsAdmin)' }
    ]

    const disallowedUsers = [
      { userId: null, reason: 'no user, e.g. a schedule whose owner cannot be resolved' },
      { userId: 'jim.smith', reason: 'is logged in but has no roles' },
      { userId: 'reader', reason: 'only has an unrelated role' }
    ]

    const savedSolrEnv = {}
    let tymlyService, statebox, rbac, rbacAdmin

    before('check the database is a local one', function () {
      if (process.env.PG_CONNECTION_STRING && !/^postgres:\/\/[^:]+:[^@]+@(?:localhost|127\.0\.0\.1).*$/.test(process.env.PG_CONNECTION_STRING)) {
        console.log(`Skipping tests due to unsafe PG_CONNECTION_STRING value (${process.env.PG_CONNECTION_STRING})`)
        this.skip()
      }
    })

    before('boot Tymly with RBAC and no Solr connection', async () => {
      // With no Solr host configured the reindex resource succeeds without calling Solr,
      // so these tests only exercise the RBAC check.
      for (const key of SOLR_ENV_VARS) {
        savedSolrEnv[key] = process.env[key]
        delete process.env[key]
      }

      const tymlyServices = await tymly.boot({
        pluginPaths: [
          path.resolve(__dirname, '../lib'),
          require.resolve('@wmfs/tymly-pg-plugin'),
          require.resolve('@wmfs/tymly-rbac-plugin'),
          require.resolve('@wmfs/tymly-cardscript-plugin') // the RBAC plugin's forms need awaitingHumanInput
        ],
        blueprintPaths: [
          path.resolve(__dirname, './fixtures/admin-blueprint')
        ],
        config: {}
      })

      tymlyService = tymlyServices.tymly
      statebox = tymlyServices.statebox
      rbac = tymlyServices.rbac
      rbacAdmin = tymlyServices.rbacAdmin

      // createRole throws if the role is left over from an earlier run against the same database
      const existingRoles = await rbacAdmin.listRoles()
      const saveRole = existingRoles.includes('tymlyTest_opsLead') ? 'updateRole' : 'createRole'
      await rbacAdmin[saveRole](
        'tymlyTest_opsLead',
        'Ops lead',
        'Inherits the Solr admin role',
        [SOLR_ADMIN]
      )

      await rbacAdmin.ensureUserRoles('solr-admin', [SOLR_ADMIN])
      await rbacAdmin.ensureUserRoles('ops-lead', ['tymlyTest_opsLead'])
      await rbacAdmin.ensureUserRoles('super-admin', ['tymlyTest_superAdmin'])
      await rbacAdmin.ensureUserRoles('reader', ['tymlyTest_readOnly'])
      await rbacAdmin.refreshRbacIndex()
    })

    it('registers the tymly_solrAdmin role from the template', async () => {
      const roles = await rbacAdmin.listRoles()
      expect(roles).to.include(SOLR_ADMIN)
    })

    describe('allowed', () => {
      for (const { userId, reason } of allowedUsers) {
        it(`${userId} (${reason}) can run the full reindex`, async () => {
          const execDesc = await statebox.startExecution(
            {},
            FULL_REINDEX,
            { sendResponse: 'COMPLETE', userId }
          )

          expect(execDesc.stateMachineName).to.eql(FULL_REINDEX)
          expect(execDesc.status).to.eql('SUCCEEDED')
        })
      }
    })

    describe('disallowed', () => {
      for (const { userId, reason } of disallowedUsers) {
        it(`${userId} (${reason}) gets NOAUTH`, async () => {
          const execDesc = await statebox.startExecution(
            {},
            FULL_REINDEX,
            { sendResponse: 'COMPLETE', userId }
          )

          expect(execDesc.stateMachineName).to.eql(FULL_REINDEX)
          expect(execDesc.status).to.eql('NOAUTH')
          expect(execDesc.errorCode).to.eql('401')
        })
      }
    })

    describe('search is unaffected', () => {
      it('a logged-in user with no roles can still search', async () => {
        const allowed = await rbac.checkAuthorization('jim.smith', null, 'stateMachine', SEARCH, 'create')
        expect(allowed).to.eql(true)
      })

      it('a logged-in user with no roles still cannot reindex', async () => {
        const allowed = await rbac.checkAuthorization('jim.smith', null, 'stateMachine', FULL_REINDEX, 'create')
        expect(allowed).to.eql(false)
      })
    })

    after('remove test users, shutdown Tymly and restore Solr env vars', async () => {
      if (rbacAdmin) {
        for (const userId of ['solr-admin', 'ops-lead', 'super-admin', 'reader']) {
          await rbacAdmin.clearUserRoles(userId)
        }
      }

      if (tymlyService) await tymlyService.shutdown()

      for (const key of SOLR_ENV_VARS) {
        if (savedSolrEnv[key] === undefined) {
          delete process.env[key]
        } else {
          process.env[key] = savedSolrEnv[key]
        }
      }
    })
  })
})
