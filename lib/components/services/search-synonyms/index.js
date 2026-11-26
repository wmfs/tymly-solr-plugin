'use strict'

// Syncs search synonyms from blueprints to Solr on boot.
//
// Each blueprint can have a search-synonyms directory of JSON files, e.g.
//   { "description": "Address abbreviations", "synonyms": [["rd", "road"], ["st", "street"]] }
// Searching for any word or phrase in a group also finds the others (text_search fields only).
//
// On boot, the synonyms of every loaded blueprint replace the contents of Solr's managed synonym
// list (tymly_search), and the core is reloaded if anything changed. No reindex is needed, as
// synonyms are only used when searching. This runs in the background and never fails boot: if
// Solr can't be reached, or the schema hasn't been applied yet (solr/apply-schema.js), it's logged.

const SolrAdmin = require('../../../util/solr-admin')
const { collectSynonymGroups, syncSynonyms } = require('./synonyms')
const { checkSolrSchema } = require('./schema-check')

const CORE = 'tymly'

class SearchSynonymsService {
  async boot (options) {
    this.logger = options.bootedServices.logger.child('service:searchSynonyms')

    const { groups, problems } = collectSynonymGroups(options.blueprintComponents.searchSynonyms)
    this.groups = groups
    for (const problem of problems) this.logger.warn(`Ignoring search synonyms: ${problem}`)

    const solr = options.bootedServices.solr
    if (!solr || !solr.solrUrl) {
      options.messages.info('No Solr URL configured, search synonyms not synced')
      this.synced = Promise.resolve({ status: 'noSolr' })
      this.schemaChecked = Promise.resolve({ status: 'noSolr' })
      return
    }

    options.messages.info(`${groups.length} search synonym group(s) from blueprints`)

    // neither holds up boot; tests can wait for them
    const solrAdmin = new SolrAdmin(solr.solrUrl, CORE)
    this.schemaChecked = this.checkSchema(solrAdmin)
    this.synced = this.sync(solrAdmin)
  }

  // Warns when the Solr schema hasn't been applied, or is a different version, so searches don't
  // quietly get worse after a release that skipped that step
  async checkSchema (solrAdmin) {
    try {
      const result = await checkSolrSchema(solrAdmin)
      if (result.status === 'ok') this.logger.info(result.message)
      else this.logger.warn(result.message)
      return result
    } catch (err) {
      this.logger.warn(`Solr schema not checked: ${err.message}`)
      return { status: 'failed', message: err.message }
    }
  }

  async sync (solrAdmin) {
    try {
      const result = await syncSynonyms(solrAdmin, this.groups)
      if (result.status === 'noManagedList') {
        this.logger.warn('Search synonyms not synced: Solr has no tymly_search synonym list yet. Apply the schema (solr/apply-schema.js) and restart.')
      } else if (result.status === 'updated') {
        this.logger.info(`Search synonyms updated (set: ${result.set.join(', ') || 'none'}; removed: ${result.removed.join(', ') || 'none'}), core reloaded`)
      }
      return result
    } catch (err) {
      this.logger.warn(`Search synonyms not synced: ${err.message}`)
      return { status: 'failed', error: err.message }
    }
  }
}

module.exports = {
  serviceClass: SearchSynonymsService,
  bootAfter: ['solr']
}
