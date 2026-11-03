import { useState } from 'react';
import { TIER_LABELS, TIER_DESCRIPTIONS } from '../types/battle';

// TIER_ORDER walks the tiers from most to least trustworthy so the note
// reads as a descent from hand-built to harvested.
const TIER_ORDER = ['reconstructed', 'documented', 'indexed'];

// DataQualityNote is the permanently visible "About the data" affordance
// anchored to the globe. Anywhere the interface aggregates, ranks, or
// animates, a reader will assume the underlying data supports that
// precision; this note is the standing correction. The chip stays on
// screen while the user browses, and the expanded card explains the tier
// system and the estimate policy in a few lines instead of burying them
// in the README.
export default function DataQualityNote() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      {open && (
        <div
          className="absolute bottom-full left-0 mb-2 w-[320px] max-w-[86vw] rounded-xl p-4 backdrop-blur-md"
          style={{
            background: 'rgba(8, 10, 18, 0.92)',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 16px 40px -12px rgba(0, 0, 0, 0.7)',
          }}
          role="note"
          aria-label="About the data"
        >
          <div className="text-[9px] font-semibold uppercase tracking-[0.3em] text-slate-400 mb-2">
            About the data
          </div>
          <p className="text-[12px] leading-[1.6] text-slate-300 mb-3">
            Records vary widely in depth. Every battle carries a tier badge
            that says how much of it has been checked by hand.
          </p>
          <ul className="space-y-2 mb-3">
            {TIER_ORDER.map((tier) => (
              <li key={tier} className="text-[11.5px] leading-[1.55] text-slate-400">
                <span className="text-slate-200 font-semibold">{TIER_LABELS[tier]}</span>
                {': '}
                {TIER_DESCRIPTIONS[tier]}
              </li>
            ))}
          </ul>
          <p className="text-[11.5px] leading-[1.6] text-slate-400">
            Death tolls and casualty figures are contested historical
            estimates, never counts. Where published estimates disagree the
            app shows the range, and totals built from battle records are
            marked as such.
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 max-sm:h-11 max-sm:py-0 rounded-full text-[10px] uppercase tracking-[0.2em] max-sm:tracking-[0.12em] font-semibold whitespace-nowrap backdrop-blur-md transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        style={{
          background: 'rgba(8, 10, 18, 0.55)',
          border: '1px solid rgba(148, 163, 184, 0.25)',
          color: open ? '#e2e8f0' : '#94a3b8',
        }}
        title="How much of this data is hand-checked, and what the numbers mean"
      >
        <span
          aria-hidden="true"
          className="inline-flex items-center justify-center rounded-full"
          style={{
            width: 12,
            height: 12,
            border: '1px solid currentColor',
            fontSize: 8,
            fontStyle: 'italic',
            fontFamily: 'Georgia, serif',
          }}
        >
          i
        </span>
        <span className="max-sm:hidden">About the&nbsp;</span>data
      </button>
    </div>
  );
}
