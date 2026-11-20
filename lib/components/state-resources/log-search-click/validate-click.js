'use strict'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function optionalString (value, maxLength) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > maxLength) throw new Error()
  return value
}

function validateClick (event) {
  const { searchLogId, docId, position } = event || {}

  if (typeof searchLogId !== 'string' || !UUID.test(searchLogId)) return null
  if (typeof docId !== 'string' || docId === '' || docId.length > 500) return null
  if (!Number.isInteger(position) || position < 1 || position > 100000) return null

  try {
    return {
      searchLogId,
      docId,
      position,
      docType: optionalString(event.docType, 200),
      stateMachineName: optionalString(event.stateMachineName, 200)
    }
  } catch (e) {
    return null
  }
}

module.exports = validateClick
