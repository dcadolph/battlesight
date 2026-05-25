"""Regex sweep over summary text to extract victor for battles missing one.

Looks for explicit win/loss phrasing in the lead text and writes the
winner into the empty victor column. Conservative: only fills when the
match is unambiguous. Anything ambiguous (multiple matches, vague verbs)
is left for human curation.

Idempotent: only touches rows where victor is blank.
"""
import sqlite3
import re

DB = '/Users/douglasadolph/src/dcadolph/battlesight/data/battlesight.db'

# Patterns ordered by specificity. First match wins. Group 1 is the
# victor, except where noted. Patterns are case-insensitive at runtime.
PATTERNS = [
    # "X defeated Y" / "X defeats Y" / "X routed Y"
    (re.compile(r'\b([A-Z][\w\-\'.]+(?:\s+[A-Z][\w\-\'.]+){0,3})\s+(?:decisively\s+)?(?:defeated|defeats|routed|crushed|annihilated|destroyed|overwhelmed)\s+(?:the\s+)?[A-Z]'), 1),
    # "victory for X" / "X victory"
    (re.compile(r'\bvictory\s+for\s+(?:the\s+)?([A-Z][\w\-\'.]+(?:\s+[A-Z][\w\-\'.]+){0,3})'), 1),
    (re.compile(r'\bdecisive\s+([A-Z][\w\-\'.]+(?:\s+[A-Z][\w\-\'.]+){0,2})\s+victory'), 1),
    # "X won the battle"
    (re.compile(r'\b([A-Z][\w\-\'.]+(?:\s+[A-Z][\w\-\'.]+){0,3})\s+won\s+(?:the\s+)?(?:battle|engagement|siege|war)'), 1),
    # "Y surrendered to X" / "Y capitulated to X"
    (re.compile(r'\bsurrendered\s+to\s+(?:the\s+)?([A-Z][\w\-\'.]+(?:\s+[A-Z][\w\-\'.]+){0,3})'), 1),
    (re.compile(r'\bcapitulated\s+to\s+(?:the\s+)?([A-Z][\w\-\'.]+(?:\s+[A-Z][\w\-\'.]+){0,3})'), 1),
    # "Y were forced to retreat by X"
    (re.compile(r'\bforced\s+to\s+(?:retreat|withdraw|abandon)\s+by\s+(?:the\s+)?([A-Z][\w\-\'.]+(?:\s+[A-Z][\w\-\'.]+){0,3})'), 1),
]

# Phrases that are NOT victors. Filter these from the captured group.
NON_VICTORS = {
    'the', 'they', 'their', 'his', 'her', 'its', 'them',
    'a', 'an', 'this', 'that', 'these', 'those',
    'force', 'forces', 'army', 'navy', 'troops', 'side',
    'after', 'before', 'during', 'when', 'while',
    'although', 'however', 'meanwhile', 'subsequently',
    'general', 'colonel', 'major', 'captain', 'lieutenant',
    'king', 'queen', 'emperor', 'duke', 'prince',
}


def extract_victor(summary: str) -> str | None:
    if not summary:
        return None
    for pat, grp in PATTERNS:
        m = pat.search(summary)
        if not m:
            continue
        candidate = m.group(grp).strip().rstrip('.,;:')
        first_word = candidate.split()[0].lower() if candidate else ''
        if first_word in NON_VICTORS:
            continue
        if len(candidate) < 3 or len(candidate) > 60:
            continue
        return candidate
    return None


def main():
    con = sqlite3.connect(DB)
    cur = con.cursor()
    cur.execute("SELECT id, summary FROM battles WHERE victor = '' AND summary != ''")
    rows = cur.fetchall()
    print(f'rows missing victor with summary: {len(rows)}', flush=True)

    filled = 0
    for bid, summary in rows:
        v = extract_victor(summary)
        if not v:
            continue
        cur.execute("UPDATE battles SET victor = ? WHERE id = ?", (v, bid))
        filled += 1
    con.commit()
    con.close()
    print(f'filled victor in {filled} rows', flush=True)


if __name__ == '__main__':
    main()
