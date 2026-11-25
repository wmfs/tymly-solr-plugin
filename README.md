# tymly-solr-plugin
[![Tymly Package](https://img.shields.io/badge/tymly-package-blue.svg)](https://tymly.io/)
[![npm (scoped)](https://img.shields.io/npm/v/@wmfs/tymly-solr-plugin.svg)](https://www.npmjs.com/package/@wmfs/tymly-solr-plugin)
[![CircleCI](https://circleci.com/gh/wmfs/tymly-solr-plugin.svg?style=svg)](https://circleci.com/gh/wmfs/tymly-solr-plugin)
[![codecov](https://codecov.io/gh/wmfs/tymly-solr-plugin/branch/master/graph/badge.svg)](https://codecov.io/gh/wmfs/tymly-solr-plugin)
[![CodeFactor](https://www.codefactor.io/repository/github/wmfs/tymly-solr-plugin/badge)](https://www.codefactor.io/repository/github/wmfs/tymly-solr-plugin)
[![Dependabot badge](https://img.shields.io/badge/Dependabot-active-brightgreen.svg)](https://dependabot.com/)
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![license](https://img.shields.io/github/license/mashape/apistatus.svg)](https://github.com/wmfs/tymly-solr-plugin/blob/master/LICENSE)

> This plugin handles interaction with Apache Solr.

On tymly startup, this plugin searches the loaded blueprints for models that have properties which should be indexed by Apache Solr.  It then creates a database view referencing those properties.  This service also provides functions to instruct Apache Solr to index data from a database table/view.

See the test blueprint in /test/fixtures/school-blueprint for an example of how to do this.

## <a name="install"></a>Install
```bash
$ npm install tymly-solr-plugin --save
```

## <a name="test"></a>Testing

Before running the tests, you'll need a test PostgreSQL database available and set a `PG_CONNECTION_STRING` environment variable to point to it, for example:

```PG_CONNECTION_STRING=postgres://postgres:postgres@localhost:5432/my_test_db```

You can also set an optional `SOLR_URL` environment variable to configure what Apache Solr instance to use.  If the environment variable is not set the plugin will default to `http://localhost:8983/solr`.  You can however explicitly configure what instance to use like this:

```SOLR_URL=http://domain.com:8983/solr```

Once the environment variables have been set, you can run the tests like this:

```bash
$ npm test
```


## <a name="relevance"></a>Search relevance

When the user types search text, results are ranked with Solr's eDisMax query parser, best match first. The chosen sort (e.g. date created) only breaks ties. With no search text, results use the chosen sort.

The search text is the query, never a filter: roles, domain, category and the other filters are separate `fq` parameters and don't change the score.

### Starting values

These are in `lib/components/state-resources/search/relevance.js`. They need the search fields from the schema in `solr/schema` (`searchText`, `searchPrefix`, `searchShingle`).

| Parameter | Value | What it does |
| --- | --- | --- |
| `qf` | `title^2 searchText searchPrefix^0.5 searchShingle^0.5` | Fields searched. A word in the title counts twice. Partial and joined-up words count half. |
| `pf` | `title^3 description^2` | Extra score when the words appear together, in order, in the title or description. |
| `mm` | `2<-1 5<75%` | How many words must match: 1 or 2 words, all of them; 3 to 5 words, all but one; more than 5, 75%. One wrong or extra word no longer means no results. |
| `bq` | `docId:"<search text>"^10` | The record whose docId is exactly the search text comes first. Boost patterns add more (see below). |
| `sow` | `true` | Each word is matched on its own before `mm` is applied. |

### Cleaning the search text

- Characters with a meaning in Lucene syntax are escaped. Apostrophes are kept.
- Words made of letters and digits joined by `/` or `-` (e.g. `ABC123/2024`, `Stoke-on-Trent`) are searched as a phrase, so the parts must be together and in order.
- Stopwords are left out, unless they are all the user typed. The plugin's are `and`, `of` and `the`.

### Blueprint settings

A blueprint can add its own stopwords and boost patterns in a `search-relevance` folder. Each JSON file looks like this:

```json
{
  "description": "Company name endings that shouldn't affect matching",
  "stopwords": ["ltd", "limited"],
  "boostPatterns": [
    {
      "description": "A code like AB12, matched against additionalTerms",
      "pattern": "\\b[A-Z]{2}[0-9]{2}\\b",
      "flags": "i",
      "field": "additionalTerms",
      "boost": 30,
      "removeSpaces": true
    }
  ]
}
```

A boost pattern is a regular expression run against the search text. Records whose `field` contains a match (with spaces removed when `removeSpaces` is true) get `boost` added to their score. Invalid entries are skipped with a warning when Tymly boots.

`boost` is a fixed score (Solr's `^=`), not a multiplier. Every record with the value gets the same amount, however many other values its `field` holds. Without this, a record with many values (for example a property matched to several others) gets less from the same match and can drop below records that match the search less well. For scale, each matching word usually scores between 5 and 20, so a boost of 30 is worth more than a word or two.

### Facets and highlights

Search results include:

- `facets`: the number of matches in each `category` and `docType`, across all results, not just the current page. The category counts ignore the category filter, so a user can see how many matches the other categories have.
- `highlights`: the matching words in `title` and `description`, keyed by Solr document `id`.
- `categoryCounts`: the same as `facets.category`, kept for existing callers.

Without Solr, results are ordered by how many of the words are in the title, then by most recently modified. `facets` is `null`, because only the current page could be counted, and `categoryCounts` counts the current page as before.

### Tuning

- Start from the values above. Only raise a boost when a real search shows it's needed: heavy boosting makes it hard to tell why one result outranks another.
- To see why a result scored as it did, run the same query in the Solr admin UI with `debugQuery=true`. The explanation shows which field and boost contributed what.
- Change one parameter at a time, then re-run the whole set of test searches to check nothing else got worse.
- Record any change here, with the searches that justified it.

## <a name="license"></a>License

[MIT](https://github.com/wmfs/tymly/blob/master/LICENSE)


