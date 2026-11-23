/* eslint-env mocha */
'use strict'

const http = require('http')
const expect = require('chai').expect
const { SolrClient, SolrError } = require('../lib/util/solr-client')

// A fake Solr: records each request and replies with whatever the test sets
function fakeSolr () {
  const fake = { requests: [], reply: { status: 200, body: { responseHeader: { status: 0 } } } }
  fake.server = http.createServer((req, res) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => {
      fake.requests.push({ method: req.method, url: req.url, headers: req.headers, body })
      const { status, body: replyBody, delayMs = 0 } = fake.reply
      setTimeout(() => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(typeof replyBody === 'string' ? replyBody : JSON.stringify(replyBody))
      }, delayMs)
    })
  })
  return fake
}

describe('Solr client', function () {
  let fake, client, port

  before(done => {
    fake = fakeSolr()
    fake.server.listen(0, '127.0.0.1', () => {
      port = fake.server.address().port
      client = new SolrClient({ host: '127.0.0.1', port, path: '/solr', core: 'tymly', timeout: 500 })
      done()
    })
  })

  after(done => fake.server.close(done))

  beforeEach(() => {
    fake.requests = []
    fake.reply = { status: 200, body: { responseHeader: { status: 0 } } }
  })

  describe('requests', () => {
    it('search: POSTs a form to /select, repeating array values, and returns the response', async () => {
      fake.reply.body = { response: { numFound: 1, docs: [{ id: 'a' }] } }

      const result = await client.search({ q: 'Uday\'s & co', fq: ['roles:("a")', 'domain:"search"'], rows: 10, start: 0, sort: undefined })

      expect(result.response.numFound).to.eql(1)
      const [req] = fake.requests
      expect(req.method).to.eql('POST')
      expect(req.url).to.eql('/solr/tymly/select')
      expect(req.headers['content-type']).to.include('application/x-www-form-urlencoded')
      const form = new URLSearchParams(req.body)
      expect(form.get('q')).to.eql('Uday\'s & co')
      expect(form.getAll('fq')).to.eql(['roles:("a")', 'domain:"search"'])
      expect(form.get('wt')).to.eql('json')
      expect(form.has('sort')).to.eql(false)
    })

    it('a long search is sent in the body, not the URL', async () => {
      await client.search({ q: 'x'.repeat(20000) })
      expect(fake.requests[0].url).to.eql('/solr/tymly/select')
    })

    it('add, deleteByQuery and commit POST JSON to /update', async () => {
      await client.add([{ id: 'a' }])
      await client.add({ id: 'b' })
      await client.deleteByQuery('docId:"x"')
      await client.commit()

      expect(fake.requests.map(r => r.url)).to.eql(Array(4).fill('/solr/tymly/update?wt=json'))
      expect(fake.requests.map(r => JSON.parse(r.body))).to.eql([
        [{ id: 'a' }],
        [{ id: 'b' }],
        { delete: { query: 'docId:"x"' } },
        { commit: {} }
      ])
    })
  })

  describe('errors never crash the process', () => {
    let crashed
    const onCrash = () => { crashed = true }

    beforeEach(() => {
      crashed = false
      process.on('uncaughtException', onCrash)
    })

    afterEach(() => process.removeListener('uncaughtException', onCrash))

    const expectSolrError = async (call, check) => {
      let error
      try {
        await call()
      } catch (err) {
        error = err
      }
      expect(error, 'should reject').to.be.instanceOf(SolrError)
      check(error)
      // the old client threw from inside its HTTP handler a moment later, so wait a moment too
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(crashed, 'uncaught exception').to.eql(false)
    }

    it('400 with Solr\'s error message (e.g. a bad query) rejects', async () => {
      fake.reply = { status: 400, body: { error: { msg: 'org.apache.solr.search.SyntaxError: Cannot parse \'kebab]\'', code: 400 } } }
      await expectSolrError(() => client.search({ q: 'kebab]' }), err => {
        expect(err.status).to.eql(400)
        expect(err.message).to.include('Cannot parse')
      })
    })

    it('500 rejects, for updates too', async () => {
      fake.reply = { status: 500, body: { error: { msg: 'Server error' } } }
      await expectSolrError(() => client.add([{ id: 'a' }]), err => expect(err.status).to.eql(500))
      await expectSolrError(() => client.deleteByQuery('*:*'), err => expect(err.status).to.eql(500))
      await expectSolrError(() => client.commit(), err => expect(err.status).to.eql(500))
    })

    it('a 404 HTML page (wrong path or core) rejects', async () => {
      fake.reply = { status: 404, body: '<html>Not Found</html>' }
      await expectSolrError(() => client.search({ q: 'x' }), err => expect(err.status).to.eql(404))
    })

    it('Solr not running rejects', async () => {
      const nobody = new SolrClient({ host: '127.0.0.1', port: 1, path: '/solr', timeout: 500 })
      await expectSolrError(() => nobody.search({ q: 'x' }), err => {
        expect(err.status).to.eql(null)
        expect(err.code).to.eql('ECONNREFUSED')
      })
    })

    it('Solr too slow rejects after the timeout', async () => {
      fake.reply = { status: 200, body: {}, delayMs: 1500 }
      await expectSolrError(() => client.search({ q: 'x' }), err => expect(err.message).to.include('timed out'))
    })
  })

  it('the error can be logged and sent as a task failure cause', () => {
    const err = new SolrError('Solr 400: bad', { status: 400 })
    expect(JSON.parse(JSON.stringify(err))).to.eql({ name: 'SolrError', message: 'Solr 400: bad', status: 400, code: null })
  })
})
