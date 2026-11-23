'use strict'

const axios = require('axios')

const DEFAULT_TIMEOUT_MS = 30000

/**
 * An error from Solr, or from failing to reach it. Always a normal rejected promise, never thrown
 * outside one, so a Solr problem fails only the search or task that hit it, never the whole process.
 */
class SolrError extends Error {
  constructor (message, { status = null, code = null } = {}) {
    super(message)
    this.name = 'SolrError'
    this.status = status // HTTP status from Solr, e.g. 400; null if Solr wasn't reached
    this.code = code // e.g. ECONNREFUSED, ECONNABORTED (timeout)
  }

  // so the error shows something useful when logged or sent back as a task failure's cause
  toJSON () {
    return { name: this.name, message: this.message, status: this.status, code: this.code }
  }
}

/**
 * The few Solr calls Tymly makes, over plain HTTP:
 *   search(params) - /select, returns Solr's JSON response
 *   add(docs), deleteByQuery(query), commit() - /update
 */
class SolrClient {
  constructor ({ host, port, path, core = 'tymly', timeout = DEFAULT_TIMEOUT_MS, http = axios }) {
    const base = String(path || '').replace(/\/+$/, '')
    this.coreUrl = `http://${host}:${port}${base}/${encodeURIComponent(core)}`
    this.timeout = timeout
    this.http = http
  }

  /**
   * params is a plain object; an array value is sent as the same parameter repeated (fq, bq, facet.field).
   * Sent as a POST form so a long query never runs past the maximum URL length.
   */
  async search (params) {
    const form = new URLSearchParams()
    for (const [key, value] of Object.entries({ ...params, wt: 'json' })) {
      if (value === undefined || value === null) continue
      for (const v of Array.isArray(value) ? value : [value]) form.append(key, String(v))
    }

    return this.request({
      method: 'post',
      url: `${this.coreUrl}/select`,
      data: form.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    })
  }

  add (docs) {
    return this.update(Array.isArray(docs) ? docs : [docs])
  }

  deleteByQuery (query) {
    return this.update({ delete: { query } })
  }

  commit () {
    return this.update({ commit: {} })
  }

  update (body) {
    return this.request({
      method: 'post',
      url: `${this.coreUrl}/update`,
      params: { wt: 'json' },
      data: body,
      headers: { 'Content-Type': 'application/json' }
    })
  }

  async request (config) {
    try {
      const res = await this.http({ ...config, timeout: this.timeout, responseType: 'json' })
      return res.data
    } catch (err) {
      throw toSolrError(err)
    }
  }
}

function toSolrError (err) {
  const res = err && err.response
  if (res) {
    // Solr's own message when it gives one, e.g. "undefined field searchText"
    const solrMessage = res.data && res.data.error && res.data.error.msg
    return new SolrError(`Solr ${res.status}: ${solrMessage || res.statusText || 'error'}`, { status: res.status })
  }

  const code = (err && err.code) || null
  const reason = code === 'ECONNABORTED' || code === 'ETIMEDOUT' ? 'timed out' : (err && err.message) || 'request failed'
  return new SolrError(`Solr not reachable: ${reason}`, { code })
}

module.exports = { SolrClient, SolrError, DEFAULT_TIMEOUT_MS }
