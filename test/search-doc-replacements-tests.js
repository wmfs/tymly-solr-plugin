/* eslint-env mocha */

'use strict'

const expect = require('chai').expect
const { resolveSearchDocs, findSearchDoc } = require('../lib/util/search-doc-replacements')
const UpdateDocsBySearchDoc = require('../lib/components/state-resources/update-docs-by-search-doc')

describe('search docs replacing other search docs', () => {
  const publicDoc = { viewId: 'pub_view', attributeMapping: { id: 'a' } }
  const privateDoc = { replaces: 'pub_property', viewId: 'priv_view', attributeMapping: { id: 'a' } }
  const other = { modelId: 'other_model', attributeMapping: { id: 'b' } }

  describe('resolveSearchDocs', () => {
    it('leaves the replaced doc out of the docs to index', () => {
      const { active, replacedBy } = resolveSearchDocs({ pub_property: publicDoc, priv_property: privateDoc, other_doc: other })
      expect(Object.keys(active)).to.eql(['priv_property', 'other_doc'])
      expect(replacedBy).to.eql({ pub_property: 'priv_property' })
    })

    it('a replacement whose target is not loaded is just indexed', () => {
      const { active, replacedBy } = resolveSearchDocs({ priv_property: privateDoc })
      expect(Object.keys(active)).to.eql(['priv_property'])
      expect(replacedBy).to.eql({ pub_property: 'priv_property' })
    })

    it('no replacements: everything is indexed', () => {
      expect(resolveSearchDocs({ pub_property: publicDoc }).active).to.eql({ pub_property: publicDoc })
      expect(resolveSearchDocs(undefined)).to.eql({ active: {}, replacedBy: {} })
    })

    it('two docs replacing the same doc is an error', () => {
      expect(() => resolveSearchDocs({ a: { replaces: 'x' }, b: { replaces: 'x' } })).to.throw('replaced by both a and b')
    })

    it('a doc replacing itself is an error', () => {
      expect(() => resolveSearchDocs({ a: { replaces: 'a' } })).to.throw('replaces itself')
    })
  })

  describe('findSearchDoc', () => {
    const docs = { pub_property: publicDoc, priv_property: privateDoc, other_doc: other }

    it('a replaced name finds the replacing doc', () => {
      expect(findSearchDoc(docs, 'pub_property')).to.eql({ name: 'priv_property', searchDoc: privateDoc })
    })

    it('other names find themselves', () => {
      expect(findSearchDoc(docs, 'other_doc')).to.eql({ name: 'other_doc', searchDoc: other })
      expect(findSearchDoc(docs, 'priv_property').name).to.equal('priv_property')
    })

    it('follows a chain of replacements', () => {
      const third = { replaces: 'priv_property', attributeMapping: {} }
      expect(findSearchDoc({ ...docs, third_property: third }, 'pub_property').name).to.equal('third_property')
    })

    it('an unknown name finds nothing', () => {
      expect(findSearchDoc(docs, 'nope').searchDoc).to.equal(undefined)
    })

    it('a loop is an error', () => {
      expect(() => findSearchDoc({ a: { replaces: 'b' }, b: { replaces: 'a' } }, 'a')).to.throw('loop')
    })
  })

  describe('updateDocsBySearchDoc', () => {
    function init (searchDoc, searchDocs) {
      const resource = new UpdateDocsBySearchDoc()
      resource.init({ searchDoc }, {
        bootedServices: { storage: { client: {} } },
        blueprintComponents: {
          searchDocs,
          models: { other_model: { id: 'model' } },
          views: { pub_view: { id: 'publicView' }, priv_view: { id: 'privateView' } }
        }
      })
      return resource
    }

    it('updating a replaced doc uses the replacing doc and its view', () => {
      const resource = init('pub_property', { pub_property: publicDoc, priv_property: privateDoc })
      expect(resource.searchDoc).to.equal(privateDoc)
      expect(resource.model).to.eql({ id: 'privateView' })
    })

    it('updating a doc nobody replaces is unchanged', () => {
      const resource = init('pub_property', { pub_property: publicDoc })
      expect(resource.searchDoc).to.equal(publicDoc)
      expect(resource.model).to.eql({ id: 'publicView' })
    })

    it('an unknown doc still fails', () => {
      expect(() => init('nope', { pub_property: publicDoc })).to.throw('Cannot find search doc: nope')
    })
  })
})
