'use strict'

const { tokeniseSearchText } = require('./search-terms')

const STORAGE_STRIP_PATTERN = /[-_.!~*'()]/g
const COLUMN_NAME = /^[a-z_][a-z0-9_]*$/
const UNSEARCHED_COLUMNS = ['id', 'roles', 'domain', 'launches']

/**
 * Builds the Postgres queries used when no Solr is configured.
 * All user input is passed as query parameters ($1, $2 ...), never put into the SQL text.
 * Returns { query, queryParams, countQuery, countParams }.
 */
function buildStorageQuery ({ filters, searchFields = [], userRoles = [], viewColumns = null }) {
  const hasColumn = column => !viewColumns || viewColumns.includes(column)

  const params = []
  const param = value => {
    params.push(value)
    return `$${params.length}`
  }

  const clauses = []
  let matchScore = null

  // compound words (e.g. XYZ-00123, Upton-on-Sea) keep their punctuation so they still match
  const terms = tokeniseSearchText(filters.query, { stripPattern: STORAGE_STRIP_PATTERN }).map(t => t.term)
  const columns = searchFields
    .filter(f => !UNSEARCHED_COLUMNS.includes(f))
    .filter(f => COLUMN_NAME.test(f))

  if (terms.length > 0 && columns.length > 0) {
    const termParams = terms.map(t => param(likePattern(t)))
    clauses.push(
      columns
        .map(column => '(' + termParams.map(p => `cast(${column} as text) ilike ${p}`).join(' and ') + ')')
        .join(' or ')
    )

    // simple relevance: records with more of the words in their title come first
    if (columns.includes('title') && hasColumn('title')) {
      matchScore = termParams.map(p => `(cast(title as text) ilike ${p})::int`).join(' + ')
    }
  }

  const roles = userRoles.length ? userRoles : ['$authenticated']
  clauses.push(`roles && ${param(roles)}::text[]`)

  if (filters.domain) clauses.push(`domain = ${param(filters.domain)}`)
  if (filters.showActiveEventsOnly) clauses.push('active_event = true')

  if (filters.categoryRestriction && filters.categoryRestriction.length > 0) {
    clauses.push(`category = any(${param(filters.categoryRestriction)}::text[])`)
  }

  const where = 'where ' + clauses.map(c => `(${c})`).join(' and ')
  // id last, so every page is in the same order and paging never repeats or skips a record
  const order = [
    matchScore && `(${matchScore}) desc`,
    hasColumn('modified') && 'modified desc nulls last',
    hasColumn('id') && 'id'
  ].filter(o => o)
  const orderBy = order.length ? `order by ${order.join(', ')} ` : ''
  const countParams = [...params]

  const limit = param(Math.max(0, filters.limit || 0))
  const offset = param(Math.max(0, filters.offset || 0))

  return {
    query: `select * from tymly.solr_data ${where} ${orderBy}limit ${limit} offset ${offset}`,
    queryParams: params,
    countQuery: `select count(*) as total from tymly.solr_data ${where}`,
    countParams
  }
} // buildStorageQuery

// ilike pattern matching the term anywhere, with % and _ in the term treated literally
function likePattern (term) {
  return '%' + term.replace(/[\\%_]/g, '\\$&') + '%'
}

module.exports = buildStorageQuery
