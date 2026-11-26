#!/usr/bin/env node
'use strict'

// Local development only: loads documents into a Solr core from a JSON-lines export of
// tymly.solr_data, for when there's no DataImportHandler set up (see solr/README.md).
//
//   node solr/index-jsonl.js --url http://localhost:8983/solr --file solr_data.jsonl [--core tymly] [--clean]

const fs = require('fs')
const readline = require('readline')
const axios = require('axios')
const parseArgs = require('./lib/args')
const { solrDataRowToDoc } = require('./lib/solr-data-row-to-doc')

const BATCH_SIZE = 1000

async function main () {
  const args = parseArgs(process.argv.slice(2), { core: 'tymly' })
  if (!args.url || args.url === true || !args.file || args.file === true) {
    console.error('Usage: node solr/index-jsonl.js --url <solr url> --file <solr_data.jsonl> [--core tymly] [--clean]')
    process.exit(2)
  }

  const updateUrl = `${args.url.replace(/\/+$/, '')}/${encodeURIComponent(args.core)}/update`

  if (args.clean === true) {
    await axios.post(updateUrl, { delete: { query: '*:*' } }, { params: { commit: true } })
    console.log('Deleted all documents')
  }

  const lines = readline.createInterface({ input: fs.createReadStream(args.file), crlfDelay: Infinity })
  let batch = []
  let total = 0

  const send = async () => {
    if (!batch.length) return
    await axios.post(updateUrl, batch, { params: { wt: 'json' } })
    total += batch.length
    console.log(`  ${total} documents`)
    batch = []
  }

  for await (const line of lines) {
    if (!line.trim()) continue
    batch.push(solrDataRowToDoc(JSON.parse(line)))
    if (batch.length >= BATCH_SIZE) await send()
  }
  await send()

  await axios.get(updateUrl, { params: { commit: true } })
  console.log(`Indexed ${total} documents and committed`)
}

main().catch(err => {
  const detail = err.response ? ` (HTTP ${err.response.status}: ${JSON.stringify(err.response.data)})` : ''
  console.error(`Failed: ${err.message}${detail}`)
  process.exit(1)
})
