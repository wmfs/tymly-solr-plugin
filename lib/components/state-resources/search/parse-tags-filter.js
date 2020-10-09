module.exports = function (input) {
  const formatTag = tag => `"${tag.replace(/ /g, '%20')}"`

  let tagsStarted = false
  let tags = '%20AND%20tags:('

  input.forEach(ele => {
    if (Array.isArray(ele)) {
      if (ele.length > 1) {
        if (tagsStarted) tags += '%20AND%20'
        tags += `(${ele.map(e => formatTag(e)).join('%20OR%20')})`
        tagsStarted = true
      } else if (ele.length === 1) {
        if (tagsStarted) tags += '%20AND%20'
        tags += formatTag(ele[0])
        tagsStarted = true
      }
    } else {
      if (tagsStarted) tags += '%20AND%20'
      tags += formatTag(ele)
      tagsStarted = true
    }
  })

  tags += ')'

  if (tags === '%20AND%20tags:()') tags = ''

  return tags
}
