/* eslint-env mocha */

'use strict'

const expect = require('chai').expect
const {
  MANAGED_RESOURCE,
  collectSynonymGroups,
  synonymMap,
  planSynonymChanges,
  syncSynonyms
} = require('../lib/components/services/search-synonyms/synonyms')

// Stands in for lib/util/solr-admin.js, recording what would be sent to Solr
function fakeSolr (managedMap) {
  const calls = []
  return {
    calls,
    getSynonyms: async resource => { calls.push(['get', resource]); return managedMap },
    putSynonyms: async (resource, map) => { calls.push(['put', resource, map]) },
    deleteSynonym: async (resource, term) => { calls.push(['delete', resource, term]) },
    reloadCore: async () => { calls.push(['reload']) }
  }
}

describe('search synonyms from blueprints', () => {
  describe('collectSynonymGroups', () => {
    it('gathers the groups from every blueprint, lower-cased and trimmed', () => {
      const { groups, problems } = collectSynonymGroups({
        gazetteer_addressAbbreviations: { synonyms: [['St', 'Street'], ['rd', ' road ']] },
        safeAndWell_safeAndWell: { synonyms: [['saw', 'Safe and Well']] }
      })
      expect(groups).to.eql([['st', 'street'], ['rd', 'road'], ['saw', 'safe and well']])
      expect(problems).to.eql([])
    })

    it('reports and skips anything that is not a list of groups of two or more terms', () => {
      const { groups, problems } = collectSynonymGroups({
        a_noList: { description: 'no synonyms' },
        b_mixed: { synonyms: [['ok', 'fine'], ['lonely'], 'word', ['x', 5], ['same', 'SAME']] }
      })
      expect(groups).to.eql([['ok', 'fine']])
      expect(problems).to.have.length(5)
      expect(problems[0]).to.include('a_noList')
    })

    it('no blueprints with synonyms: no groups', () => {
      expect(collectSynonymGroups(undefined)).to.eql({ groups: [], problems: [] })
    })
  })

  describe('synonymMap', () => {
    it('maps every term to the others in its group, merging groups that share a term', () => {
      expect(synonymMap([['st', 'street'], ['st', 'saint'], ['tlc', 'tender loving care']])).to.eql({
        st: ['saint', 'street'],
        street: ['st'],
        saint: ['st'],
        tlc: ['tender loving care'],
        'tender loving care': ['tlc']
      })
    })
  })

  describe('planSynonymChanges', () => {
    const groups = [['rd', 'road'], ['saw', 'safe and well']]

    it('an empty list: sets every term', () => {
      const plan = planSynonymChanges({}, groups)
      expect(plan.put).to.eql(synonymMap(groups))
      expect(plan.remove).to.eql([])
      expect(plan.changed).to.equal(true)
    })

    it('already matching: nothing to do', () => {
      expect(planSynonymChanges(synonymMap(groups), groups).changed).to.equal(false)
    })

    it('a changed term is set again, and a term no blueprint has any more is removed', () => {
      const current = { ...synonymMap(groups), rd: ['rode'], fsc: ['fire safety concern'] }
      const plan = planSynonymChanges(current, groups)
      expect(plan.put).to.eql({ rd: ['road'] })
      expect(plan.remove).to.eql(['fsc'])
    })
  })

  describe('syncSynonyms', () => {
    const groups = [['rd', 'road']]

    it('updates the managed list and reloads the core', async () => {
      const solr = fakeSolr({ old: ['gone'] })
      const result = await syncSynonyms(solr, groups)
      expect(result).to.eql({ status: 'updated', set: ['rd', 'road'], removed: ['old'] })
      expect(solr.calls).to.eql([
        ['get', MANAGED_RESOURCE],
        ['put', MANAGED_RESOURCE, { rd: ['road'], road: ['rd'] }],
        ['delete', MANAGED_RESOURCE, 'old'],
        ['reload']
      ])
    })

    it('does not reload when nothing changed', async () => {
      const solr = fakeSolr(synonymMap(groups))
      expect((await syncSynonyms(solr, groups)).status).to.equal('upToDate')
      expect(solr.calls).to.eql([['get', MANAGED_RESOURCE]])
    })

    it('does nothing when Solr has no managed list yet (schema not applied)', async () => {
      const solr = fakeSolr(null)
      expect((await syncSynonyms(solr, groups)).status).to.equal('noManagedList')
      expect(solr.calls).to.eql([['get', MANAGED_RESOURCE]])
    })
  })
})
