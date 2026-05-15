CREATE TABLE IF NOT EXISTS battle_references (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    battle_id TEXT NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
    ref_type  TEXT NOT NULL,
    title     TEXT NOT NULL,
    author    TEXT NOT NULL DEFAULT '',
    year      INTEGER NOT NULL DEFAULT 0,
    url       TEXT NOT NULL DEFAULT '',
    note      TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_battle_references_battle_id ON battle_references(battle_id);
