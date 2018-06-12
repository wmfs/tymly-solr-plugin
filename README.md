# tymly-solr-plugin
[![Tymly Package](https://img.shields.io/badge/tymly-package-blue.svg)](https://tymly.io/)
[![npm (scoped)](https://img.shields.io/npm/v/@wmfs/tymly-solr-plugin.svg)](https://www.npmjs.com/package/@wmfs/tymly-solr-plugin)
[![Build Status](https://travis-ci.org/wmfs/tymly-solr-plugin.svg?branch=master)](https://travis-ci.org/wmfs/tymly-solr-plugin)
[![codecov](https://codecov.io/gh/wmfs/tymly-solr-plugin/branch/master/graph/badge.svg)](https://codecov.io/gh/wmfs/tymly-solr-plugin)
[![CodeFactor](https://www.codefactor.io/repository/github/wmfs/tymly-solr-plugin/badge)](https://www.codefactor.io/repository/github/wmfs/tymly-solr-plugin)
[![Dependabot badge](https://img.shields.io/badge/Dependabot-active-brightgreen.svg)](https://dependabot.com/)
[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)
[![JavaScript Style Guide](https://img.shields.io/badge/code_style-standard-brightgreen.svg)](https://standardjs.com)
[![license](https://img.shields.io/github/license/mashape/apistatus.svg)](https://github.com/wmfs/tymly/blob/master/packages/pg-concat/LICENSE)

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


## <a name="license"></a>License

[MIT](https://github.com/wmfs/tymly/blob/master/LICENSE)
