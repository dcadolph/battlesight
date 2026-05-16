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

    # War-name canonicalization: catch near-duplicate war names that differ only
    # in dash style (en/em/hyphen) or in a leading "The " article. These tend to
    # drift when adding new entries by hand and split the war's battle list.
    def canon_war(w: str) -> str:
        s = w.lower().strip()
        # Normalize all dash variants to a single hyphen for comparison.
        for d in ('–', '—', '−'):  # en-dash, em-dash, minus
            s = s.replace(d, '-')
        if s.startswith('the '):
            s = s[4:]
        return s

    war_groups = defaultdict(set)
    for b in battles:
        w = b.get('war', '')
        if w:
            war_groups[canon_war(w)].add(w)
    for key, variants in war_groups.items():
        if len(variants) > 1:
            findings['warn'].append(
                f'war "{key}" has multiple spellings: {sorted(variants)}')

    # Casualty sanity: when both strength and casualties are present as numbers,
    # casualties should not exceed strength by more than a tolerance. Catches
    # transcription errors and unit-of-measure mistakes. Skip when strength is
    # expressed in non-personnel units (ships, tanks, aircraft) or when the
    # numbers are not strictly comparable (M-suffixed totals, "and total" etc.).
    # Number-with-optional-magnitude-suffix. The suffix must be the next token
    # — not just any uppercase letter — so "31,000 killed (mostly disease)"
    # does NOT see "M" of "Mostly" as a million suffix.
    num_re = re.compile(r'([\d,]+)\s*(M\b|million\b|k\b|thousand\b)?', re.IGNORECASE)
    suffix_scale = {'m': 1_000_000, 'million': 1_000_000, 'k': 1_000, 'thousand': 1_000}
    non_personnel = ('ship', 'tank', 'aircraft', 'plane', 'vessel', 'cannon',
                     'gun', 'piece of artillery', 'artillery piece')

    def all_ints(s: str) -> list:
        out = []
        for m in num_re.finditer(s or ''):
            digits = m.group(1).replace(',', '')
            if not digits:
                continue
            try:
                n = int(digits)
            except ValueError:
                continue
            suffix = (m.group(2) or '').lower()
            if suffix in suffix_scale:
                n *= suffix_scale[suffix]
            out.append(n)
        return out

    for b in battles:
        bid = b['id']
        for i, side in enumerate(b.get('sides', [])):
            strength_str = side.get('strength', '')
            casualties_str = side.get('casualties', '')
            # Skip if strength is in non-personnel units.
            if any(term in strength_str.lower() for term in non_personnel):
                continue
            strengths = all_ints(strength_str)
            casualties = all_ints(casualties_str)
            if not strengths or not casualties:
                continue
            # When casualties include a civilian-death tally, that number is
            # not comparable to military strength. Casualty strings typically
            # separate military and civilian counts with a semicolon
            # ("~110,000 killed; 100,000-150,000 civilian dead"). Use only the
            # prefix up to the first semicolon when "civilian" appears later.
            cas_lower = casualties_str.lower()
            if 'civilian' in cas_lower:
                semi = casualties_str.find(';')
                military_part = casualties_str[:semi] if semi >= 0 else casualties_str[:cas_lower.index('civilian')]
                military_nums = all_ints(military_part)
                if military_nums:
                    casualties = military_nums
            # Use the largest plausible number from each so multi-figure entries
            # like "156,000 on D-Day, 2M+ total" compare against the larger one.
            strength_max = max(strengths)
            casualties_max = max(casualties)
            if strength_max <= 50:
                continue
            # 1.2x tolerance: surrenders + reinforcements pushed siege losses
            # slightly over initial defender count in some real cases.
            if casualties_max > int(strength_max * 1.2):
                findings['warn'].append(
                    f'{bid} side {i} ({side.get("name","?")}): casualties {casualties_max:,} > strength {strength_max:,}')

    # Era taxonomy: every era used must be a value in the year_to_era table.
    valid_eras = {'ancient', 'medieval', 'early-modern', 'napoleonic',
                  'industrial', 'world-war-1', 'interwar', 'world-war-2',
                  'modern'}
    for b in battles:
        era = b.get('era', '')
        if era and era not in valid_eras:
            findings['error'].append(
                f'{b["id"]}: era="{era}" is not in the standard taxonomy')

    # Phase replay faction label sanity: factionA/B should loosely correspond
    # to the battle's first two sides. Catches drift when the battle's side
    # list is rewritten without updating the replay.
    for phase_id, replay in phases.items():
        battle = by_id.get(phase_id)
        if not battle:
            continue
        sides = battle.get('sides', [])
        if len(sides) < 2:
            continue
        a = replay.get('factionA', '').lower()
        b_lab = replay.get('factionB', '').lower()
        s0 = sides[0].get('name', '').lower()
        s1 = sides[1].get('name', '').lower()
        def tokens(s: str) -> set:
            return set(re.findall(r'[a-z]+', s))
        # Require at least one shared keyword between each replay label and
        # its corresponding side, otherwise the labels likely drifted.
        if a and s0 and not (tokens(a) & tokens(s0)):
            findings['info'].append(
                f'replay {phase_id}: factionA="{replay["factionA"]}" shares no word with side 0 "{sides[0].get("name","")}"')
        if b_lab and s1 and not (tokens(b_lab) & tokens(s1)):
            findings['info'].append(
                f'replay {phase_id}: factionB="{replay["factionB"]}" shares no word with side 1 "{sides[1].get("name","")}"')

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
