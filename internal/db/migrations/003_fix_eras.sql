-- Clear the bogus "ancient" era applied to records whose year never parsed.
-- yearToEra(0) mapped to "ancient" historically, which polluted the ancient
-- filter with Civil War, Revolutionary War, etc. battles.
UPDATE battles SET era = '' WHERE year = 0 AND era = 'ancient';

-- Backfill era from war name where the war is unambiguous. Each statement
-- only touches rows still missing an era, so it is safe to re-run.
UPDATE battles SET era = 'napoleonic'  WHERE era = '' AND year = 0 AND war LIKE '%American Revolutionary%';
UPDATE battles SET era = 'industrial'  WHERE era = '' AND year = 0 AND war LIKE '%American Civil%';
UPDATE battles SET era = 'industrial'  WHERE era = '' AND year = 0 AND war LIKE '%Mexican-American%';
UPDATE battles SET era = 'industrial'  WHERE era = '' AND year = 0 AND war LIKE '%War of 1812%';
UPDATE battles SET era = 'industrial'  WHERE era = '' AND year = 0 AND war LIKE '%Crimean%';
UPDATE battles SET era = 'industrial'  WHERE era = '' AND year = 0 AND war LIKE '%Franco-Prussian%';
UPDATE battles SET era = 'industrial'  WHERE era = '' AND year = 0 AND war LIKE '%Russo-Japanese%';
UPDATE battles SET era = 'industrial'  WHERE era = '' AND year = 0 AND war LIKE '%Spanish-American%';
UPDATE battles SET era = 'industrial'  WHERE era = '' AND year = 0 AND war LIKE '%Boer%';
UPDATE battles SET era = 'world-war-1' WHERE era = '' AND year = 0 AND war LIKE '%World War I%'  AND war NOT LIKE '%World War II%';
UPDATE battles SET era = 'world-war-1' WHERE era = '' AND year = 0 AND war LIKE '%First World War%';
UPDATE battles SET era = 'world-war-2' WHERE era = '' AND year = 0 AND war LIKE '%World War II%';
UPDATE battles SET era = 'world-war-2' WHERE era = '' AND year = 0 AND war LIKE '%Second World War%';
UPDATE battles SET era = 'modern'      WHERE era = '' AND year = 0 AND war LIKE '%Korean War%';
UPDATE battles SET era = 'modern'      WHERE era = '' AND year = 0 AND war LIKE '%Vietnam War%';
UPDATE battles SET era = 'modern'      WHERE era = '' AND year = 0 AND war LIKE '%Gulf War%';
UPDATE battles SET era = 'modern'      WHERE era = '' AND year = 0 AND war LIKE '%Iraq War%';
UPDATE battles SET era = 'modern'      WHERE era = '' AND year = 0 AND war LIKE '%Afghan%';
UPDATE battles SET era = 'modern'      WHERE era = '' AND year = 0 AND war LIKE '%Cold War%';
UPDATE battles SET era = 'modern'      WHERE era = '' AND year = 0 AND war LIKE '%Falklands%';
UPDATE battles SET era = 'modern'      WHERE era = '' AND year = 0 AND war LIKE '%Yom Kippur%';
UPDATE battles SET era = 'modern'      WHERE era = '' AND year = 0 AND war LIKE '%Six-Day%';
UPDATE battles SET era = 'modern'      WHERE era = '' AND year = 0 AND war LIKE '%Arab-Israeli%';
UPDATE battles SET era = 'medieval'    WHERE era = '' AND year = 0 AND war LIKE '%Hundred Years%';
UPDATE battles SET era = 'medieval'    WHERE era = '' AND year = 0 AND war LIKE '%Crusade%';
UPDATE battles SET era = 'medieval'    WHERE era = '' AND year = 0 AND war LIKE '%Mongol%';
UPDATE battles SET era = 'medieval'    WHERE era = '' AND year = 0 AND war LIKE '%Norman%';
UPDATE battles SET era = 'medieval'    WHERE era = '' AND year = 0 AND war LIKE '%Reconquista%';
UPDATE battles SET era = 'medieval'    WHERE era = '' AND year = 0 AND war LIKE '%Byzantine%';
UPDATE battles SET era = 'medieval'    WHERE era = '' AND year = 0 AND war LIKE '%Anglo-Saxon%';
UPDATE battles SET era = 'medieval'    WHERE era = '' AND year = 0 AND war LIKE '%Wars of the Roses%';
UPDATE battles SET era = 'early-modern' WHERE era = '' AND year = 0 AND war LIKE '%Thirty Years%';
UPDATE battles SET era = 'early-modern' WHERE era = '' AND year = 0 AND war LIKE '%Eighty Years%';
UPDATE battles SET era = 'early-modern' WHERE era = '' AND year = 0 AND war LIKE '%English Civil%';
UPDATE battles SET era = 'early-modern' WHERE era = '' AND year = 0 AND war LIKE '%Anglo-Spanish%';
UPDATE battles SET era = 'early-modern' WHERE era = '' AND year = 0 AND war LIKE '%Ottoman Wars in Europe%';
UPDATE battles SET era = 'napoleonic'   WHERE era = '' AND year = 0 AND war LIKE '%Napoleonic%';
UPDATE battles SET era = 'napoleonic'   WHERE era = '' AND year = 0 AND war LIKE '%French Revolutionary%';
UPDATE battles SET era = 'napoleonic'   WHERE era = '' AND year = 0 AND war LIKE '%Seven Years%';
UPDATE battles SET era = 'ancient'      WHERE era = '' AND year = 0 AND war LIKE '%Punic%';
UPDATE battles SET era = 'ancient'      WHERE era = '' AND year = 0 AND war LIKE '%Greco-Persian%';
UPDATE battles SET era = 'ancient'      WHERE era = '' AND year = 0 AND war LIKE '%Wars of Alexander%';
UPDATE battles SET era = 'ancient'      WHERE era = '' AND year = 0 AND war LIKE '%Gallic Wars%';
UPDATE battles SET era = 'ancient'      WHERE era = '' AND year = 0 AND war LIKE '%Roman Republic%';
UPDATE battles SET era = 'ancient'      WHERE era = '' AND year = 0 AND war LIKE '%Peloponnesian%';
