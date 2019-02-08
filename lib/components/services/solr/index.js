'use strict'

const debug = require('debug')('@wmfs/tymly-solr-plugin')
const _ = require('lodash')
const process = require('process')
const boom = require('boom')
const request = require('request')
const defaultSolrSchemaFields = require('./solr-schema-fields.json')

class SolrService {
  async boot (options, callback) {
    this.solrConnection = SolrService._solrConnection(options.config)
    this.solrUrl = this.solrConnection ? `http://${this.solrConnection.host}:${this.solrConnection.port}${this.solrConnection.path}` : null
    options.messages.info(this.solrUrl ? `Using Solr... (${this.solrUrl})` : 'No Solr URL configured')

    if (!options.blueprintComponents.searchDocs) {
      options.messages.info('No search-docs configuration found')
      this.solrSchemaFields = []
      this.createViewSQL = null
      return callback(null)
    } // if ...

    const storageClient = options.bootedServices.storage.client
    if (!storageClient) {
      callback(boom.notFound('failed to boot solr service: no database client available'))
    }

    if (options.config.solrSchemaFields === undefined) {
      this.solrSchemaFields = SolrService.constructSolrSchemaFieldsArray(defaultSolrSchemaFields)
    } else {
      this.solrSchemaFields = SolrService.constructSolrSchemaFieldsArray(options.config.solrSchemaFields)
    }
    debug('solrSchemaFields', this.solrSchemaFields)

    this.searchDocs_ = options.blueprintComponents.searchDocs

    this.createViewSQL = this.buildCreateViewStatement(
      SolrService.constructModelsArray(options.blueprintComponents.models),
      SolrService.constructSearchDocsArray(this.searchDocs_))

    if (!this.createViewSQL) {
      callback(boom.notFound('failed to construct create view SQL'))
    }

    try {
      await storageClient.query('DROP VIEW IF EXISTS tymly.solr_data', [])
      await storageClient.query(this.createViewSQL, [])
      callback()
    } catch (err) {
      callback(err)
    }
  } // boot

  get searchDocs () { return this.searchDocs_ }

  static _solrConnection (config) {
    const solrConfig = config.solr || {}

    const host = solrConfig.host || process.env.SOLR_HOST
    const port = solrConfig.port || process.env.SOLR_PORT
    const path = solrConfig.path || process.env.SOLR_PATH

    if (host && port && path) {
      return {
        host: host,
        port: port,
        path: path
      }
    }

    debug('No Solr config found in config.solr or in environment variable')
    return null
  } // _connectionUrl

  static constructModelsArray (models) {
    return Object.values(models)
  } // constructModelsArray

  static constructSearchDocsArray (searchDocs) {
    return Object.values(searchDocs)
  } // constructSearchDocsArray

  static constructSolrSchemaFieldsArray (fields) {
    return fields.map(f => [f, f])
  } // constructSolrSchemaFieldsArray

  buildSelectStatement (model, searchDoc) {
    const columns = this.solrSchemaFields.map(
      solrDefault => {
        const solrFieldName = solrDefault[0]
        const defaultValue = solrDefault[1]
        let mappedValue = searchDoc.attributeMapping[solrFieldName] || ''
        if (mappedValue[0] === '@') {
          mappedValue = _.snakeCase(mappedValue.substring(1))
        }
        return `${mappedValue || defaultValue} AS ${_.snakeCase(solrFieldName)}`
      }
    )

    return `SELECT ${columns.join(', ')} FROM ${_.snakeCase(model.namespace)}.${_.snakeCase(model.id)}`
  } // buildSelectStatement

  buildCreateViewStatement (models, searchDocs) {
    const selects = []
    for (let model of models) {
      const modelId = `${_.camelCase(model.namespace)}_${model.id}`
      debug(` - model ${modelId}`)
      let currentSearchDoc = null
      for (let searchDoc of searchDocs) {
        const searchDocId = `${_.camelCase(searchDoc.namespace)}_${searchDoc.id}`
        debug('   - searchDoc', searchDocId)
        if (searchDocId === modelId) {
          currentSearchDoc = searchDoc
          debug(`     > Corresponding searchDoc '${searchDocId}' found for model '${modelId}'!`)
          break
        }
      }
      if (currentSearchDoc !== null) {
        selects.push(this.buildSelectStatement(model, currentSearchDoc))
      }
    }

    if (selects.length !== 0) {
      return `CREATE OR REPLACE VIEW tymly.solr_data AS \n${selects.join('\nUNION\n')};`
    } else {
      return null
    }
  } // buildCreateViewStatement

  executeSolrFullReindex (core, cb) {
    this._executeReindex('full-import', core, cb)
  } // executeSolrFullReindex

  executeSolrDeltaReindex (core, cb) {
    this._executeReindex('delta-import', core, cb)
  } // executeSolrFullReindex

  _executeReindex (type, core, cb) {
    if (!this.solrUrl) {
      return cb(null)
    }

    request.post(
      buildDataImportPost(this.solrUrl, type, core),
      (err, response, body) => (err) ? cb(err) : cb(null, JSON.parse(body))
    )
  } // _executeReindex
} // class SolrService

function buildDataImportPost (solrUrl, command, core) {
  const uniqueIdentifier = new Date().getTime()
  let clean = true
  if (command === 'delta-import') {
    clean = false
  }
  let url = solrUrl
  if (solrUrl[solrUrl.length - 1] !== '/') {
    url += '/'
  }
  return {
    url: `${url}${core}/dataimport?_=${uniqueIdentifier}&indent=off&wt=json`,
    form: {
      'clean': clean,
      'command': command,
      'commit': true,
      'core': core,
      'name': 'dataimport',
      'optimize': false,
      'verbose': false
    }
  }
} // buildDataImportPost

module.exports = {
  serviceClass: SolrService,
  bootAfter: ['storage']
}
