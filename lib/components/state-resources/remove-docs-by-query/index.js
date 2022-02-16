const solr = require('solr-client')

class RemoveDocsByQuery {
  init (resourceConfig, env) {
    this.schema = require('./schema.json')
    this.services = env.bootedServices
    this.query = resourceConfig.query
  } // init

  get solr () { return this.services.solr }

  get logger () { return this.solr.logger }

  get solrClient () {
    if (this.solrClient_) {
      return this.solrClient_
    }

    const solrConnection = this.solr.solrConnection
    this.solrClient_ = solr.createClient({
      host: solrConnection.host,
      port: solrConnection.port,
      path: solrConnection.path,
      core: 'tymly'
    })

    return this.solrClient_
  }

  run (event, context) {
    const query = Object.keys(this.query).map(q => `${q}:${this.query[q]}`)

    this.logger.debug(`Deleting docs where ${query.join(' AND ')}`)

    this.solrClient.deleteByQuery(query.join(' AND '), (err, obj) => {
      if (err) {
        return context.sendTaskFailure({ error: 'RemoveDocsByQueryFail', cause: err })
      }

      this.solrClient.commit((err, res) => {
        if (err) {
          return context.sendTaskFailure({ error: 'RemoveDocsByQueryFail', cause: err })
        }

        context.sendTaskSuccess()
      })
    })
  } // run
}

module.exports = RemoveDocsByQuery
