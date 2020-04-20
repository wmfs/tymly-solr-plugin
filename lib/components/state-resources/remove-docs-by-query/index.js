const solr = require('solr-client')
const debug = require('debug')('solr')

class removeDocs {
  init (resourceConfig, env) {
    this.schema = require('./schema.json')
    this.services = env.bootedServices
    this.query = resourceConfig.query
  } // init

  run (event, context) {
    const query = Object.keys(this.query).map(q => `${q}:${this.query[q]}`)

    debug(`Deleteing docs where ${query.join(' AND ')}`)

    this.solrClient.deleteByQuery(query.join(' AND '), (err, obj) => {
      if (err) {
        return context.sendTaskFailure({ error: 'removeDocsFail', cause: err })
      }

      this.solrClient.commit((err, res) => {
        if (err) {
          return context.sendTaskFailure({ error: 'removeDocsFail', cause: err })
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

module.exports = removeDocs
