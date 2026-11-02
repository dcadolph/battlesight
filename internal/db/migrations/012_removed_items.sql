-- Removed items. A Wikidata item a cleanse pass deleted on purpose, as a
-- non-battle or as the merged side of a duplicate, so no import or refresh
-- adds it back. kept_id names the row a merged item folded into, and is
-- empty for a non-battle.
CREATE TABLE IF NOT EXISTS removed_items (
    qid      TEXT PRIMARY KEY,
    reason   TEXT NOT NULL,
    kept_id  TEXT NOT NULL DEFAULT ''
);
