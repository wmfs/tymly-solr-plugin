-- Search analytics report views (sc-34389). Runs on every boot.
-- Old rows are deleted by the searchAnalytics service (tymly_searchLogRetentionDays registry key).
-- Each report is per week and per domain: 'search' is the global search page, other domains are
-- searches made from cards (e.g. Action.ApiLookup state machines using module:search).
-- Dropped and recreated so columns can change (CREATE OR REPLACE VIEW can't remove or reorder them).

DROP VIEW IF EXISTS tymly.search_report_zero_results;
DROP VIEW IF EXISTS tymly.search_report_no_click;
DROP VIEW IF EXISTS tymly.search_report_click_position;

-- Searches with text that found nothing
CREATE VIEW tymly.search_report_zero_results AS
SELECT
  date_trunc('week', l._created)::date AS week,
  l.domain,
  l.query,
  count(*) AS searches,
  count(DISTINCT l.user_id) AS users
FROM tymly.search_log l
WHERE l.hit_count = 0
  AND l.query <> ''
GROUP BY 1, 2, 3;

-- Searches with text that found something but no result was opened.
-- Only domains that record clicks are included (any domain with a row in search_click), as
-- searches from a domain that never records clicks would all look unopened.
-- Each page of results is its own search, so moving to page 2 leaves page 1 unclicked.
CREATE VIEW tymly.search_report_no_click AS
WITH clicked_domains AS (
  SELECT DISTINCT s.domain
  FROM tymly.search_click c
  JOIN tymly.search_log s ON s.id = c.search_log_id::uuid
)
SELECT
  date_trunc('week', l._created)::date AS week,
  l.domain,
  l.query,
  count(*) AS searches,
  count(DISTINCT l.user_id) AS users,
  round(avg(l.hit_count)) AS avg_hits
FROM tymly.search_log l
JOIN clicked_domains d ON d.domain IS NOT DISTINCT FROM l.domain
WHERE l.hit_count > 0
  AND l.query <> ''
  AND NOT EXISTS (
    SELECT 1 FROM tymly.search_click c WHERE c.search_log_id = l.id::text
  )
GROUP BY 1, 2, 3;

-- Where in the results people click
CREATE VIEW tymly.search_report_click_position AS
SELECT
  date_trunc('week', c._created)::date AS week,
  l.domain,
  count(*) AS clicks,
  round(avg(c.position), 2) AS avg_position,
  round(100.0 * count(*) FILTER (WHERE c.position = 1) / count(*), 1) AS pct_first_result
FROM tymly.search_click c
JOIN tymly.search_log l ON l.id = c.search_log_id::uuid
GROUP BY 1, 2;
