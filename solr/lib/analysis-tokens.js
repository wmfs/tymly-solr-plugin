'use strict'

// Pulls the final tokens out of a Solr /analysis/field response. Each side is a list of
// [stageName, tokens, stageName, tokens, ...], and the last tokens are what's indexed or searched.
function finalTokens (response, fieldType, side) {
  const types = response && response.analysis && response.analysis.field_types
  const stages = types && types[fieldType] && types[fieldType][side]
  if (!Array.isArray(stages)) return []

  for (let i = stages.length - 1; i >= 0; i--) {
    if (Array.isArray(stages[i])) return stages[i].map(token => token.text)
  }
  return []
}

module.exports = { finalTokens }
