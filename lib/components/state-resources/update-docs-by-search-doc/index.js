const solr = require('solr-client')
const { camelCase, snakeCase } = require('lodash')

class UpdateDocsBySearchDoc {
  init (resourceConfig, env) {
    this.services = env.bootedServices
    this.client = this.services.storage.client

    const { searchDocs, models, views } = env.blueprintComponents

    this.searchDoc = searchDocs[resourceConfig.searchDoc]
    if (!this.searchDoc) {
      throw new Error(`Cannot find search doc: ${resourceConfig.searchDoc}`)
    }

    this.model = this.searchDoc.modelId ? models[this.searchDoc.modelId] : views[this.searchDoc.viewId]
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

  async run (event, context) {
    if (!this.solrClient) {
      this.logger.error('UpdateDocBySearchDoc - No solr client')
      return context.sendTaskSuccess()
    }

    const docIds = Array.isArray(event) ? event : [event]

    for (const docId of docIds) {
      let docIdValue = ''

      const columns = this.services.solr.solrSchemaFields.map(f => {
        const solrFieldName = f[0]
        const defaultValue = f[1]
        let mappedValue = this.searchDoc.attributeMapping[solrFieldName] || ''
        if (mappedValue[0] === '@') {
          mappedValue = snakeCase(mappedValue.substring(1))
        }

        if (solrFieldName === 'docId') {
          docIdValue = mappedValue || defaultValue
        }

        return `${mappedValue || defaultValue} AS ${snakeCase(solrFieldName)}`
      })

      const doc = await this.client.query(`SELECT ${columns.join(', ')} FROM ${snakeCase(this.model.namespace)}.${snakeCase(this.model.id)} WHERE ${docIdValue} = '${docId}' ORDER BY modified DESC;`)

      try {
        await this.delete(docId)
      } catch (err) {
        context.sendTaskFailure({ error: `UpdateDocBySearchDoc - failed to delete ${docId}`, cause: err })
      }

      if (doc.rows.length > 0) {
        const data = {}

        Object.keys(doc.rows[0]).forEach(key => { data[camelCase(key)] = doc.rows[0][key] })

        try {
          await this.add(data)
        } catch (err) {
          context.sendTaskFailure({ error: `UpdateDocBySearchDoc - failed to add ${docId}`, cause: err })
        }
      }
    }

    this.solrClient.commit(err => {
      if (err) {
        context.sendTaskFailure({ error: 'UpdateDocBySearchDoc - failed to commit', cause: err })
      } else {
        context.sendTaskSuccess()
      }
    })
  } // run

  add (doc) {
    this.logger.debug(`Adding ${JSON.stringify(doc)}`)

    return new Promise((resolve, reject) => {
      this.solrClient.add(doc, err => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  delete (docId) {
    this.logger.debug(`Deleting ${docId}`)

    return new Promise((resolve, reject) => {
      this.solrClient.deleteByQuery(`docId:${docId}`, err => {
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }
}

module.exports = UpdateDocsBySearchDoc
