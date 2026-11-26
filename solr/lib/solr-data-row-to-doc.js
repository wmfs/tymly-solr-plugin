'use strict'

const { camelCase } = require('lodash')

// Turns a row of tymly.solr_data (snake_case columns) into a Solr document (camelCase fields),
// leaving out empty values, the same way updateDocsBySearchDoc names fields.
function solrDataRowToDoc (row) {
  const doc = {}
  for (const [column, value] of Object.entries(row)) {
    if (value === null || value === undefined) continue
    if (Array.isArray(value) && value.length === 0) continue
    doc[camelCase(column)] = value
  }
  return doc
}

module.exports = { solrDataRowToDoc }
