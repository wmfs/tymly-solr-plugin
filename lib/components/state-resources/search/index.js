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
    console.log('SEARCH')
    if (!context.userId) {
      return context.sendTaskFailure({
        error: 'noUserIdSearchFail',
        cause: 'No user ID found when trying to search.'
      })
    } // if ...

    try {
      const userRoles = await this.listUserRoles(context)

      this.searchFields = this.buildSearchFields()

      const filters = this.processFilters(event)

      if (this.solr.solrUrl) {
        this.runSolrSearch(event, context, filters, userRoles)
      } else {
        this.runStorageSearch(event, context, filters, userRoles)
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
    const allFields = this.findSearchFields()
    const wantedFields = allFields
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

  runSolrSearch (event, context, filters, userRoles) {
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

    const filterQuery = this.searchFields.map(s => `${_.camelCase(s)}:${searchTerm}`)
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

  async runStorageSearch (event, context, filters, userRoles) {
    const whereClause = this.storageSearchQuery(filters.query)
    const roleWhereClause = userRoles.map(role => `'${role}' = any(roles)`).join(' or ')
    const limitClause = `limit ${filters.limit} offset ${filters.offset}`
    const query = `select * from tymly.solr_data where (${whereClause}) and (${roleWhereClause}) ${limitClause}`
    console.log(`\nSQL query = ${query}`)

    try {
      const results = await this.storageClient.query(query)

      const matchingDocs = this.filterDocs(results.rows, filters)

      this.processResults(context, matchingDocs, filters, matchingDocs.length)
    } catch (err) {
      return context.sendTaskFailure({ error: 'searchFail', cause: err })
    }
  } // runStorageSearch

  storageSearchQuery (searchTerm = '') {
    const terms = searchTerm
      .trim()
      .replace(emojiRegex, '') // remove emojis
      .replace(/([-]|[_]|[.]|[!]|[~]|[*]|[']|[(]|[)])/g, '') // remove unescaped
      .split(' ')
      .filter(x => x)

    if (terms.length === 0) {
      return '1 = 1'
    }

    const queries = this.searchFields
      .map(field =>
        terms.map(t => `cast(${field} as text) ilike '%${t}%'`).join(' and ')
      )

    const whereClause = queries
      .map(q => `(${q})`)
      .join(' or ')
    return whereClause
  }

  async processResults (context, matchingDocs, filters, totalHits) {
    const searchResults = {
      input: filters,
      totalHits: totalHits
    }

    this.constructSearchResults(searchResults, filters, matchingDocs)
    try {
      await this.updateSearchHistory(searchResults.results, context.userId)
      context.sendTaskSuccess({ searchResults })
    } catch (err) {
      context.sendTaskFailure({ error: 'searchFail', cause: err })
    }
  } // searchResults

  constructSearchResults (searchResults, filters, results) {
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

  filterDocs (docs, filters) {
    const matchingDocs = []
    docs.map(candidate => {
      if (
        this.domainMatch(filters.domain, candidate) &&
        this.categoryMatch(filters.categoryRestriction, candidate) &&
        this.activeEventMatch(filters.showActiveEventsOnly, candidate)
      ) {
        matchingDocs.push(candidate)
      }
    })
    return matchingDocs
  }

  categoryMatch (categoryRestriction, doc) {
    if (categoryRestriction.length === 0) {
      return true
    } else {
      return categoryRestriction.indexOf(doc.category) !== -1
    }
  }

  domainMatch (domain, doc) {
    if (!domain) {
      return true
    } else {
      return domain === doc.domain
    }
  }

  activeEventMatch (showActiveEventsOnly, doc) {
    if (!showActiveEventsOnly) {
      return true
    } else {
      return doc.activeEvent
    }
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
