'use strict'

// Works out the Schema API commands needed to bring a Solr core's schema in line with the
// definitions in solr/schema. Pure functions, so they can be tested without Solr.

// Solr returns attributes in its own form (e.g. true or "true", 2 or "2"), so values are compared
// as strings, and only the attributes we define are compared.
function sameDefinition (wanted, current) {
  if (Array.isArray(wanted)) {
    return Array.isArray(current) &&
      wanted.length === current.length &&
      wanted.every((w, i) => sameDefinition(w, current[i]))
  }

  if (wanted !== null && typeof wanted === 'object') {
    if (current === null || typeof current !== 'object') return false
    return Object.keys(wanted).every(key => sameDefinition(wanted[key], current[key]))
  }

  return current !== undefined && String(wanted) === String(current)
}

function byName (list) {
  return new Map((list || []).map(item => [item.name, item]))
}

function copyFieldPairs (copyFields) {
  const pairs = []
  for (const { source, dest } of copyFields || []) {
    for (const d of Array.isArray(dest) ? dest : [dest]) pairs.push({ source, dest: d })
  }
  return pairs
}

/**
 * @param {object} current  { fieldTypes, fields, copyFields } as returned by the Schema API
 * @param {object} wanted   { baseFields, fieldTypes, fields, copyFields } from solr/schema
 * @returns {{ commands: object, summary: string[], reindexNeeded: boolean }}
 */
function planSchemaChanges (current, wanted) {
  const currentTypes = byName(current.fieldTypes)
  const currentFields = byName(current.fields)
  const commands = {}
  const summary = []

  const push = (command, item, description) => {
    if (!commands[command]) commands[command] = []
    commands[command].push(item)
    summary.push(description)
  }

  for (const type of wanted.fieldTypes || []) {
    const existing = currentTypes.get(type.name)
    if (!existing) {
      push('add-field-type', type, `add field type ${type.name}`)
    } else if (!sameDefinition(type, existing)) {
      push('replace-field-type', type, `replace field type ${type.name}`)
    }
  }

  // Base fields are only ever added, never changed, so an existing core keeps what it has
  for (const field of wanted.baseFields || []) {
    if (!currentFields.has(field.name)) push('add-field', field, `add base field ${field.name}`)
  }

  for (const field of wanted.fields || []) {
    const existing = currentFields.get(field.name)
    if (!existing) {
      push('add-field', field, `add field ${field.name}`)
    } else if (!sameDefinition(field, existing)) {
      push('replace-field', field, `replace field ${field.name}`)
    }
  }

  const key = p => `${p.source}>${p.dest}`
  const currentPairs = copyFieldPairs(current.copyFields)
  const wantedPairs = copyFieldPairs(wanted.copyFields)
  const currentKeys = new Set(currentPairs.map(key))
  const wantedKeys = new Set(wantedPairs.map(key))

  // Copy fields into our search fields that are no longer wanted (e.g. a source dropped to keep
  // the index smaller) are removed. Copy fields into any other field are left alone.
  const searchFieldNames = new Set((wanted.fields || []).map(f => f.name))
  for (const pair of currentPairs) {
    if (searchFieldNames.has(pair.dest) && !wantedKeys.has(key(pair))) {
      push('delete-copy-field', { source: pair.source, dest: pair.dest }, `remove copy field ${pair.source} -> ${pair.dest}`)
    }
  }

  for (const pair of wantedPairs) {
    if (!currentKeys.has(key(pair))) {
      push('add-copy-field', pair, `add copy field ${pair.source} -> ${pair.dest}`)
    }
  }

  // Anything that changes how documents are indexed only applies to documents added afterwards
  const reindexNeeded = summary.length > 0

  return { commands, summary, reindexNeeded }
}

module.exports = { planSchemaChanges, sameDefinition }
