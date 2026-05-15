CREATE TABLE IF NOT EXISTS battles (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    year         INTEGER NOT NULL,
    date         TEXT NOT NULL,
    lat          REAL NOT NULL,
    lng          REAL NOT NULL,
    era          TEXT NOT NULL,
    war          TEXT NOT NULL,
    battle_type  TEXT NOT NULL,
    victor       TEXT NOT NULL,
    summary      TEXT NOT NULL,
    significance TEXT NOT NULL,
    source       TEXT NOT NULL DEFAULT 'curated',
    source_id    TEXT NOT NULL DEFAULT '',
    verified     INTEGER NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS battle_sides (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    battle_id  TEXT NOT NULL REFERENCES battles(id) ON DELETE CASCADE,
    side_index INTEGER NOT NULL,
    name       TEXT NOT NULL,
    commander  TEXT NOT NULL,
    strength   TEXT NOT NULL,
    casualties TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_battles_year ON battles(year);
CREATE INDEX IF NOT EXISTS idx_battles_era ON battles(era);
CREATE INDEX IF NOT EXISTS idx_battles_war ON battles(war);
CREATE INDEX IF NOT EXISTS idx_battles_source ON battles(source);
CREATE INDEX IF NOT EXISTS idx_battle_sides_battle_id ON battle_sides(battle_id);

CREATE VIRTUAL TABLE IF NOT EXISTS battles_fts USING fts5(
    name, war, summary, significance,
    content='battles', content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS battles_ai AFTER INSERT ON battles BEGIN
    INSERT INTO battles_fts(rowid, name, war, summary, significance)
    VALUES (new.rowid, new.name, new.war, new.summary, new.significance);
END;

CREATE TRIGGER IF NOT EXISTS battles_ad AFTER DELETE ON battles BEGIN
    INSERT INTO battles_fts(battles_fts, rowid, name, war, summary, significance)
    VALUES ('delete', old.rowid, old.name, old.war, old.summary, old.significance);
END;

CREATE TRIGGER IF NOT EXISTS battles_au AFTER UPDATE ON battles BEGIN
    INSERT INTO battles_fts(battles_fts, rowid, name, war, summary, significance)
    VALUES ('delete', old.rowid, old.name, old.war, old.summary, old.significance);
    INSERT INTO battles_fts(rowid, name, war, summary, significance)
    VALUES (new.rowid, new.name, new.war, new.summary, new.significance);
END;
