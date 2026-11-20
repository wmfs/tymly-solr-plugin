'use strict'

// Search analytics (sc-34389): deletes old tymly.search_log and tymly.search_click rows.
//
// The retention period is a registry key (solr-blueprint/registry-keys), read from
// tymly_registryKey each time old rows are deleted, so changing it in the database takes effect
// without a restart. On first boot the key is created from its environment variable if set,
// otherwise its default:
//
//   tymly_searchLogRetentionDays   SEARCH_LOG_RETENTION_DAYS   365
//
// Old rows are deleted on boot and then once a day.

const RETENTION_SETTING = {
  key: 'tymly_searchLogRetentionDays',
  env: 'SEARCH_LOG_RETENTION_DAYS',
  default: 365,
  min: 1
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000

const TABLES = ['tymly.search_click', 'tymly.search_log']

class SearchAnalyticsService {
  async boot (options) {
    const { storage } = options.bootedServices
    this.client = storage.client
    this.registryKeyModel = storage.models.tymly_registryKey || null
    this.timer = null

    // environment variable or default until the registry has been read
    this.retentionDays = parseRetentionDays(process.env[RETENTION_SETTING.env])

    if (!this.client) {
      options.messages.info('Search analytics: no database client, old rows will not be deleted')
      return
    }

    // doesn't hold up boot
    this.deleteOldRows()
      .then(() => options.messages.info(`Search analytics: keeping ${this.retentionDays} days`))
      .catch(err => console.log('Search analytics: could not delete old rows', err.message))

    this.scheduleDailyCleanup()
  }

  // Reads the retention period from tymly_registryKey. A missing or invalid value keeps the current one.
  async loadRetentionDays () {
    if (!this.registryKeyModel) return this.retentionDays

    try {
      const doc = await this.registryKeyModel.findById(RETENTION_SETTING.key)
      const raw = doc && doc.value ? doc.value.value : undefined
      const days = parseRetentionDays(raw, null)

      if (days === null) {
        if (raw !== undefined && raw !== null && raw !== '') {
          console.log(`Search analytics: ignoring invalid ${RETENTION_SETTING.key} value '${raw}'`)
        }
      } else {
        this.retentionDays = days
      }
    } catch (err) {
      console.log(`Search analytics: could not read ${RETENTION_SETTING.key}`, err.message)
    }

    return this.retentionDays
  }

  async deleteOldRows () {
    const days = await this.loadRetentionDays()

    for (const table of TABLES) {
      await this.client.query(
        `DELETE FROM ${table} WHERE _created < now() - ($1::integer * interval '1 day')`,
        [days]
      )
    }
  }

  scheduleDailyCleanup () {
    this.timer = setInterval(() => {
      this.deleteOldRows()
        .catch(err => console.log('Search analytics: could not delete old rows', err.message))
    }, ONE_DAY_MS)

    // don't keep the process alive just for this
    if (this.timer.unref) this.timer.unref()
  }

  shutdown () {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}

// Returns the fallback (by default the setting's default) when the value is missing or invalid
function parseRetentionDays (raw, fallback = RETENTION_SETTING.default) {
  if (raw === undefined || raw === null || raw === '') return fallback
  const n = Number(raw)
  return Number.isInteger(n) && n >= RETENTION_SETTING.min ? n : fallback
}

module.exports = {
  serviceClass: SearchAnalyticsService,
  bootAfter: ['storage', 'registry'],
  // exported for tests
  RETENTION_SETTING,
  parseRetentionDays
}
