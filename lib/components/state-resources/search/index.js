'use strict'

const _ = require('lodash')
const solr = require('solr-client')
const defaultSolrSchemaFields = require('./solr-schema-fields.json')
const emojiRegex = require('emoji-regex')()

class Search {
  init (resourceConfig, env, callback) {
    this.searchHistory = env.bootedServices.storage.models['tymly_searchHistory']
    this.storageClient = env.bootedServices.storage.client
    this.services = env.bootedServices
    callback(null)
  }

  get rbac () { return this.services.rbac }
  get solr () { return this.services.solr }

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
  } // solrClient

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

      if (this.solr.solrUrl) {
        this.runSolrSearch(event, context, searchFields, filters, userRoles)
      } else {
        this.runStorageSearch(event, context, searchFields, filters, userRoles)
      }
    } catch (err) {
      context.sendTaskFailure({ error: 'searchGettingUserRolesFail', cause: err })
    }
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
        f !== 'activeEvent' &&
        f !== 'category'
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

    Object.keys(searchDocs).map(s => {
      Object.keys(searchDocs[s].attributeMapping).map(a => {
        searchFields.add(a)
      })
    })

    return [...searchFields]
  } // buildSearchFields

  runSolrSearch (event, context, searchFields, filters, userRoles) {
    const searchTerm = event.query
      ? '(' + encodeURIComponent(
        event.query
          .trim()
          .replace(emojiRegex, '') // remove emojis
          .replace(/([-]|[_]|[.]|[!]|[~]|[*]|[']|[(]|[)])/g, '') // remove unescaped
          .split(' ')
          .filter(x => x)
          .join(' AND ')
      ) + ')'
      : ''

    const filterQuery = searchFields.map(s => `${_.camelCase(s)}:${searchTerm}`)
    const fq = searchTerm ? `&fq=(${filterQuery.join('%20OR%20')})` : ''
    const categoryQuery = event.categoryRestriction && event.categoryRestriction.length > 0 ? `%20AND%20category:(${event.categoryRestriction.join('%20OR%20')})` : ''
    const userRolesQuery = `%20AND%20roles:(${userRoles.map(r => r).join('%20OR%20')})`
    const activeEvent = filters.showActiveEventsOnly ? `%20AND%20activeEvent:true` : ``
    const query = `q=*:*${userRolesQuery}${categoryQuery}${activeEvent}${fq}&sort=created%20desc&start=${event.offset}&rows=${event.limit}`
    console.log(`Solr Query = ${query}`)

    this.solrClient.search(query, (err, result) => {
      if (err) {
        return context.sendTaskFailure({ error: 'searchFail', cause: err })
      }
      this.processResults(context, result.response.docs, filters, result.response.numFound)
    })
  } // runSolrSearch

  async runStorageSearch (event, context, searchFields, filters, userRoles) {
    const searchClause = this.storageSearchQuery(searchFields, filters.query)
    const roleWhereClause = userRoles.map(role => `'${role}' = any(roles)`).join(' or ')
    const domainClause = this.storageSearchDomain(filters.domain)
    const activeEventClause = this.storageSearchActiveEvent(filters.showActiveEventsOnly)
    const categoryClause = this.storageSearchCategory(filters.categoryRestriction)
    const limitClause = `limit ${filters.limit} offset ${filters.offset}`

    const filterClauses = [
      searchClause,
      roleWhereClause,
      domainClause,
      activeEventClause,
      categoryClause
    ].filter(f => f)
      .map(f => `(${f})`)

    const whereClause = filterClauses.length ? `where ${filterClauses.join(' and ')}` : ''

    const query = `select * from tymly.solr_data ${whereClause} ${limitClause}`

    try {
      const results = await this.storageClient.query(query)

      this.processResults(context, results.rows, filters, results.rows.length)
    } catch (err) {
      return context.sendTaskFailure({ error: 'searchFail', cause: err })
    }
  } // runStorageSearch

  storageSearchQuery (searchFields, searchTerm = '') {
    const terms = searchTerm
      .trim()
      .replace(emojiRegex, '') // remove emojis
      .replace(/([-]|[_]|[.]|[!]|[~]|[*]|[']|[(]|[)])/g, '') // remove unescaped
      .split(' ')
      .filter(x => x)

    if (terms.length === 0) {
      return null
    }

    const queries = searchFields
      .filter(f => ['id', 'roles', 'domain', 'launches'].indexOf(f) === -1)
      .map(f =>
        terms.map(t => `cast(${f} as text) ilike '%${t}%'`).join(' and ')
      )

    const whereClause = queries
      .map(q => `(${q})`)
      .join(' or ')
    return whereClause
  }

  storageSearchDomain (domain) {
    if (!domain) {
      return null
    }
    return `domain = ${domain}`
  } // storageSearchDomain

  storageSearchActiveEvent (activeEventOnly) {
    if (!activeEventOnly || !this.allSearchFields.activeEvent) {
      return null
    }
    return `active_event = true`
  }

  storageSearchCategory (categoryRestriction) {
    if (categoryRestriction.length === 0 || !this.allSearchFields.category) {
      return null
    }

    return categoryRestriction.map(cat => `'${cat}' = any(category)`).join(' or ')
  }

  async processResults (context, results, filters, totalHits) {
    const searchResults = {
      input: filters,
      totalHits: totalHits,
      results: this.jsonifyLaunches(results),
      categoryCounts: this.countCategories(results)
    }

    try {
      await this.updateSearchHistory(searchResults.results, context.userId)
      context.sendTaskSuccess({ searchResults })
    } catch (err) {
      context.sendTaskFailure({ error: 'searchFail', cause: err })
    }
  } // searchResults

  constructSearchResults (searchResults, results) {
    searchResults.results = this.jsonifyLaunches(results)
    searchResults.categoryCounts = this.countCategories(results)
    return searchResults
  }

  jsonifyLaunches (results) {
    const withJson = results.map(r => {
      if (r.launches) {
        try {
          // try to parse JSON
          const launches = JSON.parse(r.launches)
          if (launches.launches) {
            r.launches = launches.launches
          }
        } catch (e) {
          // do nothing
        }
      }
      return r
    })
    return withJson
  } // jsonifyLaunches

  async updateSearchHistory (docs, userId) {
    for (const doc of docs) {
      await this.searchHistory.upsert({
        userId: userId || 'N/A',
        docId: doc.doc_id,
        category: doc.category
      }, {})
    }
  }

  countCategories (docs) {
    const facets = {}
    docs.map(doc => {
      if (!facets.hasOwnProperty(doc.category)) {
        facets[doc.category] = 1
      } else {
        facets[doc.category]++
      }
    })
    return facets
  }

  processFilters (event) {
    const searchDefaults = {
      orderBy: 'relevance',
      offset: 0,
      limit: 10,
      categoryRestriction: [],
      showActiveEventsOnly: false
    }
    const filters = {}
    if (_.isString(event.domain)) {
      filters.domain = event.domain
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

    return filters
  }
}

module.exports = Search
