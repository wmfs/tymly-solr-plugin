'use strict'

// Records which schema a Solr core has, as Solr config user properties, so anyone can see
// what an environment is running and whether it matches the files in solr/schema.

const crypto = require('crypto')
const { execSync } = require('child_process')

const PROPS = {
  hash: 'tymly.schemaHash',
  appliedAt: 'tymly.schemaAppliedAt',
  source: 'tymly.schemaSource'
}

// The same JSON always gives the same text, whatever order its keys were written in
function stableStringify (value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

// Short fingerprint of the wanted schema (base fields, field types, fields and copy fields)
function schemaHash (schema) {
  return crypto.createHash('sha256').update(stableStringify(schema)).digest('hex').slice(0, 12)
}

// Which commit the schema files came from, if this is a git checkout
function schemaSource (dir) {
  try {
    const run = cmd => execSync(cmd, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const commit = run('git rev-parse --short HEAD')
    const changed = run('git status --porcelain -- .')
    return `commit ${commit}${changed ? ' with uncommitted changes' : ''}`
  } catch (err) {
    return 'not a git checkout'
  }
}

function stampProps (hash, source, now = new Date()) {
  return {
    [PROPS.hash]: hash,
    [PROPS.appliedAt]: now.toISOString(),
    [PROPS.source]: source
  }
}

// Lines describing what Solr has recorded, compared with the files being run from
function describeStamp (userProps, localHash) {
  const props = userProps || {}
  const hash = props[PROPS.hash]
  if (!hash) {
    return {
      matches: false,
      lines: ['Solr has no schema version recorded (applied before version stamps were added, or by hand).']
    }
  }
  const matches = hash === localHash
  return {
    matches,
    lines: [
      `Solr's schema version: ${hash}, applied ${props[PROPS.appliedAt] || '(unknown date)'} from ${props[PROPS.source] || '(unknown source)'}`,
      matches
        ? 'This matches the schema files here.'
        : `This does NOT match the schema files here (${localHash}). Run apply-schema.js to see what differs.`
    ]
  }
}

module.exports = { PROPS, stableStringify, schemaHash, schemaSource, stampProps, describeStamp }
