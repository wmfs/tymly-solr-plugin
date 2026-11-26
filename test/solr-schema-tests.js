/* eslint-env mocha */

'use strict'

const expect = require('chai').expect
const { planSchemaChanges, sameDefinition } = require('../solr/lib/plan-schema-changes')
const { MANAGED_RESOURCE } = require('../lib/components/services/search-synonyms/synonyms')
const { loadWantedSchema } = require('../solr/apply-schema')
const { finalTokens } = require('../solr/lib/analysis-tokens')
const { solrDataRowToDoc } = require('../solr/lib/solr-data-row-to-doc')
const analysisCases = require('../solr/lib/analysis-cases')

const DEFAULT_FIELD_TYPES = ['string', 'boolean', 'pdate', 'pint', 'pfloat', 'plong', 'location', 'text_general']

// What the Schema API returns: the same definitions, but with Solr's own value types
function asSolrReturnsIt (value) {
  if (Array.isArray(value)) return value.map(asSolrReturnsIt)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, asSolrReturnsIt(v)]))
  }
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}

function copyFieldsAsSolrReturnsThem (copyFields) {
  const pairs = []
  for (const { source, dest } of copyFields) {
    for (const d of [].concat(dest)) pairs.push({ source, dest: d })
  }
  return pairs
}

describe('Solr schema (solr/)', () => {
  const schema = loadWantedSchema()

  describe('schema files', () => {
    const typeNames = schema.fieldTypes.map(t => t.name)
    const fieldNames = [...schema.baseFields, ...schema.fields].map(f => f.name)

    it('every field uses a defined or default field type', () => {
      for (const field of [...schema.baseFields, ...schema.fields]) {
        expect([...typeNames, ...DEFAULT_FIELD_TYPES], field.name).to.include(field.type)
      }
    })

    it('every copy field goes from a base field to a search field', () => {
      for (const { source, dest } of schema.copyFields) {
        expect(schema.baseFields.map(f => f.name)).to.include(source)
        for (const d of [].concat(dest)) expect(schema.fields.map(f => f.name)).to.include(d)
      }
    })

    it('field names are unique', () => {
      expect(new Set(fieldNames).size).to.equal(fieldNames.length)
    })

    it('text_search generates phrase queries for words it splits', () => {
      const textSearch = schema.fieldTypes.find(t => t.name === 'text_search')
      expect(textSearch.autoGeneratePhraseQueries).to.equal('true')
    })

    it('text_search searches with the managed synonym list the searchSynonyms service fills', () => {
      const textSearch = schema.fieldTypes.find(t => t.name === 'text_search')
      const synonymFilter = textSearch.queryAnalyzer.filters.find(f => f.class === 'solr.ManagedSynonymGraphFilterFactory')
      expect(synonymFilter.managed).to.equal(MANAGED_RESOURCE)
    })

    it('the query analyser has only one graph filter, as SynonymGraph cannot take a graph as input', () => {
      const textSearch = schema.fieldTypes.find(t => t.name === 'text_search')
      const wordDelimiter = textSearch.queryAnalyzer.filters.find(f => f.class === 'solr.WordDelimiterGraphFilterFactory')
      // no stacked tokens from the word delimiter, so the synonym filter gets a simple token stream
      expect(wordDelimiter.preserveOriginal).to.equal('0')
      for (const option of ['catenateWords', 'catenateNumbers', 'catenateAll']) {
        expect(wordDelimiter[option] || '0', option).to.equal('0')
      }
    })

    it('has a uprns field for filtering on related UPRNs', () => {
      expect(schema.fields.find(f => f.name === 'uprns')).to.include({ type: 'string', multiValued: true, docValues: true })
    })

    it('every analysis check uses a field type defined here', () => {
      for (const c of analysisCases) expect(typeNames).to.include(c.fieldType)
    })
  })

  describe('sameDefinition', () => {
    it('compares values as strings, as Solr returns some as booleans or numbers', () => {
      expect(sameDefinition({ indexed: 'true', size: '2' }, { indexed: true, size: 2 })).to.equal(true)
    })
    it('ignores attributes we do not define', () => {
      expect(sameDefinition({ indexed: true }, { indexed: true, stored: false })).to.equal(true)
    })
    it('spots a different or missing value', () => {
      expect(sameDefinition({ indexed: true }, { indexed: false })).to.equal(false)
      expect(sameDefinition({ indexed: true }, {})).to.equal(false)
    })
    it('compares lists in order', () => {
      expect(sameDefinition([{ class: 'a' }, { class: 'b' }], [{ class: 'b' }, { class: 'a' }])).to.equal(false)
      expect(sameDefinition([{ class: 'a' }], [{ class: 'a' }, { class: 'b' }])).to.equal(false)
    })
  })

  describe('planSchemaChanges', () => {
    it('removes the old docId -> searchText copy field from a core that has it', () => {
      const plan = planSchemaChanges({
        fieldTypes: [],
        fields: [],
        copyFields: [{ source: 'docId', dest: 'searchText' }]
      }, schema)
      expect(plan.commands['delete-copy-field']).to.eql([{ source: 'docId', dest: 'searchText' }])
      expect(plan.reindexNeeded).to.equal(true)
    })

    it('a new core: adds the field types, base fields, search fields and copy fields', () => {
      const plan = planSchemaChanges({ fieldTypes: [], fields: [], copyFields: [] }, schema)

      expect(Object.keys(plan.commands)).to.eql(['add-field-type', 'add-field', 'add-copy-field'])
      expect(plan.commands['add-field-type'].map(t => t.name)).to.eql(['text_search', 'text_prefix', 'text_shingle', 'text_keys'])
      expect(plan.commands['add-field']).to.have.length(schema.baseFields.length + schema.fields.length)
      expect(plan.commands['add-copy-field']).to.deep.include({ source: 'title', dest: 'searchText' })
      expect(plan.commands['add-copy-field']).to.not.deep.include({ source: 'docId', dest: 'searchText' })
      expect(plan.reindexNeeded).to.equal(true)
    })

    it('an existing core with only the base fields: adds just the search parts', () => {
      const plan = planSchemaChanges({ fieldTypes: [], fields: asSolrReturnsIt(schema.baseFields), copyFields: [] }, schema)

      expect(plan.commands['add-field'].map(f => f.name)).to.eql(['searchText', 'searchPrefix', 'searchShingle', 'searchKeys', 'uprns'])
      expect(plan.commands['replace-field']).to.equal(undefined)
    })

    it('already applied: nothing to do', () => {
      const current = {
        fieldTypes: asSolrReturnsIt(schema.fieldTypes),
        fields: asSolrReturnsIt([...schema.baseFields, ...schema.fields]),
        copyFields: copyFieldsAsSolrReturnsThem(schema.copyFields)
      }
      const plan = planSchemaChanges(current, schema)
      expect(plan.summary).to.eql([])
      expect(plan.commands).to.eql({})
      expect(plan.reindexNeeded).to.equal(false)
    })

    it('a changed field type or search field is replaced', () => {
      const types = asSolrReturnsIt(schema.fieldTypes)
      types[1].indexAnalyzer.filters[2].maxGramSize = '20'
      const fields = asSolrReturnsIt([...schema.baseFields, ...schema.fields])
      fields.find(f => f.name === 'uprns').stored = false

      const plan = planSchemaChanges({ fieldTypes: types, fields, copyFields: copyFieldsAsSolrReturnsThem(schema.copyFields) }, schema)
      expect(plan.summary).to.eql(['replace field type text_prefix', 'replace field uprns'])
      expect(plan.reindexNeeded).to.equal(true)
    })

    it('removes copy fields into the search fields that are no longer wanted, and leaves others alone', () => {
      const current = {
        fieldTypes: asSolrReturnsIt(schema.fieldTypes),
        fields: asSolrReturnsIt([...schema.baseFields, ...schema.fields]),
        copyFields: [
          ...copyFieldsAsSolrReturnsThem(schema.copyFields),
          { source: 'synopsis', dest: 'searchPrefix' },
          { source: 'additionalTerms', dest: 'searchShingle' },
          { source: 'title', dest: 'someoneElsesField' }
        ]
      }
      const plan = planSchemaChanges(current, schema)
      expect(plan.commands['delete-copy-field']).to.eql([
        { source: 'synopsis', dest: 'searchPrefix' },
        { source: 'additionalTerms', dest: 'searchShingle' }
      ])
      expect(plan.reindexNeeded).to.equal(true)
    })

    it('search keys (additionalTerms) go only into searchKeys, kept whole, not into searchText', () => {
      const intoField = dest => schema.copyFields.filter(c => [].concat(c.dest).includes(dest)).map(c => c.source)
      expect(intoField('searchKeys')).to.eql(['additionalTerms'])
      expect(intoField('searchText')).to.not.include('additionalTerms')
      const keys = schema.fieldTypes.find(t => t.name === 'text_keys')
      for (const analyzer of [keys.indexAnalyzer, keys.queryAnalyzer]) {
        expect(analyzer.tokenizer.class).to.equal('solr.WhitespaceTokenizerFactory')
        expect(analyzer.filters.map(f => f.class)).to.not.include('solr.WordDelimiterGraphFilterFactory')
      }
    })

    it('an existing core moves additionalTerms from searchText to searchKeys', () => {
      const current = {
        fieldTypes: asSolrReturnsIt(schema.fieldTypes.filter(t => t.name !== 'text_keys')),
        fields: asSolrReturnsIt([...schema.baseFields, ...schema.fields.filter(f => f.name !== 'searchKeys')]),
        copyFields: [
          ...copyFieldsAsSolrReturnsThem(schema.copyFields.filter(c => c.source !== 'additionalTerms')),
          { source: 'additionalTerms', dest: 'searchText' }
        ]
      }
      const plan = planSchemaChanges(current, schema)
      expect(plan.commands['add-field-type'].map(t => t.name)).to.eql(['text_keys'])
      expect(plan.commands['add-field'].map(f => f.name)).to.eql(['searchKeys'])
      expect(plan.commands['delete-copy-field']).to.eql([{ source: 'additionalTerms', dest: 'searchText' }])
      expect(plan.commands['add-copy-field']).to.eql([{ source: 'additionalTerms', dest: 'searchKeys' }])
    })

    it('partial and joined words come from title and description only', () => {
      const intoField = dest => schema.copyFields.filter(c => [].concat(c.dest).includes(dest)).map(c => c.source)
      expect(intoField('searchPrefix')).to.eql(['title', 'description'])
      expect(intoField('searchShingle')).to.eql(['title', 'description'])
    })

    it('partial words are 3 to 10 letters, to keep the index smaller', () => {
      const prefix = schema.fieldTypes.find(t => t.name === 'text_prefix')
      const edgeNGram = prefix.indexAnalyzer.filters.find(f => f.class === 'solr.EdgeNGramFilterFactory')
      expect(edgeNGram).to.include({ minGramSize: '3', maxGramSize: '10' })
    })

    it('never changes an existing base field', () => {
      const fields = asSolrReturnsIt(schema.baseFields)
      fields.find(f => f.name === 'title').stored = false
      const plan = planSchemaChanges({ fieldTypes: [], fields, copyFields: [] }, schema)
      expect(plan.summary).to.not.include('replace field title')
      expect(plan.summary).to.not.include('add base field title')
      expect(plan.commands['replace-field']).to.equal(undefined)
    })
  })

  describe('finalTokens', () => {
    const response = {
      analysis: {
        field_types: {
          text_search: {
            index: [
              'org.apache.lucene.analysis.core.WhitespaceTokenizer', [{ text: "Uday's" }],
              'org.apache.lucene.analysis.core.LowerCaseFilter', [{ text: 'uday' }, { text: 'udays' }]
            ]
          }
        }
      }
    }
    it('returns the tokens from the last stage', () => {
      expect(finalTokens(response, 'text_search', 'index')).to.eql(['uday', 'udays'])
    })
    it('returns nothing when the field type or side is missing', () => {
      expect(finalTokens(response, 'text_search', 'query')).to.eql([])
      expect(finalTokens({}, 'text_search', 'index')).to.eql([])
    })
  })

  describe('solrDataRowToDoc', () => {
    it('camelCases columns and leaves out empty values', () => {
      expect(solrDataRowToDoc({ doc_id: '1', additional_terms: [], roles: ['a'], synopsis: null, active_event: false }))
        .to.eql({ docId: '1', roles: ['a'], activeEvent: false })
    })
  })
})
