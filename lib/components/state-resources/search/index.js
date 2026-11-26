'use strict'

const _ = require('lodash')
const defaultSolrSchemaFields = require('./solr-schema-fields.json')
const buildSolrQuery = require('./build-solr-query')
const { failureCause } = require('../../../util/solr-client')
const buildStorageQuery = require('./build-storage-query')
const { InvalidSearchInputError } = require('./escape')
const { logSearch } = require('./search-log')
const { loadRelevanceSettings } = require('./relevance')

class Search {
  init (resourceConfig, env) {
    this.storageClient = env.bootedServices.storage.client
    this.searchLogModel = env.bootedServices.storage.models.tymly_searchLog
    this.services = env.bootedServices
  }

  get categories () { return this.services.categories.categories }

  get rbac () { return this.services.rbac }

  get solr () { return this.services.solr }

  get logger () { return this.solr.logger }

  // shared client from the solr service; null when no Solr is configured
  get solrClient () { return this.solr.client }

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
      const [results, count, extras] =
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
          count,
          extras
        )

      // skipLog: the frontend is showing a search it has already logged again (e.g. browser back)
      processedResults.searchLogId = event.skipLog === true
        ? null
        : await this.logSearch(context, filters, count, durationMs)

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

      this.logger.error(`Search fail: ${(err && err.stack) || JSON.stringify(err)}`)
      context.sendTaskFailure({
        error: 'searchFail',
        cause: failureCause(err)
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
      userRoles,
      allowedFields: this.solrFieldNames(),
      relevance: this.relevance,
      synonymGroups: this.synonymGroups
    })

    this.logger.debug(JSON.stringify(params))
    return this.solrSearch(params)
  } // runSolrSearch

  // from blueprints' search-synonyms, via the searchSynonyms service (none if it isn't loaded)
  get synonymGroups () {
    const service = this.services.searchSynonyms
    return (service && service.groups) || []
  }

  get relevance () {
    if (!this.solr.searchRelevance) this.solr.searchRelevance = loadRelevanceSettings()
    return this.solr.searchRelevance
  } // relevance

  solrFieldNames () {
    const configured = (this.solr.solrSchemaFields || []).map(([fieldName]) => fieldName)
    const fieldNames = configured.length ? configured : defaultSolrSchemaFields
    return new Set([...fieldNames, 'score'])
  } // solrFieldNames

  async solrSearch (params) {
    const result = await this.solrClient.search(params)
    return [result.response.docs, result.response.numFound, {
      facets: facetCounts(result.facet_counts),
      highlights: result.highlighting || {}
    }]
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
      userRoles,
      viewColumns: [...this.solrFieldNames()].map(f => _.snakeCase(f))
    })

    const results = await this.storageClient.query(query, queryParams)
    const count = (await this.storageClient.query(countQuery, countParams)).rows[0].total
    return [results.rows, Number.parseInt(count)]
  } // runStorageSearch

  async processResults (context, results, filters, totalHits, extras = {}) {
    results = await this.deserialiseLaunches(results, context.userId)
    results = this.expandCategories(results)

    // facets count every match, so only Solr returns them. Without Solr, facets is null and
    // categoryCounts counts this page only, as it always has.
    const facets = extras.facets || null

    const searchResults = {
      input: filters,
      totalHits,
      results,
      facets,
      highlights: extras.highlights || {},
      categoryCounts: facets ? (facets.category || {}) : this.countCategories(results)
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

  // Search analytics. Logging must never break the search itself.
  async logSearch (context, filters, hitCount, durationMs) {
    try {
      return await logSearch(this.searchLogModel, {
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

    // capped for the Postgres search too, not just Solr (see MAX_ROWS in build-solr-query.js)
    if (_.isInteger(event.offset)) {
      filters.offset = _.clamp(event.offset, 0, buildSolrQuery.MAX_START)
    } else {
      filters.offset = searchDefaults.offset
    }

    if (_.isInteger(event.limit)) {
      filters.limit = _.clamp(event.limit, 0, buildSolrQuery.MAX_ROWS)
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

/**
 * Solr returns facet counts as [value, count, value, count, ...]; turn each field into { value: count }.
 */
function facetCounts (facetCountsResponse) {
  const fields = (facetCountsResponse && facetCountsResponse.facet_fields) || {}
  const facets = {}
  for (const [field, list] of Object.entries(fields)) {
    facets[field] = {}
    for (let i = 0; i + 1 < list.length; i += 2) {
      facets[field][list[i]] = list[i + 1]
    }
  }
  return facets
} // facetCounts

module.exports = Search
module.exports.facetCounts = facetCounts
