'use strict'

// Small wrapper round the Solr Schema API, managed resources and core admin (standalone Solr).

const axios = require('axios')

class SolrAdmin {
  // solrUrl e.g. http://localhost:8983/solr
  constructor (solrUrl, core) {
    this.solrUrl = solrUrl.replace(/\/+$/, '')
    this.core = core
    this.coreUrl = `${this.solrUrl}/${encodeURIComponent(core)}`
  }

  async getSchema () {
    const [fieldTypes, fields, copyFields] = await Promise.all([
      this.get('/schema/fieldtypes', { showDefaults: false }).then(r => r.fieldTypes),
      this.get('/schema/fields', { showDefaults: false }).then(r => r.fields),
      this.get('/schema/copyfields').then(r => r.copyFields)
    ])
    return { fieldTypes, fields, copyFields }
  }

  async updateSchema (commands) {
    const result = await this.post('/schema', commands)
    if (result.errors) {
      throw new Error(`Schema update failed: ${JSON.stringify(result.errors)}`)
    }
    return result
  }

  // Returns null if the managed resource doesn't exist, i.e. no field type uses it yet
  async getSynonyms (resource) {
    try {
      const result = await this.get(`/schema/analysis/synonyms/${encodeURIComponent(resource)}`)
      return (result.synonymMappings && result.synonymMappings.managedMap) || {}
    } catch (err) {
      if (err.response && err.response.status === 404) return null
      throw err
    }
  }

  async putSynonyms (resource, map) {
    return this.request('put', `/schema/analysis/synonyms/${encodeURIComponent(resource)}`, map)
  }

  async deleteSynonym (resource, term) {
    return this.request('delete', `/schema/analysis/synonyms/${encodeURIComponent(resource)}/${encodeURIComponent(term)}`)
  }

  // User properties saved in the core's config (Config API), e.g. the schema version stamp
  async getUserProps () {
    const result = await this.get('/config/overlay')
    return (result.overlay && result.overlay.userProps) || {}
  }

  async setUserProps (props) {
    return this.post('/config', { 'set-user-property': props })
  }

  // Changes to a managed resource only take effect once the core is reloaded
  async reloadCore () {
    const { data } = await axios.get(`${this.solrUrl}/admin/cores`, {
      params: { action: 'RELOAD', core: this.core, wt: 'json' }
    })
    return data
  }

  async analyse (fieldType, { index, query }) {
    const params = { 'analysis.fieldtype': fieldType, wt: 'json' }
    if (index !== undefined) params['analysis.fieldvalue'] = index
    if (query !== undefined) params['analysis.query'] = query
    return this.get('/analysis/field', params)
  }

  get (path, params = {}) {
    return this.request('get', path, undefined, params)
  }

  post (path, body) {
    return this.request('post', path, body)
  }

  async request (method, path, data, params = {}) {
    const { data: result } = await axios({
      method,
      url: `${this.coreUrl}${path}`,
      data,
      params: { wt: 'json', ...params },
      headers: data !== undefined ? { 'Content-Type': 'application/json' } : undefined
    })
    return result
  }
}

module.exports = SolrAdmin
