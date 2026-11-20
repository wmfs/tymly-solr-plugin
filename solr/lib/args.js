'use strict'

// Minimal --name value / --flag parsing for the solr scripts
function parseArgs (argv, defaults = {}) {
  const args = { ...defaults }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const name = arg.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      args[name] = true
    } else {
      args[name] = next
      i++
    }
  }
  return args
}

module.exports = parseArgs
