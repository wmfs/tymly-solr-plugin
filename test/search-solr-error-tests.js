/* eslint-env mocha */
'use strict'

const http = require('http')
const expect = require('chai').expect
const Search = require('../lib/components/state-resources/search')
const { SolrClient } = require('../lib/util/solr-client')

// The search state resource against a Solr that only returns errors: the search fails, Tymly keeps running.
describe('search when Solr returns an error', function () {
  let server, search, status

  before(done => {
    server = http.createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { msg: `failed with ${status}` } }))
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const logged = []
      const solr = {
        solrUrl: 'http://fake',
        client: new SolrClient({ host: '127.0.0.1', port: server.address().port, path: '/solr', timeout: 1000 }),
        searchDocs: null,
        solrSchemaFields: [],
        logger: { error: m => logged.push(m), warn: () => {}, debug: () => {} }
      }
      search = new Search()
      search.init({}, {
        bootedServices: {
          solr,
          rbac: { listUserRoles: async () => [] },
          storage: { client: null, models: {} },
          categories: { categories: {} }
        }
      })
      search.logged = logged
      done()
    })
  })

  after(done => server.close(done))

  for (const code of [400, 500]) {
    it(`Solr ${code}: the search fails with searchFail and the process keeps running`, async () => {
      status = code
      let crashed = false
      const onCrash = () => { crashed = true }
      process.on('uncaughtException', onCrash)

      const outcome = await new Promise(resolve => {
        search.run({ query: 'kebab]' }, {
          userId: 'test-user',
          sendTaskSuccess: output => resolve({ success: output }),
          sendTaskFailure: failure => resolve({ failure })
        })
      })
      await new Promise(resolve => setTimeout(resolve, 50))
      process.removeListener('uncaughtException', onCrash)

      expect(outcome.failure.error).to.eql('searchFail')
      expect(outcome.failure.cause.status).to.eql(code)
      expect(search.logged.pop()).to.include(`failed with ${code}`)
      expect(crashed).to.eql(false)
    })
  }
})
