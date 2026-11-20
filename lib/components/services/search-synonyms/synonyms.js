'use strict'

// The managed synonym list used by the text_search field type (solr/schema/search-fields.json)
const MANAGED_RESOURCE = 'tymly_search'

// Turns the searchSynonyms blueprint components into synonym groups. Each component is
//   { "description": "...", "synonyms": [["st", "street"], ["saw", "safe and well"]] }
// Returns { groups, problems }: invalid components or groups are reported, not used.
function collectSynonymGroups (components) {
  const groups = []
  const problems = []

  for (const [name, component] of Object.entries(components || {})) {
    const list = component && component.synonyms
    if (!Array.isArray(list)) {
      problems.push(`${name}: "synonyms" should be a list of groups`)
      continue
    }

    list.forEach((group, i) => {
      const terms = Array.isArray(group)
        ? [...new Set(group.filter(t => typeof t === 'string').map(t => t.trim().toLowerCase()).filter(t => t))]
        : []
      if (terms.length < 2 || terms.length !== group.length) {
        problems.push(`${name}: group ${i + 1} should be a list of at least two words or phrases`)
        return
      }
      groups.push(terms)
    })
  }

  return { groups, problems }
}

// Each group becomes a mapping from every term to the others in its group. A term in several
// groups maps to the terms of all of them.
function synonymMap (groups) {
  const map = {}
  for (const terms of groups) {
    for (const term of terms) {
      const others = terms.filter(t => t !== term)
      map[term] = [...new Set([...(map[term] || []), ...others])].sort()
    }
  }
  return map
}

// What to send to Solr to make its managed list match the groups: terms to set, terms to remove
function planSynonymChanges (currentMap, groups) {
  const wantedMap = synonymMap(groups)
  const put = {}

  for (const [term, synonyms] of Object.entries(wantedMap)) {
    const existing = [...(currentMap[term] || [])].sort()
    if (existing.join('|') !== synonyms.join('|')) put[term] = synonyms
  }

  const remove = Object.keys(currentMap).filter(term => !wantedMap[term]).sort()

  return { put, remove, changed: Object.keys(put).length > 0 || remove.length > 0 }
}

// Brings Solr's managed synonym list in line with the groups, and reloads the core if anything
// changed (managed resources only take effect on reload). Returns what happened.
async function syncSynonyms (solrAdmin, groups) {
  const current = await solrAdmin.getSynonyms(MANAGED_RESOURCE)
  if (current === null) return { status: 'noManagedList' }

  const plan = planSynonymChanges(current, groups)
  if (!plan.changed) return { status: 'upToDate', terms: Object.keys(current).length }

  if (Object.keys(plan.put).length) await solrAdmin.putSynonyms(MANAGED_RESOURCE, plan.put)
  for (const term of plan.remove) await solrAdmin.deleteSynonym(MANAGED_RESOURCE, term)
  await solrAdmin.reloadCore()

  return { status: 'updated', set: Object.keys(plan.put), removed: plan.remove }
}

module.exports = { MANAGED_RESOURCE, collectSynonymGroups, synonymMap, planSynonymChanges, syncSynonyms }
