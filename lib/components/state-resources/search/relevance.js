'use strict'

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Starting values for relevance ranking. See "Search relevance" in the README before changing them.
 *   qf - the fields searched, and how much a match in each one counts
 *   pf - extra score when the words appear together, in order, in these fields
 *   mm - how many words must match: 1-2 words all, 3-5 words all but one, more than 5 words 75%
 *   docIdBoost - extra score when the whole search text is exactly a record's docId
 *   stopwords - words left out of the search, unless they are all the user typed
 */
const DEFAULT_RELEVANCE = Object.freeze({
  qf: 'title^2 searchText searchPrefix^0.5 searchShingle^0.5',
  pf: 'title^3 description^2',
  mm: '2<-1 5<75%',
  docIdBoost: 10,
  stopwords: Object.freeze(['and', 'of', 'the'])
})

/**
 * Merges the plugin defaults with every blueprint's search-relevance component:
 *   {
 *     "description": "...",
 *     "stopwords": ["ltd"],
 *     "boostPatterns": [
 *       { "description": "...", "pattern": "regex", "flags": "i", "field": "additionalTerms", "boost": 5, "removeSpaces": true }
 *     ]
 *   }
 * A boost pattern finds a value in the search text and boosts records whose `field` contains that value.
 * Invalid entries are skipped with a warning, so a bad component never stops Tymly booting.
 */
function loadRelevanceSettings (components, warn = () => {}) {
  const stopwords = new Set(DEFAULT_RELEVANCE.stopwords)
  const boostPatterns = []

  for (const [name, component] of Object.entries(components || {})) {
    for (const word of asArray(component && component.stopwords)) {
      if (typeof word === 'string' && word.trim()) {
        stopwords.add(word.trim().toLowerCase())
      } else {
        warn(`search-relevance ${name}: ignoring stopword ${JSON.stringify(word)}`)
      }
    }

    asArray(component && component.boostPatterns).forEach((bp, i) => {
      const boostPattern = parseBoostPattern(bp)
      if (boostPattern) {
        boostPatterns.push(boostPattern)
      } else {
        warn(`search-relevance ${name}: ignoring invalid boostPatterns[${i}]`)
      }
    })
  }

  return {
    ...DEFAULT_RELEVANCE,
    stopwords,
    boostPatterns
  }
} // loadRelevanceSettings

function parseBoostPattern (bp) {
  if (!bp || typeof bp.pattern !== 'string' || bp.pattern === '') return null
  if (typeof bp.field !== 'string' || !FIELD_NAME.test(bp.field)) return null

  const boost = Number(bp.boost)
  if (!Number.isFinite(boost) || boost <= 0) return null

  let regex
  try {
    const flags = String(bp.flags || '').replace(/[^imsu]/g, '')
    regex = new RegExp(bp.pattern, flags + 'g')
  } catch (err) {
    return null
  }

  return {
    regex,
    field: bp.field,
    boost,
    removeSpaces: bp.removeSpaces === true
  }
} // parseBoostPattern

const asArray = value => Array.isArray(value) ? value : []

module.exports = {
  DEFAULT_RELEVANCE,
  loadRelevanceSettings
}
