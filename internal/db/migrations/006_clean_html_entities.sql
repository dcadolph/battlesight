-- Decode HTML entities that leaked into imported date/name/war/place text.
-- The infobox parser used to pass &ndash; etc. through untouched; this
-- replaces them with the corresponding Unicode characters so the UI no
-- longer shows raw entities like "&ndash;".
--
-- Idempotent: subsequent runs are no-ops because the entities are already gone.
UPDATE battles SET date = REPLACE(date, '&ndash;', '–')   WHERE date LIKE '%&ndash;%';
UPDATE battles SET date = REPLACE(date, '&mdash;', '—')   WHERE date LIKE '%&mdash;%';
UPDATE battles SET date = REPLACE(date, '&nbsp;', ' ')    WHERE date LIKE '%&nbsp;%';
UPDATE battles SET date = REPLACE(date, '&amp;',  '&')    WHERE date LIKE '%&amp;%';
UPDATE battles SET date = REPLACE(date, '&quot;', '"')    WHERE date LIKE '%&quot;%';
UPDATE battles SET date = REPLACE(date, '&#39;',  '''')   WHERE date LIKE '%&#39;%';

UPDATE battles SET war = REPLACE(war, '&ndash;', '–')     WHERE war LIKE '%&ndash;%';
UPDATE battles SET war = REPLACE(war, '&mdash;', '—')     WHERE war LIKE '%&mdash;%';
UPDATE battles SET war = REPLACE(war, '&nbsp;', ' ')      WHERE war LIKE '%&nbsp;%';
UPDATE battles SET war = REPLACE(war, '&amp;',  '&')      WHERE war LIKE '%&amp;%';

UPDATE battles SET name = REPLACE(name, '&ndash;', '–')   WHERE name LIKE '%&ndash;%';
UPDATE battles SET name = REPLACE(name, '&mdash;', '—')   WHERE name LIKE '%&mdash;%';
UPDATE battles SET name = REPLACE(name, '&nbsp;', ' ')    WHERE name LIKE '%&nbsp;%';
UPDATE battles SET name = REPLACE(name, '&amp;',  '&')    WHERE name LIKE '%&amp;%';

UPDATE battle_sides SET name = REPLACE(name, '&ndash;', '–')             WHERE name LIKE '%&ndash;%';
UPDATE battle_sides SET name = REPLACE(name, '&amp;',  '&')              WHERE name LIKE '%&amp;%';
UPDATE battle_sides SET commander = REPLACE(commander, '&ndash;', '–')   WHERE commander LIKE '%&ndash;%';
UPDATE battle_sides SET commander = REPLACE(commander, '&amp;',  '&')    WHERE commander LIKE '%&amp;%';

-- Garbage date placeholders left by the infobox parser: replace with empty so
-- the UI doesn't show "&ndash;" or "&ndash; , ()" as the date.
UPDATE battles SET date = '' WHERE date IN ('&ndash;', '–', '—', '- , ()', '&ndash; , ()', '– , ()', '— , ()');
UPDATE battles SET date = TRIM(date);
