class RemoveDocsByQuery {
  init (resourceConfig, env) {
    this.schema = require('./schema.json')
    this.services = env.bootedServices
    this.query = resourceConfig.query
  } // init

  get solr () { return this.services.solr }

  get logger () { return this.solr.logger }

  // shared client from the solr service; null when no Solr is configured
  get solrClient () { return this.solr.client }

  async run (event, context) {
    if (!this.solrClient) {
      this.logger.error('RemoveDocsByQuery - no Solr configured')
      return context.sendTaskSuccess()
    }

    const query = Object.keys(this.query).map(q => `${q}:${this.query[q]}`)

    this.logger.debug(`Deleting docs where ${query.join(' AND ')}`)

    try {
      await this.solrClient.deleteByQuery(query.join(' AND '))
      await this.solrClient.commit()
    } catch (err) {
      return context.sendTaskFailure({ error: 'RemoveDocsByQueryFail', cause: err })
    }

    context.sendTaskSuccess()
  } // run
}

module.exports = RemoveDocsByQuery
