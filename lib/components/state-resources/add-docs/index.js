const solrSchemaFields = require('../../services/solr/solr-schema-fields.json')
const solr = require('solr-client')

class AddDocs {
  init (resourceConfig, env) {
    this.schema = require('./schema.json')
    this.services = env.bootedServices
  }

  run (event, context) {
    const now = new Date()
    const data = Array.isArray(event) ? event : [event]
    const docs = data.map(d => {
      return solrSchemaFields.reduce((doc, key) => {
        const value = d[key]

        if (value === null || value === undefined) {
          // todo: check if required
        } else if (value === '$NOW') {
          doc[key] = now
        } else {
          doc[key] = value
        }

        return doc
      }, {})
    })

    this.solrClient.add(docs, (err) => {
      if (err) return context.sendTaskFailure({ error: 'addDocsFail', cause: err })

      this.solrClient.commit((err, obj) => {
        if (err) return context.sendTaskFailure({ error: 'addDocsFail', cause: err })

        context.sendTaskSuccess()
      })
    })
  }

  get solrClient () {
    if (this.solrClient_) return this.solrClient_

    const { host, port, path } = this.services.solr.solrConnection
    this.solrClient_ = solr.createClient({ host, port, path, collection: 'tymly' })
    this.solrClient_.autoCommit = true

    return this.solrClient_
  }
}

module.exports = AddDocs
