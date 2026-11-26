'use strict'

// What the search field types should do with example values. check-analysis.js runs these
// against a Solr core with the /analysis/field API.
//   side: 'index' checks the tokens stored for a value, 'query' the tokens searched for
//   includes: tokens that must be produced
//   excludes: tokens that must not be produced (optional)
//   why: what the case shows

module.exports = [
  { why: 'plurals match singulars', fieldType: 'text_search', side: 'index', value: 'West Midlands', includes: ['midland'] },
  { why: 'plurals match singulars', fieldType: 'text_search', side: 'query', value: 'Midland', includes: ['midland'] },
  { why: 'plurals match singulars', fieldType: 'text_search', side: 'index', value: 'Building audits', includes: ['audit'] },
  { why: 'apostrophes: indexed as uday', fieldType: 'text_search', side: 'index', value: "Uday's Kitchen", includes: ['uday'] },
  { why: 'apostrophes: udays searches for uday', fieldType: 'text_search', side: 'query', value: 'udays', includes: ['uday'] },
  { why: "apostrophes: uday's searches for uday", fieldType: 'text_search', side: 'query', value: "Uday's", includes: ['uday'] },
  { why: 'references split and joined up', fieldType: 'text_search', side: 'index', value: 'Reference ABC12/2024', includes: ['abc', '12', '2024', '122024', 'abc122024'] },
  { why: 'a reference typed without its / (searched as the phrase "abc 122024")', fieldType: 'text_search', side: 'query', value: 'ABC122024', includes: ['abc', '122024'] },
  { why: 'a reference typed without its -', fieldType: 'text_search', side: 'index', value: 'REF-00123', includes: ['ref00123'] },
  { why: 'accents', fieldType: 'text_search', side: 'index', value: 'Café Rouge', includes: ['cafe'] },
  { why: 'partial words', fieldType: 'text_prefix', side: 'index', value: 'Birmingham', includes: ['bir', 'birm', 'birmingham'] },
  { why: 'partial references', fieldType: 'text_prefix', side: 'index', value: 'ABC12/2024', includes: ['abc', 'abc1'] },
  { why: 'words written together', fieldType: 'text_shingle', side: 'index', value: 'Castle Wood Care Home', includes: ['castle', 'wood', 'castlewood', 'castlewoodcare'] },
  { why: 'search keys stay whole (a masking number is never split into pieces)', fieldType: 'text_keys', side: 'index', value: '4DM7L121', includes: ['4dm7l121'], excludes: ['7', 'l'] },
  { why: 'search keys: a postcode with and without its space', fieldType: 'text_keys', side: 'index', value: 'B75 7LA', includes: ['b75', '7la'] },
  { why: 'search keys: punctuation round a typed code is ignored', fieldType: 'text_keys', side: 'query', value: '(7M36CJNX),', includes: ['7m36cjnx'] }
]
