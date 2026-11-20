'use strict'

const _ = require('lodash')
const solr = require('solr-client')
const defaultSolrSchemaFields = require('./solr-schema-fields.json')
const buildSolrQuery = require('./build-solr-query')
const buildStorageQuery = require('./build-storage-query')
const { InvalidSearchInputError } = require('./escape')
const { logSearch } = require('./search-log')

class Search {
  init (resourceConfig, env) {
    this.storageClient = env.bootedServices.storage.client
    this.services = env.bootedServices
  }

  get categories () { return this.services.categories.categories }

  get rbac () { return this.services.rbac }

  get solr () { return this.services.solr }

  get logger () { return this.solr.logger }

  get solrClient () {
    if (this.solrClient_) {
      return this.solrClient_
    }

    try {
      const solrConnection = this.solr.solrConnection
      this.solrClient_ = solr.createClient({
        host: solrConnection.host,
        port: solrConnection.port,
        path: solrConnection.path,
        core: 'tymly'
      })

      return this.solrClient_
    } catch (err) {
      this.logger.warn(`No solr client, error: ${JSON.stringify(err)}`)
    }
  }

  async run (event, context) {
    if (!context.userId) {
      return context.sendTaskFailure({
        error: 'noUserIdSearchFail',
        cause: 'No user ID found when trying to search.'
      })
    } // if ...

    try {
      const userRoles = await this.listUserRoles(context)

      const searchFields = this.buildSearchFields()

      const filters = this.processFilters(event)

      const searchSource = this.solr.solrUrl
        ? this.runSolrSearch
        : this.runStorageSearch

      const started = Date.now()
      const [results, count] =
        await searchSource.bind(this)(
          event,
          searchFields,
          filters,
          userRoles
        )
      const durationMs = Date.now() - started

      const processedResults =
        await this.processResults(
          context,
          results,
          filters,
          count
        )

      processedResults.searchLogId = await this.logSearch(context, filters, count, durationMs)

      context.sendTaskSuccess({
        searchResults: processedResults
      })
    } catch (err) {
      if (err instanceof InvalidSearchInputError) {
        return context.sendTaskFailure({
          error: 'invalidSearchInput',
          cause: err.message
        })
      }

      this.logger.error(`Search fail: ${JSON.stringify(err)}`)
      context.sendTaskFailure({
        error: 'searchFail',
        cause: err
      })
    } // catch
  } // run

  async listUserRoles (context) {
    const userRoles = await this.rbac.listUserRoles(context.userId)

    if (!userRoles.includes('$authenticated')) userRoles.push('$authenticated')

    return userRoles
  } // listUserRoles

  buildSearchFields () {
    const allSearchFields = this.findSearchFields()
    const wantedFields = allSearchFields
      .filter(f =>
        f !== 'modified' &&
        f !== 'created' &&
        f !== 'eventTimestamp' &&
        f !== 'point' &&
        f !== 'classification' &&
        f !== 'icon' &&
        f !== 'synopsis' &&
        f !== 'x' &&
        f !== 'y' &&
        f !== 'activeEvent' &&
        f !== 'category' &&
        f !== 'rating' &&
        f !== 'data' &&
        f !== 'docType'
      )
    const snaked = wantedFields.map(f => _.snakeCase(f))
    return snaked
  } // buildSearchFields

  findSearchFields () {
    if (!this.solr.searchDocs) {
      return defaultSolrSchemaFields
    }

    const searchFields = new Set()
    const searchDocs = this.solr.searchDocs

    Object.keys(searchDocs).forEach(s => {
      Object.keys(searchDocs[s].attributeMapping).forEach(a => {
        searchFields.add(a)
      })
    })

    return [...searchFields]
  } // buildSearchFields

  runSolrSearch (
    event,
    searchFields,
    filters,
    userRoles
  ) {
    const params = buildSolrQuery({
      event,
      filters,
      searchFields,
      userRoles,
      allowedFields: this.solrFieldNames()
    })

    this.logger.debug(JSON.stringify(params))
    return this.solrSearch(params)
  } // runSolrSearch

  solrFieldNames () {
    const configured = (this.solr.solrSchemaFields || []).map(([fieldName]) => fieldName)
    const fieldNames = configured.length ? configured : defaultSolrSchemaFields
    return new Set([...fieldNames, 'score'])
  } // solrFieldNames

  solrSearch (params) {
    return new Promise((resolve, reject) => {
      this.solrClient.search(params, (err, result) => {
        if (err) return reject(err)
        const results = result.response.docs
        const count = result.response.numFound
        resolve([results, count])
      })
    })
  } // solrSearch

  async runStorageSearch (
    event,
    searchFields,
    filters,
    userRoles
  ) {
    const { query, queryParams, countQuery, countParams } = buildStorageQuery({
      filters,
      searchFields,
      userRoles
    })

    const results = await this.storageClient.query(query, queryParams)
    const count = (await this.storageClient.query(countQuery, countParams)).rows[0].total
    return [results.rows, Number.parseInt(count)]
  } // runStorageSearch

  async processResults (context, results, filters, totalHits) {
    results = await this.deserialiseLaunches(results, context.userId)
    results = this.expandCategories(results)

    const searchResults = {
      input: filters,
      totalHits,
      results,
      categoryCounts: this.countCategories(results)
    }

    return searchResults
  } // searchResults

  deserialiseLaunches (results, userId) {
    const withJson = results.map(async r => {
      if (r.launches) {
        r.launches = await this.processLaunches(r.launches, userId)
      }
      return r
    })
    return Promise.all(withJson)
  } // deserialiseLaunches

  async processLaunches (launchesString, userId) {
    try {
      // try to parse JSON
      const launches = JSON.parse(launchesString).launches
      const isAuthorized = stateMachineName =>
        this.rbac.checkAuthorization(userId, null, 'stateMachine', stateMachineName, 'create')

      const filteredLaunches = []
      for (const launch of launches) {
        if (await isAuthorized(launch.stateMachineName)) {
          filteredLaunches.push(launch)
        }
      }
      return filteredLaunches
    } catch (e) {
      // do nothing
      return launchesString
    }
  } // processLaunches

  expandCategories (results) {
    results
      .filter(r => r.category)
      .forEach(r => {
        r.categoryLabel = this.categories[r.category]
          ? this.categories[r.category].label
          : r.category
      })
    return results
  } // expandCategories

  // Search analytics (sc-34389). Logging must never break the search itself.
  async logSearch (context, filters, hitCount, durationMs) {
    try {
      return await logSearch(this.storageClient, {
        userId: context.userId,
        filters,
        hitCount,
        durationMs
      })
    } catch (err) {
      this.logger.warn(`Failed to log search: ${err.message}`)
      return null
    }
  } // logSearch

  countCategories (docs) {
    const facets = {}
    docs.forEach(doc => {
      if (!Object.prototype.hasOwnProperty.call(facets, doc.category)) {
        facets[doc.category] = 1
      } else {
        facets[doc.category]++
      }
    })
    return facets
  }

  processFilters (event) {
    const searchDefaults = {
      orderBy: 'created desc',
      offset: 0,
      limit: 10,
      categoryRestriction: [],
      showActiveEventsOnly: false,
      showNonActiveEventsOnly: false
    }

    const filters = {}

    if (_.isString(event.domain)) {
      filters.domain = event.domain
    }

    if (_.isString(event.docType)) {
      filters.docType = event.docType
    }

    if (_.isString(event.author)) {
      filters.author = event.author
    }

    if (_.isString(event.query) && event.query.trim() !== '') {
      filters.query = event.query
    }

    if (_.isString(event.orderBy)) {
      filters.orderBy = event.orderBy
    } else {
      filters.orderBy = searchDefaults.orderBy
    }

    if (_.isInteger(event.offset)) {
      filters.offset = event.offset
    } else {
      filters.offset = searchDefaults.offset
    }

    if (_.isInteger(event.limit)) {
      filters.limit = event.limit
    } else {
      filters.limit = searchDefaults.limit
    }

    if (_.isNumber(event.lat) && _.isNumber(event.long)) {
      filters.lat = event.lat
      filters.long = event.long
    }

    if (_.isArray(event.categoryRestriction)) {
      filters.categoryRestriction = event.categoryRestriction
    } else {
      filters.categoryRestriction = searchDefaults.categoryRestriction
    }

    if (_.isBoolean(event.showActiveEventsOnly)) {
      filters.showActiveEventsOnly = event.showActiveEventsOnly
    } else {
      filters.showActiveEventsOnly = searchDefaults.showActiveEventsOnly
    }

    if (_.isBoolean(event.showNonActiveEventsOnly)) {
      filters.showNonActiveEventsOnly = event.showNonActiveEventsOnly
    } else {
      filters.showNonActiveEventsOnly = searchDefaults.showNonActiveEventsOnly
    }

    return filters
  }
}

module.exports = Search
