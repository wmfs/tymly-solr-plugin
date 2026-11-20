'use strict'

// A search doc can replace another one from a different blueprint:
//   { "replaces": "wmfs_expandedGazetteerView", "viewId": "...", "attributeMapping": { ... } }
// The replaced doc is then left out of the index, and updateDocsBySearchDoc steps that name it
// use the replacing doc instead. This lets a blueprint extend another blueprint's search doc
// (e.g. with more roles or launches) without the other blueprint knowing about it. The replacing
// doc should build the same id and docId as the one it replaces.

// Returns the search docs to index ({ name: doc }) and which doc replaces which ({ replaced: replacing })
function resolveSearchDocs (searchDocs = {}) {
  const replacedBy = {}

  for (const [name, doc] of Object.entries(searchDocs)) {
    const target = doc && doc.replaces
    if (!target) continue
    if (target === name) throw new Error(`Search doc ${name} replaces itself`)
    if (replacedBy[target]) {
      throw new Error(`Search doc ${target} is replaced by both ${replacedBy[target]} and ${name}`)
    }
    replacedBy[target] = name
  }

  const active = {}
  for (const [name, doc] of Object.entries(searchDocs)) {
    if (!replacedBy[name]) active[name] = doc
  }

  return { active, replacedBy }
}

// The search doc to use for a name, following replacements: { name, searchDoc }
function findSearchDoc (searchDocs = {}, name) {
  const { replacedBy } = resolveSearchDocs(searchDocs)
  const seen = new Set([name])
  let current = name

  while (replacedBy[current]) {
    current = replacedBy[current]
    if (seen.has(current)) throw new Error(`Search docs replace each other in a loop: ${[...seen, current].join(' -> ')}`)
    seen.add(current)
  }

  return { name: current, searchDoc: searchDocs[current] }
}

module.exports = { resolveSearchDocs, findSearchDoc }
