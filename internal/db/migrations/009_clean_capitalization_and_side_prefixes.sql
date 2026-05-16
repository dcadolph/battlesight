-- 009_clean_capitalization_and_side_prefixes.sql
--
-- Two cleanups for user-facing fields:
--
-- 1. War names that start with a lowercase letter (drift from Wikidata labels,
--    which are sentence-case where Wikipedia is title-case). Promote the
--    first character to uppercase so panels do not show "wars at the end of
--    the Han dynasty" or "war in Donbas".
--
-- 2. Side names that begin with stray template parameter fragments like
--    "borda|20px ", "border|22px ", "flag|" — leftovers from infobox flag
--    templates that the parser did not normalize. Strip the prefix up to
--    and including the first space.

UPDATE battles
SET war = UPPER(substr(war, 1, 1)) || substr(war, 2)
WHERE war != ''
  AND substr(war, 1, 1) >= 'a' AND substr(war, 1, 1) <= 'z';

UPDATE battle_sides
SET name = substr(name, instr(name, ' ') + 1)
WHERE name LIKE 'borda|%' OR name LIKE 'border|%' OR name LIKE 'flag|%';

UPDATE battle_sides
SET name = substr(name, instr(name, ' ') + 1)
WHERE name LIKE 'borda|%' OR name LIKE 'border|%' OR name LIKE 'flag|%';
