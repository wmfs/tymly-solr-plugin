-- Search analytics report views (sc-34389). Runs on every boot.
-- Old rows are deleted by the searchAnalytics service (tymly_searchLogRetentionDays registry key).

-- Searches that found nothing, per week
CREATE OR REPLACE VIEW tymly.search_report_zero_results AS
SELECT
  date_trunc('week', l._created)::date AS week,
  l.query,
  count(*) AS searches,
  count(DISTINCT l.user_id) AS users
FROM tymly.search_log l
WHERE l.hit_count = 0
  AND l.query <> ''
GROUP BY 1, 2;

-- Searches that found something but no result was opened, per week.
-- Each page of results is its own search, so moving to page 2 leaves page 1 unclicked.
CREATE OR REPLACE VIEW tymly.search_report_no_click AS
SELECT
  date_trunc('week', l._created)::date AS week,
  l.query,
  count(*) AS searches,
  count(DISTINCT l.user_id) AS users,
  round(avg(l.hit_count)) AS avg_hits
FROM tymly.search_log l
WHERE l.hit_count > 0
  AND l.query <> ''
  AND NOT EXISTS (
    SELECT 1 FROM tymly.search_click c WHERE c.search_log_id = l.id::text
  )
GROUP BY 1, 2;

-- Where in the results people click, per week
CREATE OR REPLACE VIEW tymly.search_report_click_position AS
SELECT
  date_trunc('week', c._created)::date AS week,
  count(*) AS clicks,
  round(avg(c.position), 2) AS avg_position,
  round(100.0 * count(*) FILTER (WHERE c.position = 1) / count(*), 1) AS pct_first_result
FROM tymly.search_click c
GROUP BY 1;
