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
    it('maps every term to its whole group, itself included, merging groups that share a term', () => {
      expect(synonymMap([['st', 'street'], ['st', 'saint'], ['tlc', 'tender loving care']])).to.eql({
        st: ['saint', 'st', 'street'],
        street: ['st', 'street'],
        saint: ['saint', 'st'],
        tlc: ['tender loving care', 'tlc'],
        'tender loving care': ['tender loving care', 'tlc']
      })
    })

    it('every term still searches for itself, so a synonym only ever adds matches', () => {
      const map = synonymMap([['st', 'street'], ['rd', 'road']])
      for (const [term, synonyms] of Object.entries(map)) expect(synonyms).to.include(term)
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

    it('a term no blueprint has any more is removed', () => {
      const current = { ...synonymMap(groups), fsc: ['fire safety concern'] }
      const plan = planSynonymChanges(current, groups)
      expect(plan.put).to.eql({})
      expect(plan.remove).to.eql(['fsc'])
    })

    it('a term that gained a synonym is set again', () => {
      const current = { ...synonymMap(groups), rd: ['rd'] }
      const plan = planSynonymChanges(current, groups)
      expect(plan.put).to.eql({ rd: ['rd', 'road'] })
      expect(plan.remove).to.eql([])
    })

    it('a term that lost a synonym is removed and set again, because Solr only adds to a list', () => {
      const current = { ...synonymMap(groups), rd: ['rd', 'road', 'rode'] }
      const plan = planSynonymChanges(current, groups)
      expect(plan.put).to.eql({ rd: ['rd', 'road'] })
      expect(plan.remove).to.eql(['rd'])
    })

    it('replaces the old map that left out the term itself', () => {
      const old = { rd: ['road'], road: ['rd'] }
      const plan = planSynonymChanges(old, groups)
      expect(plan.put).to.have.keys('rd', 'road', 'saw', 'safe and well')
      expect(plan.put.road).to.eql(['rd', 'road'])
      expect(plan.remove).to.eql([])
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
        ['delete', MANAGED_RESOURCE, 'old'],
        ['put', MANAGED_RESOURCE, { rd: ['rd', 'road'], road: ['rd', 'road'] }],
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
