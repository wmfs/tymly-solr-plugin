'use strict'

const _ = require('lodash')
const process = require('process')
const defaultSolrSchemaFields = require('./solr-schema-fields.json')
const { loadRelevanceSettings } = require('../../state-resources/search/relevance')
const { SolrClient, DEFAULT_TIMEOUT_MS } = require('../../../util/solr-client')
const { resolveSearchDocs } = require('../../../util/search-doc-replacements')

class SolrService {
  async boot (options) {
    this.logger = options.bootedServices.logger.child('service:solr')
    this.solrConnection = SolrService._solrConnection(options.config)
    this.client = this.solrConnection ? SolrService._client(options.config, this.solrConnection) : null
    this.solrUrl = this.solrConnection ? `http://${this.solrConnection.host}:${this.solrConnection.port}${this.solrConnection.path}` : null
    options.messages.info(this.solrUrl ? `Using Solr... (${this.solrUrl})` : 'No Solr URL configured')

    this.searchRelevance = loadRelevanceSettings(
      options.blueprintComponents.searchRelevance,
      warning => this.logger.warn(warning)
    )

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
    this.logger.debug(`solrSchemaFields: ${JSON.stringify(this.solrSchemaFields)}`)

    const { active, replacedBy, missingTargets } = resolveSearchDocs(options.blueprintComponents.searchDocs)
    this.searchDocs_ = active
    this.replacedSearchDocs = replacedBy
    for (const [replaced, replacing] of Object.entries(replacedBy)) {
      if (missingTargets[replacing]) continue
      options.messages.info(`Search doc ${replaced} is replaced by ${replacing}`)
    }
    for (const [replacing, target] of Object.entries(missingTargets)) {
      this.logger.warn(`Search doc ${replacing} replaces ${target}, but no loaded blueprint has a search doc called ${target}. Check the name in "replaces".`)
    }

    this.createViewSQL = this.buildCreateViewStatement(
      SolrService.constructModelsArray(options.blueprintComponents.models, options.blueprintComponents.views),
      SolrService.constructSearchDocsArray(this.searchDocs_)
    )

    if (!this.createViewSQL) {
      throw new Error('failed to construct create view SQL')
    }

    await storageClient.query('DROP VIEW IF EXISTS tymly.solr_data', [])
    this.logger.debug(`createViewSQL: ${this.createViewSQL}`)
    await storageClient.query(this.createViewSQL, [])
  } // boot

  get searchDocs () { return this.searchDocs_ }

  /**
   * The one Solr client every state resource uses. Core and timeout can be set in config.solr
   * or with SOLR_CORE / SOLR_TIMEOUT_MS; they default to 'tymly' and 30 seconds.
   */
  static _client (config, connection) {
    const solrConfig = config.solr || {}
    const timeout = Number(solrConfig.timeoutMs || process.env.SOLR_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS

    return new SolrClient({
      ...connection,
      core: solrConfig.core || process.env.SOLR_CORE || 'tymly',
      timeout
    })
  } // _client

  static _solrConnection (config) {
    const solrConfig = config.solr || {}

    const host = solrConfig.host || process.env.SOLR_HOST
    const port = solrConfig.port || process.env.SOLR_PORT
    const path = solrConfig.path || process.env.SOLR_PATH

    if (host && port && path) {
      return {
        host,
        port,
        path
      }
    }

    console.log('No Solr config found in config.solr or in environment variable')
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
      .filter(msd => {
        if (msd.model) return true
        const modelId = msd.searchDoc.modelId || msd.searchDoc.viewId
        // A replacing doc that can't be indexed would take the doc it replaces out of search with it
        // (e.g. a blueprint released before the one that provides its view), so stop rather than lose them.
        if (msd.searchDoc.replaces) {
          throw new Error(`Search doc replacing ${msd.searchDoc.replaces} uses ${modelId}, but no loaded model or view has that name. Release the blueprint that provides it first.`)
        }
        if (this.logger) this.logger.warn(`A search doc uses ${modelId}, but no loaded model or view has that name, so it isn't indexed`)
        return false
      })
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

    // through the shared client, so a hung Solr times out (SOLR_TIMEOUT_MS) instead of waiting forever
    this.client.request({ method: 'post', url, params: form })
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
      clean,
      command,
      commit: true,
      core,
      name: 'dataimport',
      optimize: false,
      verbose: false
    }
  }
} // buildDataImportPost

module.exports = {
  serviceClass: SolrService,
  bootAfter: ['storage', 'pgScript']
}
