'use strict'

// Characters with a special meaning in Lucene/Solr query syntax
const LUCENE_SPECIAL_CHARS = /[+\-!(){}[\]^"~*?:\\/&|]/g
const LUCENE_OPERATORS = ['AND', 'OR', 'NOT']

class InvalidSearchInputError extends Error {
  constructor (message) {
    super(message)
    this.name = 'InvalidSearchInputError'
  }
}

/**
 * Escapes a single search word so Solr treats it as text, never as query syntax.
 * Upper-case AND/OR/NOT typed by a user are lower-cased so they aren't read as operators.
 */
function escapeTerm (term) {
  const s = String(term)
  if (LUCENE_OPERATORS.includes(s)) return s.toLowerCase()
  return s
    .replace(LUCENE_SPECIAL_CHARS, '\\$&')
    .replace(/\s/g, '\\ ')
}

/**
 * Wraps a value in double quotes for an exact match, escaping any quotes or backslashes inside it.
 */
function quoteValue (value) {
  return '"' + String(value).replace(/["\\]/g, '\\$&') + '"'
}

/**
 * ("a" OR "b" OR ...) - each value quoted and escaped
 */
function quoteList (values, operator = 'OR') {
  return '(' + values.map(quoteValue).join(` ${operator} `) + ')'
}

module.exports = {
  escapeTerm,
  quoteValue,
  quoteList,
  InvalidSearchInputError
}
