const PREFIX = '%20AND%20rating:'

const isNumeric = n => !isNaN(parseFloat(n)) && isFinite(n)

module.exports = function (input) {
  if (typeof input === 'string') {
    if (input.trim().length === 0) {
      return ''
    }

    if (!isNumeric(input)) {
      return ''
    }

    return `${PREFIX}${input}`
  }

  if (typeof input === 'number') {
    return `${PREFIX}${input}`
  }

  if (Array.isArray(input) && input.length === 2) {
    const [min, max] = input

    if (!isNumeric(min) || !isNumeric(max)) {
      return ''
    }

    return `${PREFIX}[${min}%20TO%20${max}]`
  }

  return ''
}
