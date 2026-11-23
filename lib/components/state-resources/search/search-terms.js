'use strict'

// emoji-regex 11 is ESM-only: require() returns its module namespace (Node 20.19+ / 22.12+),
// so take the default export. Older versions export the function directly.
const emojiRegexModule = require('emoji-regex')
const emojiRegex = (emojiRegexModule.default || emojiRegexModule)()

// A compound word: letters/digits joined by / or -, e.g. FSC493/2024, FSC-00123, 14-20, Stoke-on-Trent.
// Solr splits these into several words when indexing, so they are searched as a phrase
// (the parts next to each other, in order) instead of as separate words.
// Nothing here is specific to any blueprint's reference format.
const COMPOUND_WORD = /^[A-Za-z0-9]+(?:[/-][A-Za-z0-9]+)+$/
const EDGE_PUNCTUATION = /^[("'.,;:!?]+|[)"'.,;:!?]+$/g

function isCompoundWord (word) {
  return COMPOUND_WORD.test(word)
}

/**
 * Splits a user's search text into words, the same way for both search backends.
 * Emojis are removed. Compound words (see above) are kept whole and flagged as phrases.
 * Other words have any `stripPattern` characters removed, and hyphens become spaces when `hyphenToSpace`.
 * Returns [{ term, phrase }]
 */
function tokeniseSearchText (text, { stripPattern = null, hyphenToSpace = false } = {}) {
  if (typeof text !== 'string') return []

  const words = text
    .trim()
    .replace(emojiRegex, '')
    .split(/\s+/)
    .filter(word => word)

  const tokens = []
  for (const word of words) {
    const bare = word.replace(EDGE_PUNCTUATION, '')
    if (isCompoundWord(bare)) {
      tokens.push({ term: bare, phrase: true })
      continue
    }

    let cleaned = stripPattern ? word.replace(stripPattern, '') : word
    if (hyphenToSpace) cleaned = cleaned.replace(/-/g, ' ')

    for (const term of cleaned.split(/\s+/)) {
      if (term) tokens.push({ term, phrase: false })
    }
  }

  return tokens
}

module.exports = { tokeniseSearchText, isCompoundWord }
