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
async function logSearch (client, { userId, filters, hitCount, durationMs }) {
  const query = normaliseQuery(filters.query)
  if (!query) return null

  const { rows } = await client.query(
    `insert into tymly.search_log
      (user_id, query, domain, category_restriction, result_offset, hit_count, duration_ms, _created_by, _modified_by)
      values ($1, $2, $3, $4, $5, $6, $7, $1, $1)
      returning id`,
    [
      userId,
      query,
      filters.domain || null,
      filters.categoryRestriction || [],
      filters.offset || 0,
      Number(hitCount) || 0,
      Math.round(durationMs)
    ]
  )

  return rows[0].id
}

module.exports = { normaliseQuery, logSearch }
