"""Audit the live SQLite battle database for data-quality failures.

Runs every invariant we can check programmatically across all battles, not
just the curated set. Prints findings grouped by severity. Exits non-zero
if any ERROR-level issues are found.

Categories:
  ERROR  - violation that would visibly embarrass the product
           (year/date mismatch, era mismatch, broken ISO date, garbage
           in war name, etc.)
  WARN   - suspicious, may be real-world quirk
           (0,0 coordinates, casualties > strength, lone-side battle)
  INFO   - cosmetic or already-known
           (sparse Wikidata records that are marked 'indexed' on purpose)

Run after the server has started at least once so the migration in
internal/importer/MigrateDates has populated date_start / date_end.
"""
import re
import sqlite3
import sys
from collections import Counter, defaultdict

DB_PATH = 'data/battlesight.db'

# Mirrors importer.yearToEra in internal/importer/wikidata.go.
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

VALID_ERAS = {
    'ancient', 'medieval', 'early-modern', 'napoleonic', 'industrial',
    'world-war-1', 'interwar', 'world-war-2', 'modern',
}

VALID_BATTLE_TYPES = {'land', 'naval', 'siege', 'aerial', 'air',
                      'amphibious', 'urban', ''}

# Year extraction from date string mirrors scripts/audit_data.py behavior.
YEAR_RE = re.compile(r'\b(\d{3,4})\b')
BC_RE = re.compile(r'(\d+)\s*BC')

# Ambiguous prose: the date string lists multiple candidate years (or notes
# uncertainty). When that's the case the parser may pick any of them, so we
# don't flag mismatches against `year`. Mirrors internal/importer.cleanse's
# reAmbiguousDate.
AMBIGUOUS_RE = re.compile(
    r'\b(or|between|approximately|c\.|circa|disputed|estimated|chronology|/)\b',
    re.IGNORECASE,
)

# Garbage markers that indicate raw wiki/infobox text leaked into a field.
GARBAGE_TOKENS = ('{{', '}}', '[[', ']]', '|combatant', '<ref', '<br',
                  'cite news', 'cite web', 'cite book', '=image:')

# U+FFFD is what we substitute when decoding invalid UTF-8. Any field that
# contains it round-trips through a decode failure, which means the underlying
# bytes are corrupted and the public render will show garbled glyphs.
REPLACEMENT_CHAR = '�'

# Date parser used for ISO start/end validation.
ISO_DATE_RE = re.compile(r'^(-?\d{4})-(\d{2})-(\d{2})$')


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


def year_candidates(date: str) -> list:
    """Return every plausible year mentioned in a prose date string.

    Ranges like "1213-31 May 1215" yield [1213, 1215]; dual notation like
    "1184 AH (1770 CE)" yields [1184, 1770]. A row's `year` column is
    considered consistent with the prose whenever it appears in this list,
    OR when it falls inside the [min, max] envelope (covers "686-690" with
    year=688).
    """
    if not date:
        return []
    years = []
    for m in BC_RE.finditer(date):
        years.append(-int(m.group(1)))
    # Strip BC tokens before scanning for AD years to avoid double-counting.
    cleaned = BC_RE.sub('', date)
    for m in YEAR_RE.finditer(cleaned):
        years.append(int(m.group(1)))
    return years


def parse_iso(d: str):
    """Return (year, month, day) tuple for an ISO date, or None if malformed."""
    if not d:
        return None
    m = ISO_DATE_RE.match(d)
    if not m:
        return None
    y, mo, da = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if mo < 1 or mo > 12 or da < 1 or da > 31:
        return None
    return (y, mo, da)


def contains_garbage(s: str) -> bool:
    if not s:
        return False
    low = s.lower()
    return any(tok in low for tok in GARBAGE_TOKENS)


def has_bad_unicode(s: str) -> bool:
    return bool(s) and REPLACEMENT_CHAR in s


def main() -> int:
    findings = {'error': [], 'warn': [], 'info': []}
    counts_by_category = Counter()

    conn = sqlite3.connect(DB_PATH)
    # Tolerate invalid UTF-8 in legacy rows: replace bad bytes with U+FFFD.
    # The audit treats the presence of the replacement character itself as an
    # error so we don't lose visibility, but the query no longer raises.
    conn.text_factory = lambda b: b.decode('utf-8', errors='replace')
    conn.row_factory = sqlite3.Row

    battles = list(conn.execute('''
        SELECT id, name, year, date, date_start, date_end, lat, lng,
               era, war, battle_type, victor, summary, verified, source,
               wikipedia_title
        FROM battles
    '''))
    by_id = {b['id']: b for b in battles}

    def add(severity: str, category: str, msg: str):
        findings[severity].append(f'[{category}] {msg}')
        counts_by_category[(severity, category)] += 1

    # --- ID uniqueness ---
    id_counts = Counter(b['id'] for b in battles)
    for bid, c in id_counts.items():
        if c > 1:
            add('error', 'duplicate-id', f'{bid} appears {c} times')

    # --- Per-row checks ---
    for b in battles:
        bid = b['id']

        # Required fields
        for field in ('name', 'year', 'date', 'era'):
            if not b[field] and b[field] != 0:
                add('error', 'missing-field', f'{bid}: {field} empty')

        # Year/date agreement. Ambiguous prose ("574, 580, or 590") is
        # recognised as such; for those we trust the curated year field.
        # For unambiguous prose, the year is OK whenever it appears in any of
        # the candidate years OR sits inside the candidate min-max envelope
        # (so "686-690" accepts year=688).
        y = b['year']
        date_is_ambiguous = bool(b['date'] and AMBIGUOUS_RE.search(b['date']))
        candidates = year_candidates(b['date'] or '')
        if candidates and y != 0 and not date_is_ambiguous:
            ok = y in candidates
            if not ok and len(candidates) >= 2:
                lo, hi = min(candidates), max(candidates)
                if lo <= y <= hi:
                    ok = True
            if not ok:
                add('error', 'year-date-mismatch',
                    f'{bid}: year={y} date="{b["date"]}" candidates={candidates}')

        # Era taxonomy
        era = b['era'] or ''
        if era and era not in VALID_ERAS:
            add('error', 'invalid-era', f'{bid}: era="{era}" not in taxonomy')

        # Era ↔ year mapping
        if era and y != 0:
            expected = year_to_era(y)
            if expected and era != expected:
                add('error', 'era-year-mismatch',
                    f'{bid}: era="{era}" but year={y} maps to "{expected}"')

        # Battle type
        bt = b['battle_type'] or ''
        if bt and bt not in VALID_BATTLE_TYPES:
            add('warn', 'invalid-battle-type', f'{bid}: battle_type="{bt}"')

        # Coordinates
        lat, lng = b['lat'], b['lng']
        if lat is None or lng is None or lat < -90 or lat > 90:
            add('error', 'bad-coords', f'{bid}: lat={lat} out of range')
        if lng is None or lng < -180 or lng > 180:
            add('error', 'bad-coords', f'{bid}: lng={lng} out of range')
        if lat == 0 and lng == 0:
            # Zero-coord rows are silently excluded by the API's default
            # filter (store.buildWhere adds "lat != 0 OR lng != 0"), so they
            # never reach the user. Track them so curators can backfill
            # coordinates later, but they don't represent a visible problem.
            add('info', 'zero-coords', f'{bid}: coords (0,0)')

        # ISO date validity
        ds = b['date_start'] or ''
        de = b['date_end'] or ''
        if ds:
            p = parse_iso(ds)
            if not p:
                add('error', 'bad-date-start', f'{bid}: date_start="{ds}"')
        if de:
            p = parse_iso(de)
            if not p:
                add('error', 'bad-date-end', f'{bid}: date_end="{de}"')
        # End >= start
        if ds and de and parse_iso(ds) and parse_iso(de):
            if parse_iso(de) < parse_iso(ds):
                add('error', 'date-inversion',
                    f'{bid}: date_end {de} before date_start {ds}')

        # date_start year must agree with `year` column. Same envelope rule
        # as year/date: candidates from prose define an acceptable range.
        sp = parse_iso(ds) if ds else None
        if sp and y != 0 and not date_is_ambiguous:
            sy = sp[0]
            in_range = False
            if candidates:
                lo, hi = min(candidates), max(candidates)
                in_range = lo <= y <= hi
            if sy != y and y not in candidates and not in_range:
                add('error', 'year-date_start-mismatch',
                    f'{bid}: year={y} but date_start year={sy}')

        # Garbage in war / name / victor
        if contains_garbage(b['war'] or ''):
            add('error', 'garbage-war', f'{bid}: war="{b["war"]}"')
        if contains_garbage(b['name'] or ''):
            add('error', 'garbage-name', f'{bid}: name="{b["name"]}"')
        if contains_garbage(b['victor'] or ''):
            add('error', 'garbage-victor', f'{bid}: victor="{b["victor"]}"')

        # Corrupted UTF-8 — any replacement glyph in a user-visible string.
        for field in ('name', 'war', 'victor', 'summary'):
            if has_bad_unicode(b[field] or ''):
                add('error', 'bad-unicode', f'{bid}: {field} has replacement glyph')

        # War name length sanity
        if b['war'] and len(b['war']) > 120:
            add('warn', 'long-war', f'{bid}: war length={len(b["war"])}')

    # --- Sides quality ---
    side_rows = list(conn.execute('''
        SELECT battle_id, side_index, name, commander, strength, casualties
        FROM battle_sides
    '''))
    sides_by_battle = defaultdict(list)
    for s in side_rows:
        sides_by_battle[s['battle_id']].append(s)

    for bid, sides in sides_by_battle.items():
        if bid not in by_id:
            add('error', 'orphan-side', f'battle_id={bid} has no battle row')
            continue
        for s in sides:
            if contains_garbage(s['name'] or ''):
                add('error', 'garbage-side-name',
                    f'{bid} side {s["side_index"]}: name="{s["name"]}"')
            if contains_garbage(s['commander'] or ''):
                add('warn', 'garbage-commander',
                    f'{bid} side {s["side_index"]}: commander="{s["commander"]}"')
            if not (s['name'] or '').strip():
                add('error', 'missing-side-name',
                    f'{bid} side {s["side_index"]}: blank name')
            for field in ('name', 'commander', 'strength', 'casualties'):
                if has_bad_unicode(s[field] or ''):
                    add('error', 'bad-unicode-side',
                        f'{bid} side {s["side_index"]}: {field} has replacement glyph')

    # --- Duplicates (likely the same battle imported twice) ---
    # Same wikipediaTitle is the strongest signal.
    by_wiki = defaultdict(list)
    for b in battles:
        wt = (b['wikipedia_title'] or '').strip()
        if wt:
            by_wiki[wt].append(b['id'])
    for wt, ids in by_wiki.items():
        if len(ids) > 1:
            add('error', 'duplicate-wikipedia-title',
                f'"{wt}": {ids}')

    # Same name + year + coords.
    by_signature = defaultdict(list)
    for b in battles:
        if not b['name']:
            continue
        sig = (b['name'].strip().lower(), b['year'], round(b['lat'], 3), round(b['lng'], 3))
        by_signature[sig].append(b['id'])
    for sig, ids in by_signature.items():
        if len(ids) > 1:
            add('warn', 'likely-duplicate',
                f'name="{sig[0]}" year={sig[1]} coords=({sig[2]},{sig[3]}): {ids}')

    # --- War-name canonicalization across the whole DB ---
    def canon_war(w: str) -> str:
        s = w.lower().strip()
        for d in ('–', '—', '−'):  # en-dash, em-dash, minus
            s = s.replace(d, '-')
        if s.startswith('the '):
            s = s[4:]
        return s
    war_groups = defaultdict(set)
    for b in battles:
        w = b['war'] or ''
        if w:
            war_groups[canon_war(w)].add(w)
    for key, variants in war_groups.items():
        if len(variants) > 1:
            add('warn', 'war-name-variants',
                f'"{key}" appears as {sorted(variants)}')

    # --- Output ---
    print('=== BattleTrace DB audit ===')
    print(f'Database: {DB_PATH}')
    print(f'Battles audited: {len(battles)}')

    if counts_by_category:
        print('\n--- Category totals ---')
        for (sev, cat), n in sorted(counts_by_category.items(), key=lambda x: (-x[1], x[0])):
            print(f'  {sev.upper():5s} {cat:30s} {n:6d}')

    # Detail dump capped so the terminal stays readable. Full report can be
    # printed by re-running with --full.
    cap = 30 if '--full' not in sys.argv else 10_000_000
    for severity in ('error', 'warn', 'info'):
        items = findings[severity]
        if not items:
            continue
        print(f'\n=== {severity.upper()} ({len(items)}) ===')
        for f in items[:cap]:
            print(f'  {f}')
        if len(items) > cap:
            print(f'  ... ({len(items) - cap} more; rerun with --full)')

    err_count = len(findings['error'])
    warn_count = len(findings['warn'])
    print(f'\nsummary: {err_count} errors, {warn_count} warnings, {len(findings["info"])} info')
    return 1 if err_count else 0


if __name__ == '__main__':
    sys.exit(main())
