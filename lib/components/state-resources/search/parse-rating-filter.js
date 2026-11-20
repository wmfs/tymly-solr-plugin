'use strict'

const isNumeric = n => !isNaN(parseFloat(n)) && isFinite(n)

/**
 * Builds a Solr filter query for rating: a single number, or a [min, max] range.
 * Anything else returns '' (no filter). Numbers are re-serialised, so only digits reach Solr.
 */
module.exports = function parseRatingFilter (input) {
  if (typeof input === 'string') {
    if (input.trim().length === 0 || !isNumeric(input)) return ''
    return `rating:${Number(input)}`
  }

  if (typeof input === 'number') {
    return Number.isFinite(input) ? `rating:${input}` : ''
  }

  if (Array.isArray(input) && input.length === 2) {
    const [min, max] = input
    if (!isNumeric(min) || !isNumeric(max)) return ''
    return `rating:[${Number(min)} TO ${Number(max)}]`
  }

  return ''
}
