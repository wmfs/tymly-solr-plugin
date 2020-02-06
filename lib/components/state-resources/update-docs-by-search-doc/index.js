const solr = require('solr-client')
const { camelCase } = require('lodash')
const debug = require('debug')('solr')

class UpdateDocsBySearchDoc {
  init (resourceConfig, env, callback) {
    this.client = env.bootedServices.storage.client
    this.services = env.bootedServices
    this.searchDoc = env.blueprintComponents.searchDocs[resourceConfig.searchDoc]
    if (!this.searchDoc) {
      return callback(new Error(`Cannot find search doc: ${resourceConfig.searchDoc}`))
    }
    callback(null)
  } // init

  async run (event, context) {
    const docIds = Array.isArray(event) ? event : [event]

    for (const docId of docIds) {
      // todo: use search doc to query specific table/view as tymly.solr_data is slow to query
      const doc = await this.client.query(`select * from tymly.solr_data where doc_id = '${docId}' order by modified desc;`)

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
