const solr = require('solr-client')
const { camelCase, snakeCase } = require('lodash')
const debug = require('debug')('solr')
const defaultSolrSchemaFields = require('./../../services/solr/solr-schema-fields.json')

class UpdateDocsBySearchDoc {
  init (resourceConfig, env, callback) {
    this.services = env.bootedServices
    this.client = this.services.storage.client

    const { searchDocs, models, views } = env.blueprintComponents

    this.searchDoc = searchDocs[resourceConfig.searchDoc]
    if (!this.searchDoc) {
      return callback(new Error(`Cannot find search doc: ${resourceConfig.searchDoc}`))
    }

    this.model = this.searchDoc.modelId ? models[this.searchDoc.modelId] : views[this.searchDoc.viewId]

    // todo: this would be best to get from solr service but doesn't seem to be accessible from here
    this.solrSchemaFields = defaultSolrSchemaFields.map(f => [f, f])

    callback(null)
  } // init

  async run (event, context) {
    const docIds = Array.isArray(event) ? event : [event]

    for (const docId of docIds) {
      let docIdValue = ''

      const columns = this.solrSchemaFields.map(f => {
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
    debug('Adding', doc)

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
    debug('Deleting', docId)

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

module.exports = UpdateDocsBySearchDoc
