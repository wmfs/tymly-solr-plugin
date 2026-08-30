class ReindexBase {
  constructor (functionName, errorCode, schema) {
    this.functionName = functionName
    this.errorCode = errorCode
    this.schema = schema
  }

  init (resourceConfig, env) {
    this.env = env
    this.collection = resourceConfig.collection
  }

  run (event, context) {
    const solrService = this.env.bootedServices.solr
    const errorCode = this.errorCode

    solrService[this.functionName](this.collection, function (err) {
      if (err) {
        context.sendTaskFailure(
          {
            error: errorCode,
            cause: err
          }
        )
      } else {
        context.sendTaskSuccess()
      }
    })
  }
}

module.exports = ReindexBase
