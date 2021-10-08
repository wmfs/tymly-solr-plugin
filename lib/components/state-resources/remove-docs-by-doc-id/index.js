const solr = require('solr-client')
const debug = require('debug')('solr')

class RemoveDocsByDocId {
  init (resourceConfig, env) {
    this.services = env.bootedServices
  } // init

  run (event, context) {
    if (!this.solrClient) {
      console.error('UpdateDocBySearchDoc - No solr client')
      return context.sendTaskSuccess()
    }

    const docIds = Array.isArray(event) ? event : [event]

    if (!docIds.length) return context.sendTaskSuccess()

    const query = docIds.map(docId => `docId:${docId}`)

    debug(`Deleting docs where ${query.join(' AND ')}`)

    this.solrClient.deleteByQuery(query.join(' AND '), (err, obj) => {
      if (err) {
        return context.sendTaskFailure({ error: 'RemoveDocsByDocIdFail', cause: err })
      }

      this.solrClient.commit((err, res) => {
        if (err) {
          return context.sendTaskFailure({ error: 'RemoveDocsByDocIdFail', cause: err })
        }

        context.sendTaskSuccess()
      })
    })
  } // run

  get solrClient () {
    if (this.solrClient_) {
      return this.solrClient_
    }

    const { host, port, path } = this.services.solr.solrConnection

    this.solrClient_ = solr.createClient({
      host,
      port,
      path,
      core: 'tymly'
    })

    return this.solrClient_
  } // solrClient
}

module.exports = RemoveDocsByDocId
