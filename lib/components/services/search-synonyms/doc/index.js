'use strict'

module.exports = {
  description: 'Syncs search synonyms from blueprints to Solr\'s managed synonym list on boot',
  blueprintDirs: {
    'search-synonyms': 'Each JSON file holds groups of words or phrases that mean the same thing when searching, e.g. { "description": "...", "synonyms": [["rd", "road"]] }.'
  }
}
