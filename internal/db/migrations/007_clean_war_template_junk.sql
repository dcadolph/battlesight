-- 007_clean_war_template_junk.sql
--
-- An earlier enrichment run accidentally stored raw infobox template
-- fragments (e.g. "|image=Battle of Maling.png", "|caption=", "|date=...")
-- in the war column for non-curated battles. Those rows now show up under
-- the indexed tier because the war field looks malformed. Null them so the
-- next infobox pass can repopulate cleanly, and so well-formed battles with
-- empty wars are not penalized.

UPDATE battles
SET war = ''
WHERE verified = 0
  AND (
    war LIKE '|%='
    OR war LIKE '|%=%'
    OR war LIKE '%{%'
    OR war LIKE '%}%'
    OR war LIKE '%<%'
    OR war LIKE '%>%'
    OR war LIKE '%image%='
    OR LENGTH(war) > 120
  );
