# Solr schema for the `tymly` core

The parts of the Solr schema that Tymly relies on are kept here, with a script that applies them to a Solr core, so every environment can be set up the same way.

| File | What it is |
|---|---|
| `schema/base-fields.json` | The fields every search doc fills (title, description, roles, ...). Only added to a core that doesn't have them, e.g. a new core. Never changed on an existing core. |
| `schema/search-fields.json` | The search field types (`text_search`, `text_prefix`, `text_shingle`), the `searchText`, `searchPrefix`, `searchShingle` and `uprns` fields, and the copy fields that fill them. |

What the search fields do:

- **`searchText`** (title, description, additional terms, synopsis, doc id), using `text_search`:
  - **Plurals:** `Midlands` matches `Midland` (English minimal stemming only, so names aren't changed).
  - **Joined-up references and words:** `ABC122024` and `REF00123` match `ABC12/2024` and `REF-00123`.
  - **Apostrophes:** `udays` matches `Uday's`.
  - **Accents:** `cafe` matches `Café`.
  - **Synonyms**, at search time, from blueprints (see below).
  - **Split words as phrases:** a word that gets split up, such as `ABC12/2024` or `Stoke-on-Trent`, is searched as a phrase (`autoGeneratePhraseQueries`), so it matches those words next to each other rather than any of them.
- **`searchPrefix`** (title, description): partial words of 3 to 10 letters. `birm` matches `Birmingham`, and `ABC` matches `ABC12/2024`.
- **`searchShingle`** (title, description): neighbouring words joined, so `castlewood` matches `Castle Wood`.

`searchPrefix` and `searchShingle` make the index bigger, so partial words are limited to 3 to 10 letters. In one test with the same 6.2 million documents, partial words of 2 to 20 letters from title and description made the index 2.7 times its size without them, against 1.7 times for 3 to 10 letters from titles only.
- **`uprns`**: a record's UPRN plus related UPRNs, for filtering. Filled by search docs, not copy fields.

Searching only uses these fields once the search state resource queries them. Applying the schema on its own changes no search results.

## Applying to a Solr core

`--url` is the Solr base URL, ending in `/solr`. Run from the plugin folder.

```bash
# 1. See what would change (changes nothing)
node solr/apply-schema.js --url http://<solr host>:8983/solr

# 2. Apply. Safe to re-run: only what's missing or different is changed.
node solr/apply-schema.js --url http://<solr host>:8983/solr --apply

# 3. Check the field types behave as intended (read-only, needs no data)
node solr/check-analysis.js --url http://<solr host>:8983/solr
```

Option: `--core <name>` (default `tymly`).

Then:

4. **Run a full reindex** (`clean=true`), e.g. the Solr full reindex state machine. Copy fields only fill the new fields when documents are re-added.
5. **Note the index size and how long the full import took**, from the Solr admin UI (Core Admin, then Dataimport). Partial words and joined words make the index bigger, so compare with before.

On a live system, do steps 2 to 4 at a quiet time. Search keeps working throughout, and the new fields are empty until the reindex finishes.


**Undoing it:** the change only adds things, so it can simply be left in place. To remove it, delete the copy fields, then the fields, then the field types through the Schema API (`delete-copy-field`, `delete-field`, `delete-field-type`).

## Search synonyms

Synonyms come from blueprints, so each one lives with the process it belongs to. A blueprint can have a `search-synonyms` directory of JSON files, each holding groups of words or phrases that mean the same thing when searching:

```json
{
  "description": "Address abbreviations",
  "synonyms": [
    ["rd", "road"],
    ["st", "street"]
  ]
}
```

On boot, the `searchSynonyms` service puts the synonyms of every loaded blueprint into Solr's managed synonym list (`tymly_search`), removes any that no loaded blueprint has, and reloads the core if anything changed. No reindex is needed, as synonyms are only used when searching `searchText`. It runs in the background and never stops Tymly booting: if Solr can't be reached, or the schema hasn't been applied yet, it logs a warning. After applying the schema to a new core, restart Tymly to fill the list.

The current list is at `<solr url>/tymly/schema/analysis/synonyms/tymly_search`.

## Local Solr for development

Any Solr 7.x core with these fields works for trying schema and search changes. To index documents into a local core without setting up the DataImportHandler, export `tymly.solr_data` from your database as JSON lines and load it:

```bash
psql "$PG_CONNECTION_STRING" -At -c 'select row_to_json(s) from tymly.solr_data s' > /tmp/solr_data.jsonl
node solr/index-jsonl.js --url http://localhost:8983/solr --file /tmp/solr_data.jsonl --clean
rm /tmp/solr_data.jsonl
```

Point Tymly at it with `SOLR_HOST`, `SOLR_PORT` and `SOLR_PATH` (e.g. `localhost`, `8983`, `/solr`). The full and delta reindex state machines need the DataImportHandler set up on the core.
