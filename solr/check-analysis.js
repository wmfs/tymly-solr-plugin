#!/usr/bin/env node
'use strict'

// Checks the search field types on a Solr core behave as intended, using example
// values. Read-only: needs no data and changes nothing.
//
//   node solr/check-analysis.js --url http://localhost:8983/solr [--core tymly]

const SolrAdmin = require('../lib/util/solr-admin')
const parseArgs = require('./lib/args')
const cases = require('./lib/analysis-cases')
const { finalTokens } = require('./lib/analysis-tokens')
const { loadWantedSchema } = require('./apply-schema')
const { schemaHash, describeStamp } = require('./lib/schema-version')

async function main () {
  const args = parseArgs(process.argv.slice(2), { core: 'tymly' })
  if (!args.url || args.url === true) {
    console.error('Usage: node solr/check-analysis.js --url <solr url, e.g. http://localhost:8983/solr> [--core tymly]')
    process.exit(2)
  }

  const solr = new SolrAdmin(args.url, args.core)
  let failures = 0

  console.log(`Solr core: ${solr.coreUrl}`)
  for (const line of describeStamp(await solr.getUserProps(), schemaHash(loadWantedSchema())).lines) console.log(line)
  console.log('')

  for (const c of cases) {
    const response = await solr.analyse(c.fieldType, { [c.side]: c.value })
    const tokens = finalTokens(response, c.fieldType, c.side)
    const missing = c.includes.filter(t => !tokens.includes(t))
    const ok = missing.length === 0
    if (!ok) failures++

    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.fieldType} ${c.side} "${c.value}" (${c.why})`)
    if (!ok) console.log(`      missing ${missing.join(', ')}; got ${tokens.join(', ')}`)
  }

  console.log(`\n${cases.length - failures} of ${cases.length} passed`)
  process.exit(failures ? 1 : 0)
}

main().catch(err => {
  const detail = err.response ? ` (HTTP ${err.response.status}: ${JSON.stringify(err.response.data)})` : ''
  console.error(`Failed: ${err.message}${detail}`)
  process.exit(1)
})
