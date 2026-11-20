#!/usr/bin/env node
'use strict'

// Applies solr/schema to a Solr core. Safe to re-run: only what's missing or
// different is changed. Shows the plan and changes nothing unless --apply is given.
//
//   node solr/apply-schema.js --url http://localhost:8983/solr [--core tymly] [--apply]
//
// Search synonyms aren't set here: they come from blueprints' search-synonyms directories and are
// synced to Solr by the searchSynonyms service when Tymly boots.
//
// After a change to fields, field types or copy fields, run a full reindex (clean=true) so
// every document is re-added and the new fields are filled.

const path = require('path')
const SolrAdmin = require('../lib/util/solr-admin')
const parseArgs = require('./lib/args')
const { planSchemaChanges } = require('./lib/plan-schema-changes')

const SCHEMA_DIR = path.join(__dirname, 'schema')

function loadWantedSchema () {
  const base = require(path.join(SCHEMA_DIR, 'base-fields.json'))
  const search = require(path.join(SCHEMA_DIR, 'search-fields.json'))
  return {
    baseFields: base.fields,
    fieldTypes: search.fieldTypes,
    fields: search.fields,
    copyFields: search.copyFields
  }
}

async function main () {
  const args = parseArgs(process.argv.slice(2), { core: 'tymly' })
  if (!args.url || args.url === true) {
    console.error('Usage: node solr/apply-schema.js --url <solr url, e.g. http://localhost:8983/solr> [--core tymly] [--apply]')
    process.exit(2)
  }

  const solr = new SolrAdmin(args.url, args.core)
  const schema = loadWantedSchema()
  const apply = args.apply === true

  console.log(`Solr core: ${solr.coreUrl}${apply ? '' : '  (dry run: add --apply to make changes)'}`)

  const schemaPlan = planSchemaChanges(await solr.getSchema(), schema)
  report('Schema', schemaPlan.summary)
  if (apply && schemaPlan.summary.length) {
    await solr.updateSchema(schemaPlan.commands)
    console.log('  schema updated')
  }

  if (schemaPlan.reindexNeeded) {
    console.log(apply
      ? '\nRun a full reindex (clean=true) so every document is re-added and the new fields are filled.'
      : '\nApplying this will need a full reindex (clean=true) afterwards.')
  } else {
    console.log('\nNothing to change.')
  }
}

function report (title, summary) {
  console.log(`\n${title}: ${summary.length ? `${summary.length} change(s)` : 'up to date'}`)
  for (const line of summary) console.log(`  - ${line}`)
}

if (require.main === module) {
  main().catch(err => {
    const detail = err.response ? ` (HTTP ${err.response.status}: ${JSON.stringify(err.response.data)})` : ''
    console.error(`Failed: ${err.message}${detail}`)
    process.exit(1)
  })
}

module.exports = { loadWantedSchema }
