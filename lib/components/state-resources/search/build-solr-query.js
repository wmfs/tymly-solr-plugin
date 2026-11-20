'use strict'

const _ = require('lodash')
const { escapeTerm, quoteValue, quoteList, InvalidSearchInputError } = require('./escape')
const { splitSearchTerms } = require('./search-terms')
const parseTagsFilter = require('./parse-tags-filter')
const parseRatingFilter = require('./parse-rating-filter')

const SOLR_STRIP_PATTERN = /[_.!~*'()+:]/g
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const SORTABLE_FIELDS = ['created', 'modified', 'eventTimestamp', 'rating', 'docId', 'id', 'sortString', 'score']
const DEFAULT_SORT = 'created desc'
const RADIAL_DISTANCE_KM = 1

// Solr date or date-math value: *, NOW, or an ISO UTC timestamp, optionally followed by +1DAY, -2HOURS, /DAY etc.
const SOLR_DATE = '(?:\\*|NOW|\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z)' +
  '(?:[+-]\\d+(?:YEARS?|MONTHS?|DAYS?|HOURS?|MINUTES?|SECONDS?|MILLIS?)|\\/(?:YEAR|MONTH|DAY|HOUR|MINUTE|SECOND))*'
const SOLR_DATE_RANGE = new RegExp(`^(${SOLR_DATE}) TO (${SOLR_DATE})$`)

/**
 * Builds the Solr select parameters for a search.
 * Returns a plain object; solr-client URL-encodes it, so no user input can add or change parameters.
 * Every filter is its own `fq`, so the role filter can't be widened by another filter's value.
 */
function buildSolrQuery ({ event = {}, filters, searchFields = [], userRoles = [], allowedFields }) {
  const roles = userRoles.length ? userRoles : ['$authenticated']

  const fq = [`roles:${quoteList(roles)}`]

  if (filters.domain) fq.push(`domain:${quoteValue(filters.domain)}`)
  if (filters.docType) fq.push(`docType:${quoteValue(filters.docType)}`)
  if (filters.author) fq.push(`author:${quoteValue(filters.author)}`)

  if (filters.categoryRestriction && filters.categoryRestriction.length > 0) {
    fq.push(`category:${quoteList(filters.categoryRestriction)}`)
  }

  if (filters.showActiveEventsOnly) {
    fq.push('activeEvent:true')
  } else if (filters.showNonActiveEventsOnly) {
    fq.push('activeEvent:false')
  }

  const tags = parseTagsFilter(event.tags)
  if (tags) fq.push(tags)

  const rating = parseRatingFilter(event.rating)
  if (rating) fq.push(rating)

  const eventTimestamp = eventTimestampFilter(event.eventTimestamp)
  if (eventTimestamp) fq.push(eventTimestamp)

  const searchTerm = searchTermFilter(filters.query, searchFields)
  if (searchTerm) fq.push(searchTerm)

  const params = {
    q: '*:*',
    fq,
    sort: sortParam(filters.orderBy),
    start: Math.max(0, filters.offset || 0),
    rows: Math.max(0, filters.limit || 0)
  }

  const point = locationPoint(event.location)
  if (point) {
    fq.push(`{!geofilt d=${RADIAL_DISTANCE_KM}}`)
    params.sfield = 'point'
    params.pt = point
    params.sort = 'geodist() asc'
  }

  const fl = fieldList(event.fields, allowedFields)
  if (fl) params.fl = fl

  return params
} // buildSolrQuery

function searchTermFilter (query, searchFields) {
  const terms = splitSearchTerms(query, { stripPattern: SOLR_STRIP_PATTERN, hyphenToSpace: true })
  const fields = searchFields.map(f => _.camelCase(f)).filter(f => FIELD_NAME.test(f))

  if (terms.length === 0 || fields.length === 0) return null

  const allTerms = '(' + terms.map(escapeTerm).join(' AND ') + ')'
  return '(' + fields.map(f => `${f}:${allTerms}`).join(' OR ') + ')'
} // searchTermFilter

/**
 * orderBy is "<field> <asc|desc>", optionally comma-separated. Anything not on the allowed list falls back to the default.
 */
function sortParam (orderBy) {
  if (typeof orderBy !== 'string' || orderBy.trim() === '') return DEFAULT_SORT

  const clauses = orderBy.split(',').map(clause => {
    const match = /^\s*([A-Za-z]+)\s+(asc|desc)\s*$/i.exec(clause)
    if (!match || !SORTABLE_FIELDS.includes(match[1])) return null
    return `${match[1]} ${match[2].toLowerCase()}`
  })

  return clauses.every(c => c) ? clauses.join(', ') : DEFAULT_SORT
} // sortParam

/**
 * eventTimestamp is a Solr date range, e.g. "2026-01-01T00:00:00Z TO 2026-01-01T23:59:59Z" or "NOW-7DAYS TO NOW".
 * Some callers still pass it pre-encoded ("%20TO%20"), so decode it first.
 */
function eventTimestampFilter (value) {
  if (value === undefined || value === null || value === '') return null

  let range = String(value)
  try {
    range = decodeURIComponent(range)
  } catch (err) {
    // not URI-encoded; validate as-is
  }
  range = range.trim().replace(/\s+/g, ' ')

  const match = SOLR_DATE_RANGE.exec(range)
  if (!match) {
    throw new InvalidSearchInputError(`Invalid eventTimestamp range: '${value}'`)
  }

  return `eventTimestamp:[${match[1]} TO ${match[2]}]`
} // eventTimestampFilter

function locationPoint (location) {
  if (!location) return null

  const lat = Number(location.lat)
  const lng = Number(location.lng)

  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new InvalidSearchInputError('Invalid location: lat and lng must be numbers')
  }

  return `${lat},${lng}`
} // locationPoint

/**
 * Only fields that exist in the Solr schema can be requested; others are dropped.
 */
function fieldList (fields, allowedFields) {
  if (!Array.isArray(fields) || !allowedFields) return null

  const wanted = fields.filter(f => typeof f === 'string' && allowedFields.has(f))
  return wanted.length ? wanted.join(',') : null
} // fieldList

module.exports = buildSolrQuery
module.exports.sortParam = sortParam
module.exports.eventTimestampFilter = eventTimestampFilter
module.exports.searchTermFilter = searchTermFilter
