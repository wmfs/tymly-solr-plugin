'use strict'

const debug = require('debug')('solr')
const _ = require('lodash')
const process = require('process')
const axios = require('axios')
const defaultSolrSchemaFields = require('./solr-schema-fields.json')

class SolrService {
  async boot (options) {
    this.solrConnection = SolrService._solrConnection(options.config)
    this.solrUrl = this.solrConnection ? `http://${this.solrConnection.host}:${this.solrConnection.port}${this.solrConnection.path}` : null
    options.messages.info(this.solrUrl ? `Using Solr... (${this.solrUrl})` : 'No Solr URL configured')

    if (!options.blueprintComponents.searchDocs) {
      options.messages.info('No search-docs configuration found')
      this.solrSchemaFields = []
      this.createViewSQL = null
      return
    } // if ...

    const storageClient = options.bootedServices.storage.client
    if (!storageClient) {
      throw new Error('failed to boot solr service: no database client available')
    }

    this.solrSchemaFields = SolrService.constructSolrSchemaFieldsArray(
      options.config.solrSchemaFields || defaultSolrSchemaFields
    )
    debug('solrSchemaFields', this.solrSchemaFields)

    this.searchDocs_ = options.blueprintComponents.searchDocs

    this.createViewSQL = this.buildCreateViewStatement(
      SolrService.constructModelsArray(options.blueprintComponents.models, options.blueprintComponents.views),
      SolrService.constructSearchDocsArray(this.searchDocs_)
    )

    if (!this.createViewSQL) {
      throw new Error('failed to construct create view SQL')
    }

    await storageClient.query('DROP VIEW IF EXISTS tymly.solr_data', [])
    debug('createViewSQL', this.createViewSQL)
    await storageClient.query(this.createViewSQL, [])
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

  static constructModelsArray (models, views) {
    const arr = []

    if (models) arr.push(...Object.values(models))
    if (views) arr.push(...Object.values(views))

    return arr
    // return Object.values(models)
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
    const selects = searchDocs
      .map(sd => {
        const modelId = sd.modelId || sd.viewId
        return {
          searchDoc: sd,
          model: models.find(m => (`${m.namespace}_${m.id}` === modelId))
        }
      })
      .filter(msd => msd.model)
      .map(msd => this.buildSelectStatement(msd.model, msd.searchDoc))

    return (selects.length !== 0)
      ? `CREATE OR REPLACE VIEW tymly.solr_data AS \n${selects.join('\nUNION ALL\n')};`
      : null
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

    const { url, form } = buildDataImportPost(this.solrUrl, type, core)

    axios({ method: 'post', url, params: form })
      .then(response => response.data)
      .then(body => cb(null, body))
      .catch(err => cb(err))
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
      clean: clean,
      command: command,
      commit: true,
      core: core,
      name: 'dataimport',
      optimize: false,
      verbose: false
    }
  }
} // buildDataImportPost

module.exports = {
  serviceClass: SolrService,
  bootAfter: ['storage']
}
