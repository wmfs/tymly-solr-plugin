'use strict'

// emoji-regex 11 is ESM-only: require() returns its module namespace (Node 20.19+ / 22.12+),
// so take the default export. Older versions export the function directly.
const emojiRegexModule = require('emoji-regex')
const emojiRegex = (emojiRegexModule.default || emojiRegexModule)()

/**
 * Splits a user's search text into words, the same way for both search backends:
 * emojis removed, and `stripPattern` characters removed. Hyphens become spaces when `hyphenToSpace`.
 */
function splitSearchTerms (text, { stripPattern, hyphenToSpace = false }) {
  if (typeof text !== 'string') return []

  let cleaned = text
    .trim()
    .replace(emojiRegex, '')
    .replace(stripPattern, '')

  if (hyphenToSpace) cleaned = cleaned.replace(/-/g, ' ')

  return cleaned
    .split(/\s+/)
    .filter(term => term)
}

module.exports = { splitSearchTerms }
