-- Rich-search FTS index. Indexes a per-battle denormalized blob that pulls
-- in everything a user might reasonably search for: side names (countries,
-- factions), commanders, era, battle type, date string, and the existing
-- name + war + summary + significance fields. Populated by the cleanse
-- step `rebuildRichSearch` on every server start and after every import,
-- so it stays in sync with battles + battle_sides without trigger gymnastics.
--
-- battle_id is UNINDEXED so it round-trips literally; blob is the only
-- searchable column. The unicode61 tokenizer with remove_diacritics=2 lets
-- "mohacs" find "Mohács" and "salahuddin" find "Salah-ad-Din".
CREATE VIRTUAL TABLE IF NOT EXISTS battles_rich_fts USING fts5(
    battle_id UNINDEXED,
    blob,
    tokenize = 'unicode61 remove_diacritics 2'
);
