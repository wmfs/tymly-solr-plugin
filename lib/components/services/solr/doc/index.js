'use strict'

module.exports = {
  description: 'Adds Solr support',
  blueprintDirs: {
    'search-docs': 'Each JSON file is used to translates a model document into standard properties for searching. A search doc with "replaces": "<namespace_searchDocName>" is used instead of that search doc, e.g. to extend another blueprint\'s search doc with more roles or launches.'
  }
}
