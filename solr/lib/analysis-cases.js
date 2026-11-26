'use strict'

// What the search field types should do with example values. check-analysis.js runs these
// against a Solr core with the /analysis/field API.
//   side: 'index' checks the tokens stored for a value, 'query' the tokens searched for
//   includes: tokens that must be produced
//   excludes: tokens that must not be produced (optional)
//   why: what the case shows

module.exports = [
  { why: 'plurals match singulars', fieldType: 'text_search', side: 'index', value: 'West Northlands', includes: ['northland'] },
  { why: 'plurals match singulars', fieldType: 'text_search', side: 'query', value: 'Northland', includes: ['northland'] },
  { why: 'plurals match singulars', fieldType: 'text_search', side: 'index', value: 'Building audits', includes: ['audit'] },
  { why: 'apostrophes: indexed as ada', fieldType: 'text_search', side: 'index', value: "Ada's Kitchen", includes: ['ada'] },
  { why: 'apostrophes: adas searches for ada', fieldType: 'text_search', side: 'query', value: 'adas', includes: ['ada'] },
  { why: "apostrophes: ada's searches for ada", fieldType: 'text_search', side: 'query', value: "Ada's", includes: ['ada'] },
  { why: 'references split and joined up', fieldType: 'text_search', side: 'index', value: 'Reference ABC12/2024', includes: ['abc', '12', '2024', '122024', 'abc122024'] },
  { why: 'a reference typed without its / (searched as the phrase "abc 122024")', fieldType: 'text_search', side: 'query', value: 'ABC122024', includes: ['abc', '122024'] },
  { why: 'a reference typed without its -', fieldType: 'text_search', side: 'index', value: 'REF-00123', includes: ['ref00123'] },
  { why: 'accents', fieldType: 'text_search', side: 'index', value: 'Café Bleu', includes: ['cafe'] },
  { why: 'partial words', fieldType: 'text_prefix', side: 'index', value: 'Brightwater', includes: ['bri', 'brig', 'brightwater'] },
  { why: 'partial references', fieldType: 'text_prefix', side: 'index', value: 'ABC12/2024', includes: ['abc', 'abc1'] },
  { why: 'words written together', fieldType: 'text_shingle', side: 'index', value: 'Oak Hollow Care Home', includes: ['oak', 'hollow', 'oakhollow', 'oakhollowcare'] },
  { why: 'search keys stay whole (a masking number is never split into pieces)', fieldType: 'text_keys', side: 'index', value: '7ZP1ZZLH', includes: ['7zp1zzlh'], excludes: ['7', 'l'] },
  { why: 'search keys: a postcode with and without its space', fieldType: 'text_keys', side: 'index', value: 'ZZ75 7LA', includes: ['zz75', '7la'] },
  { why: 'search keys: punctuation round a typed code is ignored', fieldType: 'text_keys', side: 'query', value: '(7ZNR7DM9),', includes: ['7znr7dm9'] }
]
