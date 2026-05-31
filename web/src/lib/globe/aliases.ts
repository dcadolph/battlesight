// COUNTRY_NAME_ALIASES maps our canonical country labels to the names used
// by the world-atlas topology. The atlas is the Natural Earth dataset which
// uses long-form English names ("United States of America") while our
// canonicalization produces short forms ("United States"). Korea is split
// into two atlas features but our normaliser collapses them, so we list
// both. Shared by BattleGlobe + GlobeReplay so the same warCountryColors
// prop produces identical shading on both globes.
export const COUNTRY_NAME_ALIASES: Record<string, string[]> = {
  'United States': ['United States of America'],
  'United Kingdom': ['United Kingdom'],
  Korea: ['South Korea', 'North Korea'],
  Rome: ['Italy'],
  Palestine: ['Palestine'],
};
