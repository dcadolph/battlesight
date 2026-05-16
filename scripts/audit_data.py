"""Comprehensive audit of curated battle data, replays, and references.

Checks invariants that should hold for every curated entry. Prints findings
grouped by severity. Exits non-zero if any ERROR-level issues are found.
"""
import json
import re
import sys
from collections import Counter, defaultdict

BATTLES_PATH = 'data/battles.json'
PHASES_PATH = 'data/phases.json'
REFS_PATH = 'data/references.json'

# Year → era mapping. Source of truth: importer.yearToEra in wikidata.go.
def year_to_era(y: int) -> str:
    if y == 0:
        return ''
    if y < 500:
        return 'ancient'
    if y < 1500:
        return 'medieval'
    if y < 1700:
        return 'early-modern'
    if y < 1820:
        return 'napoleonic'
    if y < 1914:
        return 'industrial'
    if y < 1919:
        return 'world-war-1'
    if y < 1939:
        return 'interwar'
    if y < 1946:
        return 'world-war-2'
    return 'modern'

# Slug-YEAR id format: <slug>-<YYYY> or <slug>-<YYY>bc
ID_PATTERN = re.compile(r'^[a-z0-9]+(?:-[a-z0-9]+)*-(?:\d{1,4}bc|\d{4})$')

# Parse a year from the date string. Returns 0 if none found.
YEAR_RE = re.compile(r'\b(\d{3,4})\b')
BC_RE = re.compile(r'(\d+)\s*BC')

def year_from_date(date: str) -> int:
    if not date:
        return 0
    m = BC_RE.search(date)
    if m:
        return -int(m.group(1))
    m = YEAR_RE.search(date)
    if m:
        return int(m.group(1))
    return 0


def main():
    findings = {'error': [], 'warn': [], 'info': []}

    battles = json.load(open(BATTLES_PATH))
    phases = json.load(open(PHASES_PATH))
    try:
        refs = json.load(open(REFS_PATH))
    except FileNotFoundError:
        refs = {}

    by_id = {b['id']: b for b in battles}
    seen_ids = Counter(b['id'] for b in battles)

    # --- ID uniqueness ---
    for bid, count in seen_ids.items():
        if count > 1:
            findings['error'].append(f'duplicate battle id: {bid} ({count}x)')

    # --- Battle-level checks ---
    for b in battles:
        bid = b['id']
        name = b.get('name', '')
        year = b.get('year', 0)
        date = b.get('date', '')
        era = b.get('era', '')
        lat = b.get('lat', 0)
        lng = b.get('lng', 0)

        # ID format
        if not ID_PATTERN.match(bid):
            findings['warn'].append(f'{bid}: ID does not match slug-YEAR pattern')

        # Required fields
        for field in ['name', 'year', 'date', 'era', 'war', 'battleType']:
            if not b.get(field) and field not in ('war',):  # war can be empty for one-offs
                findings['error'].append(f'{bid}: missing {field}')

        # Year and date must agree
        date_year = year_from_date(date)
        if date_year != 0 and abs(date_year - abs(year)) > 1 and not (year < 0 and date_year != -year):
            # Special handling: BC year vs date "490 BC" → date_year = -490
            if not (year < 0 and abs(date_year) == abs(year)):
                findings['error'].append(
                    f'{bid}: year={year} but date "{date}" implies {date_year}')

        # Era must match year
        expected_era = year_to_era(year)
        if era and expected_era and era != expected_era:
            findings['error'].append(
                f'{bid}: era="{era}" but year={year} maps to "{expected_era}"')

        # Coordinates plausibility
        if lat < -90 or lat > 90:
            findings['error'].append(f'{bid}: lat={lat} out of range')
        if lng < -180 or lng > 180:
            findings['error'].append(f'{bid}: lng={lng} out of range')
        if lat == 0 and lng == 0:
            findings['warn'].append(f'{bid}: coords (0,0) — invisible on globe')

        # battleType valid
        bt = b.get('battleType', '')
        if bt not in ('land', 'naval', 'siege', 'aerial', ''):
            findings['warn'].append(f'{bid}: battleType="{bt}" not in standard set')

        # Sides sanity
        sides = b.get('sides', [])
        if len(sides) > 3:
            findings['info'].append(f'{bid}: {len(sides)} sides (typical is 2)')
        if len(sides) == 0:
            findings['warn'].append(f'{bid}: no sides')

        # Victor should match a side name (when set)
        victor = b.get('victor', '')
        if victor and sides:
            side_names = [s.get('name', '') for s in sides]
            victor_terms = [
                'inconclusive', 'indecisive', 'both', 'tactical',
                'strategic', 'allied', 'allies', 'mixed',
            ]
            if not any(victor in n or n in victor for n in side_names):
                if not any(t in victor.lower() for t in victor_terms):
                    findings['warn'].append(
                        f'{bid}: victor="{victor}" does not match any side ({side_names})')

        # Each side must have name
        for i, s in enumerate(sides):
            if not s.get('name'):
                findings['error'].append(f'{bid}: side {i} missing name')

    # --- Phase replays ---
    for phase_id, replay in phases.items():
        if phase_id not in by_id:
            findings['error'].append(f'phase replay {phase_id}: no battle with this id')
        else:
            # Faction labels should not be empty
            if not replay.get('factionA') or not replay.get('factionB'):
                findings['warn'].append(f'phase replay {phase_id}: missing factionA/B label')
            # Phase count sanity
            n = len(replay.get('phases', []))
            if n < 3:
                findings['warn'].append(f'phase replay {phase_id}: only {n} phases')

        # Phase content
        for i, p in enumerate(replay.get('phases', [])):
            if not p.get('title'):
                findings['error'].append(f'phase {phase_id}#{i}: missing title')
            if not p.get('narration'):
                findings['error'].append(f'phase {phase_id}#{i}: missing narration')
            # Units sane
            for j, u in enumerate(p.get('units', [])):
                x, y = u.get('x', 0), u.get('y', 0)
                if not (0 <= x <= 100) or not (0 <= y <= 100):
                    findings['error'].append(
                        f'phase {phase_id}#{i} unit {j}: ({x},{y}) out of 0-100 range')
                fac = u.get('faction', '')
                if fac not in ('a', 'b', 'c'):
                    findings['error'].append(
                        f'phase {phase_id}#{i} unit {j}: faction="{fac}" not a/b/c')
            for j, m in enumerate(p.get('movements', [])):
                for k in ('fromX', 'fromY', 'toX', 'toY'):
                    v = m.get(k, 0)
                    if not (0 <= v <= 100):
                        findings['error'].append(
                            f'phase {phase_id}#{i} movement {j}: {k}={v} out of range')

    # --- References ---
    for ref_id in refs:
        if ref_id not in by_id:
            findings['warn'].append(f'reference for {ref_id}: no battle with this id')

    # --- Cross-checks ---
    # Same name twice (might indicate duplicate)
    name_counts = Counter(b['name'] for b in battles)
    for name, count in name_counts.items():
        if count > 1:
            ids = [b['id'] for b in battles if b['name'] == name]
            findings['warn'].append(f'duplicate name "{name}": {ids}')

    # Same wikipediaTitle twice (genuine dupe)
    wiki_counts = Counter(b['wikipediaTitle'] for b in battles if b.get('wikipediaTitle'))
    for wt, count in wiki_counts.items():
        if count > 1:
            ids = [b['id'] for b in battles if b.get('wikipediaTitle') == wt]
            findings['error'].append(f'duplicate wikipediaTitle "{wt}": {ids}')

    # Print findings
    for severity in ('error', 'warn', 'info'):
        items = findings[severity]
        if not items:
            continue
        print(f'\n=== {severity.upper()} ({len(items)}) ===')
        for f in items:
            print(f'  {f}')

    err_count = len(findings['error'])
    print(f'\nsummary: {err_count} errors, {len(findings["warn"])} warnings, {len(findings["info"])} info')
    sys.exit(1 if err_count else 0)


if __name__ == '__main__':
    main()
