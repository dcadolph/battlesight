-- Battle aliases. Alternative names by which a battle was known to one of
-- the belligerents or to a later tradition. Antietam was Sharpsburg to the
-- Confederate side, Kosovo Polje was the Field of Blackbirds to the Serbian
-- tradition. Indexed by the rich-search FTS so a curator who looks up
-- Sharpsburg lands on Antietam.
--
-- Mirrors the battle_references table pattern: ON DELETE CASCADE so a
-- removed battle takes its aliases with it; a curator-friendly numeric
-- index per battle so the order is stable across imports.
CREATE TABLE IF NOT EXISTS battle_aliases (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    battle_id    TEXT    NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
    alias_index  INTEGER NOT NULL,
    name         TEXT    NOT NULL,
    by_text      TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_battle_aliases_battle_id ON battle_aliases(battle_id);
