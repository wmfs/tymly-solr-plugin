'use strict'

// Search analytics (sc-34389): records that a user opened a search result.

const validateClick = require('./validate-click')

class LogSearchClick {
  init (resourceConfig, env) {
    this.client = env.bootedServices.storage.client
  }

  async run (event, context) {
    if (!context.userId) {
      return context.sendTaskFailure({
        error: 'noUserIdSearchClickFail',
        cause: 'No user ID found when trying to log a search click.'
      })
    }

    const click = validateClick(event)
    if (!click) {
      return context.sendTaskFailure({
        error: 'invalidSearchClick',
        cause: 'searchLogId (uuid), docId and position (integer from 1) are required.'
      })
    }

    // Only log against the user's own search
    const { rows } = await this.client.query(
      `insert into tymly.search_click
        (search_log_id, user_id, doc_id, doc_type, position, state_machine_name, _created_by, _modified_by)
        select id::text, user_id, $3, $4, $5, $6, user_id, user_id
        from tymly.search_log
        where id = $1::uuid and user_id = $2
        returning id`,
      [click.searchLogId, context.userId, click.docId, click.docType, click.position, click.stateMachineName]
    )

    if (rows.length === 0) {
      return context.sendTaskFailure({
        error: 'unknownSearchLog',
        cause: 'No search found with that searchLogId for this user.'
      })
    }

    context.sendTaskSuccess()
  }
}

module.exports = LogSearchClick
