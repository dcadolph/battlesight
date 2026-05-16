-- Delete the original short-slug curated battle IDs so the JSON seeder
-- re-inserts them under the new slug-YEAR format. Wikidata-imported
-- battles (verified = 0) are untouched.
--
-- Idempotent: rows matching the old IDs only exist on first run after the
-- new format takes effect. Subsequent runs are no-ops.
DELETE FROM battle_sides WHERE battle_id IN (
    'marathon','thermopylae','salamis','gaugamela','cannae','alesia','actium',
    'plataea','mycale','leuctra','chaeronea','issus','trebia','zama','pharsalus',
    'hastings','agincourt','constantinople','spanish-armada','breitenfeld',
    'trafalgar','austerlitz','waterloo','gettysburg','antietam',
    'gallipoli','somme','verdun','battle-of-britain','stalingrad','midway',
    'kursk','normandy','bulge','inchon','dien-bien-phu','73-easting',
    'bunker-hill','trenton','saratoga','cowpens','yorktown',
    'lake-erie','new-orleans','buena-vista',
    'first-bull-run','shiloh','fredericksburg','chancellorsville','vicksburg',
    'alma','balaclava','sevastopol-siege','manila-bay','san-juan-hill',
    'spion-kop','mafeking-siege','first-marne','tannenberg','jutland','cambrai',
    'pearl-harbor','coral-sea','iwo-jima','okinawa',
    'chosin-reservoir','pork-chop-hill',
    'ia-drang','tet-offensive','khe-sanh',
    'hill-3234','grozny-first','mogadishu','tora-bora','second-fallujah'
);
DELETE FROM battle_references WHERE battle_id IN (
    'marathon','thermopylae','salamis','gaugamela','cannae','alesia','actium',
    'plataea','mycale','leuctra','chaeronea','issus','trebia','zama','pharsalus',
    'hastings','agincourt','constantinople','spanish-armada','breitenfeld',
    'trafalgar','austerlitz','waterloo','gettysburg','antietam',
    'gallipoli','somme','verdun','battle-of-britain','stalingrad','midway',
    'kursk','normandy','bulge','inchon','dien-bien-phu','73-easting',
    'bunker-hill','trenton','saratoga','cowpens','yorktown',
    'lake-erie','new-orleans','buena-vista',
    'first-bull-run','shiloh','fredericksburg','chancellorsville','vicksburg',
    'alma','balaclava','sevastopol-siege','manila-bay','san-juan-hill',
    'spion-kop','mafeking-siege','first-marne','tannenberg','jutland','cambrai',
    'pearl-harbor','coral-sea','iwo-jima','okinawa',
    'chosin-reservoir','pork-chop-hill',
    'ia-drang','tet-offensive','khe-sanh',
    'hill-3234','grozny-first','mogadishu','tora-bora','second-fallujah'
);
DELETE FROM battles WHERE verified = 1 AND id IN (
    'marathon','thermopylae','salamis','gaugamela','cannae','alesia','actium',
    'plataea','mycale','leuctra','chaeronea','issus','trebia','zama','pharsalus',
    'hastings','agincourt','constantinople','spanish-armada','breitenfeld',
    'trafalgar','austerlitz','waterloo','gettysburg','antietam',
    'gallipoli','somme','verdun','battle-of-britain','stalingrad','midway',
    'kursk','normandy','bulge','inchon','dien-bien-phu','73-easting',
    'bunker-hill','trenton','saratoga','cowpens','yorktown',
    'lake-erie','new-orleans','buena-vista',
    'first-bull-run','shiloh','fredericksburg','chancellorsville','vicksburg',
    'alma','balaclava','sevastopol-siege','manila-bay','san-juan-hill',
    'spion-kop','mafeking-siege','first-marne','tannenberg','jutland','cambrai',
    'pearl-harbor','coral-sea','iwo-jima','okinawa',
    'chosin-reservoir','pork-chop-hill',
    'ia-drang','tet-offensive','khe-sanh',
    'hill-3234','grozny-first','mogadishu','tora-bora','second-fallujah'
);
