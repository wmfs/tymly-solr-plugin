'use strict'

const { quoteValue } = require('./escape')

const isTag = value => (typeof value === 'string' && value !== '') || Number.isFinite(value)

/**
 * Builds a Solr filter query for tags.
 * Each top-level entry must match (AND). An entry that is an array matches any of its values (OR).
 * e.g. [['CANCELLED', 'CONFIRMED'], 'NO_INCIDENT'] => tags:(("CANCELLED" OR "CONFIRMED") AND "NO_INCIDENT")
 * Every tag is quoted and escaped. Returns '' when there are no usable tags.
 */
function parseTagsFilter (input) {
  if (!Array.isArray(input)) return ''

  const groups = input
    .map(entry => {
      if (!Array.isArray(entry)) return isTag(entry) ? quoteValue(entry) : null

      const values = entry.filter(isTag)
      if (values.length === 0) return null
      if (values.length === 1) return quoteValue(values[0])
      return '(' + values.map(quoteValue).join(' OR ') + ')'
    })
    .filter(group => group)

  return groups.length ? `tags:(${groups.join(' AND ')})` : ''
}

/**
 * Builds a Solr filter query that leaves out records with any of these tags.
 * e.g. ['Invalid', 'Merged'] => -tags:("Invalid" OR "Merged")
 * Every tag is quoted and escaped. Returns '' when there are no usable tags.
 */
function parseExcludeTagsFilter (input) {
  if (!Array.isArray(input)) return ''
  const values = input.filter(isTag)
  return values.length ? `-tags:(${values.map(quoteValue).join(' OR ')})` : ''
}

module.exports = parseTagsFilter
module.exports.parseExcludeTagsFilter = parseExcludeTagsFilter
