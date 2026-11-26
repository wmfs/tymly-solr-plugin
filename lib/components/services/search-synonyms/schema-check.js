'use strict'

// Checks on boot that Solr has the search fields this plugin's searches use (solr/schema).
// Without them, eDisMax quietly ignores the missing fields, so text searches only match titles and
// UPRN, postcode and masking number searches find nothing, with no error anywhere. So say so in the log.

const { loadWantedSchema } = require('../../../../solr/apply-schema')
const { PROPS, schemaHash } = require('../../../../solr/lib/schema-version')

const SEARCH_FIELDS = ['searchText', 'searchPrefix', 'searchShingle', 'searchKeys']

// Returns { status, message }: ok, missingFields, notRecorded or differentVersion
async function checkSolrSchema (solrAdmin, localHash = schemaHash(loadWantedSchema())) {
  const { fields } = await solrAdmin.get('/schema/fields', { showDefaults: false })
  const names = new Set((fields || []).map(f => f.name))
  const missing = SEARCH_FIELDS.filter(name => !names.has(name))

  if (missing.length) {
    return {
      status: 'missingFields',
      message: `Solr is missing the search fields ${missing.join(', ')}, so text searches only match titles and ` +
        'UPRN, postcode and masking number searches find nothing. Apply the schema (node solr/apply-schema.js --url <solr> --apply), then run a full reindex.'
    }
  }

  const props = (await solrAdmin.getUserProps()) || {}
  const applied = props[PROPS.hash]
  if (!applied) {
    return { status: 'notRecorded', message: 'Solr has the search fields, but no schema version recorded. Run node solr/apply-schema.js --url <solr> to check it matches.' }
  }
  if (applied !== localHash) {
    return {
      status: 'differentVersion',
      message: `Solr's schema version (${applied}) isn't this plugin's (${localHash}). Run node solr/apply-schema.js --url <solr> to see what differs, then --apply and a full reindex.`
    }
  }
  return { status: 'ok', message: `Solr schema version ${applied} matches this plugin` }
}

module.exports = { checkSolrSchema, SEARCH_FIELDS }
