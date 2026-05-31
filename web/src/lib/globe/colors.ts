// Color helpers shared by both globes. Both BattleGlobe (hexToRgba) and
// GlobeReplay (hexWithAlpha) had near-identical implementations of the
// same operation, now collapsed here.

// hexToRgba converts "#rrggbb" + alpha into an "rgba(r,g,b,a)" string.
// Used by polygon/ring/arc color callbacks where the alpha animates over
// the lifetime of the visual, so a solid hex doesn't cut it. Pass-through
// for non-hex input.
export function hexToRgba(hex: string, alpha: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// hexWithAlpha is an alias kept for source-compat with GlobeReplay's
// existing call sites. Same behaviour as hexToRgba.
export const hexWithAlpha = hexToRgba;

// darkenHex returns a solid darker variant of an "#rrggbb" color by
// scaling each channel by factor (0..1). Solid output keeps the merged
// point buffer fully opaque so depth sorting stays stable. Used for
// battle-dot rim darkening.
export function darkenHex(hex: string, factor: number): string {
  if (!hex.startsWith('#') || hex.length !== 7) return hex;
  const r = Math.round(parseInt(hex.slice(1, 3), 16) * factor);
  const g = Math.round(parseInt(hex.slice(3, 5), 16) * factor);
  const b = Math.round(parseInt(hex.slice(5, 7), 16) * factor);
  const pad = (n: number) => n.toString(16).padStart(2, '0');
  return `#${pad(r)}${pad(g)}${pad(b)}`;
}
