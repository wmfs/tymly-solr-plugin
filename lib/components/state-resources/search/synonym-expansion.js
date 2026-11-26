'use strict'

// Solr matches each typed word on its own (sow=true), so its synonym list can never see a phrase
// like "safe and well" and match it to "saw". Instead, before the words go to Solr, any synonym in
// the search text, short form or phrase, becomes "any of them": `saw visit` and `safe and well visit`
// both become `(saw OR "safe and well") visit`. The group counts as one word for mm.
// Single-word groups (rd/road) are left to Solr's own synonym list, which handles them both ways.

const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu
const bare = term => term.toLowerCase().replace(EDGE, '')

// Groups that have at least one phrase, as { alternatives, phrases: [[words]] }, longest phrases first
function phraseGroups (groups = []) {
  return (groups || [])
    .filter(terms => Array.isArray(terms) && terms.some(t => /\s/.test(t)))
    .map(terms => ({ alternatives: terms, phrases: terms.map(t => t.split(/\s+/)) }))
}

/**
 * tokens: [{ term, phrase }] from tokeniseSearchText.
 * Returns the same tokens, with each synonym replaced by { alternatives: ['saw', 'safe and well'] }.
 * Compound words (phrase: true, e.g. SAW12/2024) are never part of a match.
 */
function expandSynonyms (tokens, groups) {
  const candidates = []
  for (const group of phraseGroups(groups)) {
    for (const words of group.phrases) candidates.push({ words, alternatives: group.alternatives })
  }
  if (candidates.length === 0) return tokens
  candidates.sort((a, b) => b.words.length - a.words.length) // longest match wins

  const out = []
  let i = 0
  while (i < tokens.length) {
    const match = candidates.find(({ words }) =>
      words.every((word, k) => tokens[i + k] && !tokens[i + k].phrase && bare(tokens[i + k].term) === word)
    )
    if (match) {
      out.push({ alternatives: match.alternatives })
      i += match.words.length
    } else {
      out.push(tokens[i])
      i++
    }
  }
  return out
}

module.exports = { expandSynonyms }
