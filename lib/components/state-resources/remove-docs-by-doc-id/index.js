class RemoveDocsByDocId {
  init (resourceConfig, env) {
    this.services = env.bootedServices
  } // init

  get solr () { return this.services.solr }

  get logger () { return this.solr.logger }

  // shared client from the solr service; null when no Solr is configured
  get solrClient () { return this.solr.client }

  async run (event, context) {
    if (!this.solrClient) {
      this.logger.error('UpdateDocBySearchDoc - No solr client')
      return context.sendTaskSuccess()
    }

    const docIds = Array.isArray(event) ? event : [event]

    if (!docIds.length) return context.sendTaskSuccess()

    const query = docIds.map(docId => `docId:${docId}`)

    this.logger.debug(`Deleting docs where ${query.join(' OR ')}`)

    try {
      await this.solrClient.deleteByQuery(query.join(' OR '))
      await this.solrClient.commit()
    } catch (err) {
      return context.sendTaskFailure({ error: 'RemoveDocsByDocIdFail', cause: err })
    }

    context.sendTaskSuccess()
  } // run
}

module.exports = RemoveDocsByDocId
