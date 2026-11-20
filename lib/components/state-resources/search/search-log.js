'use strict'

// Search analytics (sc-34389): one tymly.search_log row per search.
// See lib/blueprints/solr-blueprint/pg-scripts/search-analytics.sql for the reports.

const MAX_QUERY_LENGTH = 500

function normaliseQuery (query) {
  if (typeof query !== 'string') return ''
  return query
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .substring(0, MAX_QUERY_LENGTH)
}

// Returns the new search_log id, or null if there was nothing to log: a search with no text and
// no categories is just the search page opening, not something the user searched for
async function logSearch (searchLogModel, { userId, filters, hitCount, durationMs }) {
  const query = normaliseQuery(filters.query)
  const categoryRestriction = filters.categoryRestriction || []
  if (!query && categoryRestriction.length === 0) return null

  const { idProperties } = await searchLogModel.create({
    userId,
    query,
    domain: filters.domain || null,
    categoryRestriction,
    resultOffset: filters.offset || 0,
    hitCount: Number(hitCount) || 0,
    durationMs: Math.round(durationMs)
  }, {})

  return idProperties.id
}

module.exports = { normaliseQuery, logSearch }
