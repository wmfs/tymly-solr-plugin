const path = require('path')

module.exports = function installTestSchemas (filename, client) {
  return client.runFile(path.resolve(__dirname, filename))
}
