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

  get categories () { return this.services.categories.categories }
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

      const searchSource = this.solr.solrUrl
        ? this.runSolrSearch
        : this.runStorageSearch

      const [results, count] =
        await searchSource.bind(this)(
          event,
          searchFields,
          filters,
          userRoles
        )

      const processedResults =
        await this.processResults(
          context,
          results,
          filters,
          count
        )

      context.sendTaskSuccess({
        searchResults: processedResults
      })
    } catch (err) {
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
        f !== 'activeEvent' &&
        f !== 'category' &&
        f !== 'rating' &&
        f !== 'data'
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

  runSolrSearch (
    event,
    searchFields,
    filters,
    userRoles
  ) {
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
    const domain = filters.domain ? `%20AND%20domain:${filters.domain}` : ``
    const tags = event.tags && event.tags.length > 0 ? `%20AND%20tags:(${event.tags.map(tag => `"${tag}"`).join('%20OR%20')})` : ``
    const sortQuery = filters.orderBy ? `&sort=${filters.orderBy.replace(/ /g, '%20')}` : '&sort=created%20desc'
    const query = `q=*:*${domain}${tags}${userRolesQuery}${categoryQuery}${activeEvent}${fq}${sortQuery}&start=${event.offset}&rows=${event.limit}`

    console.log(query)
    return this.solrSearch(query)
  } // runSolrSearch

  solrSearch (query) {
    return new Promise((resolve, reject) => {
      this.solrClient.search(query, (err, result) => {
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
    const countQuery = `select count(*) as total from tymly.solr_data ${whereClause}`

    const results = await this.storageClient.query(query)
    const count = (await this.storageClient.query(countQuery)).rows[0].total
    return [results.rows, Number.parseInt(count)]
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
        terms
          .map(t => `cast(${f} as text) ilike '%${t}%'`)
          .join(' and ')
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
    return `domain = '${domain}'`
  } // storageSearchDomain

  storageSearchActiveEvent (activeEventOnly) {
    if (!activeEventOnly) {
      return null
    }
    return `active_event = true`
  } // storageSearchActiveEvent

  storageSearchCategory (categoryRestriction) {
    if (categoryRestriction.length === 0) {
      return null
    }

    return categoryRestriction
      .map(cat => `'${cat}' = category`)
      .join(' or ')
  } // storageSearchCategory

  async processResults (context, results, filters, totalHits) {
    results = await this.deserialiseLaunches(results, context.userId)
    results = this.expandCategories(results)

    const searchResults = {
      input: filters,
      totalHits: totalHits,
      results: results,
      categoryCounts: this.countCategories(results)
    }

    await this.updateSearchHistory(
      searchResults.results,
      context.userId
    )

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

  updateSearchHistory (docs, userId) {
    const updates = docs
      .map(doc =>
        this.searchHistory.upsert({
          userId: userId,
          docId: doc.doc_id,
          category: doc.category
        }, {})
      )
    return Promise.all(updates)
  } // updateSearchHistory

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
      orderBy: 'created desc',
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
