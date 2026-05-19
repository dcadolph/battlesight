// Shared formatters. Every battle / war surface routes through these so the
// app's date, year, and count strings never drift apart from one another.
// The previous duplication of `formatYear`, `formatBeatYear`,
// `formatYearLabel`, `formatNumber`, `formatCasualties` across nine
// components meant a typo in one shipped silently as inconsistency in the
// rest. Single source of truth here.

// formatYear renders a calendar year as a short human label.
//   -490 → "490 BC"
//   1066 → "1066"
//      0 → "?"   (year zero is the importer's sentinel for unknown)
export function formatYear(year: number): string {
  if (!Number.isFinite(year) || year === 0) return '?';
  if (year < 0) return `${Math.abs(year)} BC`;
  return `${year}`;
}

// formatYearRange renders an inclusive year span. Same year on both sides
// collapses to a single label so "1066 – 1066" reads as "1066".
export function formatYearRange(yearStart: number, yearEnd: number): string {
  if (!Number.isFinite(yearStart) || !Number.isFinite(yearEnd)) return '';
  if (yearStart === yearEnd) return formatYear(yearStart);
  return `${formatYear(yearStart)} – ${formatYear(yearEnd)}`;
}

// formatBattleDate prefers the human date string when present and not a
// placeholder. Recognises three sentinel forms returned by the Wikidata
// importer as "year-only" and degrades them to the formatted year so the
// UI does not render ISO bookends ("1939-01-01") for a battle whose
// actual day-of-month is unknown:
//   * empty string
//   * the bare "0"
//   * any "YYYY-01-01" / "YYYY-12-31" / "YYYY-00-00" pattern with no
//     other text around it
// Anything else (a real human range like "September 21–22, 1939" or a
// month-name string like "June 1944") flows through unchanged.
export function formatBattleDate(date: string | null | undefined, year: number): string {
  const trimmed = (date ?? '').trim();
  if (!trimmed || trimmed === '0') return formatYear(year);
  if (/^-?\d{1,4}-(?:00|01|12)-(?:00|01|31)$/.test(trimmed)) return formatYear(year);
  return trimmed;
}

// formatNumberWithCommas writes "117,871" for 117871. Plain integer with
// thousands separators using the en-US convention; the app's prose is
// English throughout so we pin the locale rather than asking the browser.
export function formatNumberWithCommas(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Math.round(n).toLocaleString('en-US');
}

// formatCountCompact renders large counts as compact human-readable strings.
//   117871 → "117k"
//  1234567 → "1.2M"
//      450 → "450"
// Used in tooltips, badges, anywhere the value should not dominate the
// surrounding text.
export function formatCountCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000).toLocaleString('en-US')}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

// formatCasualtyPhrase composes the noun phrase used in narration and
// outro cards: "117k casualties", "1.2M casualties", "450 casualties".
export function formatCasualtyPhrase(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return 'Casualties unknown';
  return `${formatCountCompact(n)} casualties`;
}

// formatCasualtyEstimate is the "About 117,000 casualties" variant for
// long-form prose where the soft hedge reads better than a punchy "117k".
export function formatCasualtyEstimate(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return 'Casualty count not recorded';
  if (n >= 1_000_000) return `About ${(n / 1_000_000).toFixed(1)} million casualties`;
  if (n >= 10_000) {
    const rounded = Math.round(n / 1000) * 1000;
    return `About ${formatNumberWithCommas(rounded)} casualties`;
  }
  return `About ${formatNumberWithCommas(n)} casualties`;
}

// cleanCasualtyText scrubs the worst patterns out of freeform casualty
// strings before they render on screen. Goals:
//   * No semicolons in user-facing prose (project-wide rule).
//   * Strip a leading "None killed" / "Negligible" clause when a real
//     count follows it, so "None killed; one man killed and three
//     wounded" reads as "One man killed and three wounded".
//   * Strip the "for {side name}" trailer that infobox-derived casualty
//     prose sometimes carries ("9 killed for Syrian opposition") since the
//     side label is already rendered in the row header — the duplication
//     reads as garbage.
//   * Strip immediately-repeated identical tokens ("Syrian opposition
//     Syrian Opposition" → "Syrian opposition") that come from infobox
//     parsers that emitted both the flag-template name and the wiki link.
//   * Normalise spaces around commas and periods.
//   * Collapse bare "None" or "Nil" sentinels into "None reported".
// Idempotent. Empty input returns empty.
export function cleanCasualtyText(s: string | undefined | null): string {
  if (!s) return '';
  let out = String(s).trim();
  if (!out) return '';
  // Strip the parenthetical "for {side}" trailer ("9 killed for Syrian
  // opposition"). The side name is shown in the row header already.
  out = out.replace(/\s+for\s+[A-Z][^.;]*$/i, '');
  // Strip leading "None ..." preamble when a useful clause follows.
  out = out.replace(
    /^(?:none|nil|no)\s+(?:killed|dead|fatalities|casualties)(?:\s+(?:in|during|at)[^,;.]*)?\s*[;,.]\s+/i,
    '',
  );
  // Replace remaining semicolons with periods so we never render a
  // semicolon on screen.
  out = out.replace(/\s*;\s*/g, '. ');
  // Fix em-dashes used as separators.
  out = out.replace(/\s*—\s*/g, ', ');
  // Collapse case-insensitive immediately-repeated word runs
  // ("Syrian opposition Syrian Opposition" → "Syrian opposition") that come
  // from Wikipedia infobox parsers emitting both the flag template label
  // and the wiki link.
  out = out.replace(/\b([\w']+(?:\s+[\w']+){0,3})\s+\1\b/gi, '$1');
  // Fix double spaces and stray space-before-comma.
  out = out.replace(/\s+,/g, ',').replace(/\s+/g, ' ');
  // If after cleaning we only have a "none" sentinel, return a tidy label.
  if (/^(?:none|nil|no(?:ne)?\s+reported)\.?$/i.test(out)) {
    return 'None reported';
  }
  // Capitalise the first character so the line reads as a sentence.
  if (out.length > 0) {
    out = out[0].toUpperCase() + out.slice(1);
  }
  return out;
}

// cleanProseText scrubs Wikipedia/wikitext markup that leaks into long-form
// prose fields (summary, significance, war outcome, war aftermath) when the
// importer couldn't fully clean the source article. Goals:
//   * Drop image captions entirely: "thumb|300px|Foo.jpg|caption" is junk
//     in a prose body, so any leading "thumb|..." (and similar File:/Image:
//     prefixes) gets removed.
//   * Strip wikitext heading bars: "===Military===" → "Military".
//   * Resolve wiki links: "[[Page|Display]]" → "Display"; "[[Page]]" →
//     "Page"; "[[:Commons:Category:Foo|Caption]]" → "Caption".
//   * Strip bold/italic apostrophe runs ("'''bold'''" → "bold").
//   * Drop residual "{{template|args}}" and HTML comments.
//   * Normalise the "See Aftermath" outcome trailer that wars.json
//     inherited from the infobox result field, leaving a clean clause.
//   * Replace remaining semicolons with periods (project-wide rule).
// Idempotent. Empty input returns empty string.
export function cleanProseText(s: string | undefined | null): string {
  if (!s) return '';
  let out = String(s);
  // Drop HTML comments.
  out = out.replace(/<!--[\s\S]*?-->/g, '');
  // Drop residual templates {{...}}.
  out = out.replace(/\{\{[^{}]*\}\}/g, '');
  // Drop file/image embeds entirely: "[[File:foo.jpg|thumb|caption]]" or
  // any bracket block that starts with File:/Image:/Media:.
  out = out.replace(/\[\[(?:File|Image|Media):[^\[\]]*\]\]/gi, '');
  // Resolve wiki links: prefer the display label after the pipe.
  out = out.replace(/\[\[([^\[\]|]*\|)?([^\[\]]+)\]\]/g, (_, _pre, label) => label);
  // Strip the "thumb|" / "left|" / "right|" / "300px|" caption prefix
  // chain that occasionally survives when an image caption sentence
  // was lifted out of its surrounding [[File:...]] block. Handles a
  // trailing chain like "thumb|300px|left|Caption goes here".
  out = out.replace(
    /(^|\s)(?:thumb|left|right|center|none|frame|frameless|upright)\|(?:\s*\d+px\s*\|)?(?:\s*(?:left|right|center|none)\s*\|)?/gi,
    '$1',
  );
  // Drop any remaining "Npx|" image size prefix.
  out = out.replace(/(^|\s)\d+px\|/gi, '$1');
  // Strip wikitext heading bars "=== Foo ===" → "Foo".
  out = out.replace(/^={2,6}\s*([^=\n]+?)\s*={2,6}\s*$/gm, '$1');
  // Strip bold/italic apostrophes.
  out = out.replace(/'''+/g, '').replace(/''+/g, '');
  // Drop "See Aftermath" / "See below" trailer from outcome fields.
  out = out.replace(/[;,]\s*See\s+(?:Aftermath|below|article|main\s+article)\s*\.?$/i, '');
  // Collapse "X;," → "X," and trailing ;, → period.
  out = out.replace(/;\s*,/g, ',');
  // Semicolons inside (...) — typically the {{convert}} wiki template
  // expanding as "(560 km; 350 mi)" — should degrade to a comma, not a
  // period. The blanket semicolon-to-period rule below otherwise leaves
  // a sentence-ending period in the middle of a parenthetical, which
  // reads as a mid-line truncation. Run before the blanket sweep so the
  // inside-parens cases are caught first.
  out = out.replace(/\(([^()]*?);\s*([^()]*?)\)/g, '($1, $2)');
  // Replace remaining semicolons with periods (project-wide rule).
  out = out.replace(/\s*;\s*/g, '. ');
  // Em-dash to comma (no sentence-breaking hyphens in prose).
  out = out.replace(/\s*—\s*/g, ', ');
  // Collapse whitespace runs, drop stray spaces before punctuation, and
  // tidy any double periods left behind by deletions.
  out = out.replace(/[ \t]+/g, ' ');
  out = out.replace(/\s+([,.!?])/g, '$1');
  out = out.replace(/\.\s*\./g, '.');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  // Drop a dangling " ..." or "..." truncation suffix: when the source
  // was a Wikipedia lead that was cut short by a length limiter, the
  // trailing ellipsis reads as broken text. We snip back to the last
  // sentence boundary so the visible prose ends on a real sentence.
  if (/\.{2,}\s*$/.test(out) || /\s\.\s*\.\s*$/.test(out)) {
    out = out.replace(/[\s.]{2,}$/g, '');
    const lastTerm = Math.max(out.lastIndexOf('.'), out.lastIndexOf('!'), out.lastIndexOf('?'));
    if (lastTerm > 20 && lastTerm < out.length - 1) {
      out = out.slice(0, lastTerm + 1);
    }
  }
  // Guarantee terminal punctuation. If the cleaned text does not end in
  // a period, exclamation, or question mark, append a period so every
  // dossier paragraph and outro card reads as a complete sentence. Skips
  // empty strings and strings ending in a closing quote/bracket where
  // the punctuation actually lives before the closer.
  out = out.trim();
  if (out.length > 0 && !/[.!?][")\]]?$/.test(out)) {
    out = out + '.';
  }
  return out;
}
