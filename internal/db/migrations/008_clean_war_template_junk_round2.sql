-- 008_clean_war_template_junk_round2.sql
--
-- Migration 007 nulled wiki-template fragments in the war column once, but
-- subsequent infobox runs re-introduced more (the parser sometimes captured
-- a multi-line value that ran into the next infobox field). The Go-side
-- parser is now hardened to reject leading-pipe values, but the database
-- still contains drift from earlier runs. Re-run the same idempotent cleanup
-- so the indexed/documented split reconciles.

UPDATE battles
SET war = ''
WHERE verified = 0
  AND (
    war LIKE '|%'
    OR war LIKE '%{%'
    OR war LIKE '%}%'
    OR war LIKE '%<%'
    OR war LIKE '%>%'
    OR war LIKE '%image%='
    OR LENGTH(war) > 120
  );
