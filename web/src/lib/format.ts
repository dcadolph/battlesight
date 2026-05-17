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

// formatBattleDate prefers the human date string when present and not the
// stub "0" sentinel; otherwise falls back to the year label. Used wherever
// the canonical date should appear (dossier metadata, tooltip subline, beat
// card date stamp).
export function formatBattleDate(date: string | null | undefined, year: number): string {
  const trimmed = (date ?? '').trim();
  if (trimmed && trimmed !== '0') return trimmed;
  return formatYear(year);
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
