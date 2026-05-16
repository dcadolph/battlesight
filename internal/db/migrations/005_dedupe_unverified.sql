-- Delete unverified (Wikidata-imported) battles that duplicate hand-curated
-- entries. Dedup is by wikipedia_title when both have one, otherwise by
-- case-insensitive name match. Cascades to sides via the FK.
--
-- Idempotent: subsequent runs find no matches because the unverified
-- duplicates are already gone.

-- Pass 1: kill unverified rows that share a wikipedia_title with a verified row.
DELETE FROM battle_sides WHERE battle_id IN (
    SELECT u.id FROM battles u
    JOIN battles v ON v.wikipedia_title = u.wikipedia_title
    WHERE u.verified = 0 AND v.verified = 1
      AND u.wikipedia_title != ''
      AND u.id != v.id
);
DELETE FROM battle_references WHERE battle_id IN (
    SELECT u.id FROM battles u
    JOIN battles v ON v.wikipedia_title = u.wikipedia_title
    WHERE u.verified = 0 AND v.verified = 1
      AND u.wikipedia_title != ''
      AND u.id != v.id
);
DELETE FROM battles WHERE id IN (
    SELECT u.id FROM battles u
    JOIN battles v ON v.wikipedia_title = u.wikipedia_title
    WHERE u.verified = 0 AND v.verified = 1
      AND u.wikipedia_title != ''
      AND u.id != v.id
);

-- Pass 2: kill unverified rows whose lowercased name exactly matches a verified row.
DELETE FROM battle_sides WHERE battle_id IN (
    SELECT u.id FROM battles u
    JOIN battles v ON LOWER(v.name) = LOWER(u.name)
    WHERE u.verified = 0 AND v.verified = 1
      AND u.id != v.id
);
DELETE FROM battle_references WHERE battle_id IN (
    SELECT u.id FROM battles u
    JOIN battles v ON LOWER(v.name) = LOWER(u.name)
    WHERE u.verified = 0 AND v.verified = 1
      AND u.id != v.id
);
DELETE FROM battles WHERE id IN (
    SELECT u.id FROM battles u
    JOIN battles v ON LOWER(v.name) = LOWER(u.name)
    WHERE u.verified = 0 AND v.verified = 1
      AND u.id != v.id
);
