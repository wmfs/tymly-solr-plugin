const solr = require('solr-client')

class RemoveDocsByDocId {
  init (resourceConfig, env) {
    this.services = env.bootedServices
  } // init

  get solr () { return this.services.solr }

  get logger () { return this.solr.logger }

  get solrClient () {
    if (this.solrClient_) {
      return this.solrClient_
    }

    try {
      const solrConnection = this.solr.solrConnection
      this.solrClient_ = solr.createClient({
        host: solrConnection.host,
        port: solrConnection.port,
        path: solrConnection.path,
        collection: 'tymly'
      })

      return this.solrClient_
    } catch (err) {
      this.logger.warn(`No solr client, error: ${JSON.stringify(err)}`)
    }
  }

  run (event, context) {
    if (!this.solrClient) {
      this.logger.error('UpdateDocBySearchDoc - No solr client')
      return context.sendTaskSuccess()
    }

    const docIds = Array.isArray(event) ? event : [event]

    if (!docIds.length) return context.sendTaskSuccess()

    const query = docIds.map(docId => `docId:${docId}`)

    this.logger.debug(`Deleting docs where ${query.join(' OR ')}`)

    this.solrClient.deleteByQuery(query.join(' OR '), (err, obj) => {
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
}

module.exports = RemoveDocsByDocId
