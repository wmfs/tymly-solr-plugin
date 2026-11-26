'use strict'

// Search analytics: records that a user opened a search result.

const validateClick = require('./validate-click')

class LogSearchClick {
  init (resourceConfig, env) {
    const { models } = env.bootedServices.storage
    this.searchLogModel = models.tymly_searchLog
    this.searchClickModel = models.tymly_searchClick
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
    const searchLog = await this.searchLogModel.findById(click.searchLogId)
    if (!searchLog || searchLog.userId !== context.userId) {
      return context.sendTaskFailure({
        error: 'unknownSearchLog',
        cause: 'No search found with that searchLogId for this user.'
      })
    }

    await this.searchClickModel.create({
      searchLogId: click.searchLogId,
      userId: context.userId,
      docId: click.docId,
      docType: click.docType,
      position: click.position,
      stateMachineName: click.stateMachineName
    }, {})

    context.sendTaskSuccess()
  }
}

module.exports = LogSearchClick
