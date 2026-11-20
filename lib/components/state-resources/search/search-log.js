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

// Returns the new search_log id, or null if there was no search text to log
async function logSearch (searchLogModel, { userId, filters, hitCount, durationMs }) {
  const query = normaliseQuery(filters.query)
  if (!query) return null

  const { idProperties } = await searchLogModel.create({
    userId,
    query,
    domain: filters.domain || null,
    categoryRestriction: filters.categoryRestriction || [],
    resultOffset: filters.offset || 0,
    hitCount: Number(hitCount) || 0,
    durationMs: Math.round(durationMs)
  }, {})

  return idProperties.id
}

module.exports = { normaliseQuery, logSearch }
