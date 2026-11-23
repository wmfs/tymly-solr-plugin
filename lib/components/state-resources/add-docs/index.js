const solrSchemaFields = require('../../services/solr/solr-schema-fields.json')

class AddDocs {
  init (resourceConfig, env) {
    this.schema = require('./schema.json')
    this.services = env.bootedServices
  }

  async run (event, context) {
    if (!this.solrClient) {
      this.services.solr.logger.warn('addDocs - no Solr configured, nothing added')
      return context.sendTaskSuccess()
    }

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

    try {
      await this.solrClient.add(docs)
      await this.solrClient.commit()
    } catch (err) {
      return context.sendTaskFailure({ error: 'addDocsFail', cause: err })
    }

    context.sendTaskSuccess()
  }

  // shared client from the solr service; null when no Solr is configured
  get solrClient () { return this.services.solr.client }
}

module.exports = AddDocs
