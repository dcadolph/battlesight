import { useState } from 'react';

import { IMAGERY_LINKS } from '../../lib/globe/imagery';
import type { ImageryStage } from '../../lib/globe/imagery';

// ImageryAttributionProps configures the attribution strip.
interface ImageryAttributionProps {
  // stage picks the credit for the imagery on screen.
  stage: ImageryStage;
  // position is fixed for the landing globe and absolute inside the replay stage.
  position: 'fixed' | 'absolute';
}

// linkClass styles the credit links.
const linkClass = 'underline decoration-slate-500/60 underline-offset-2 hover:text-slate-100';

// ImageryCredit is the credit text for the imagery on screen. The tiles text
// is the attribution EOX publishes for the layer, with its two links live.
function ImageryCredit({ stage }: { stage: ImageryStage }) {
  if (stage === 'stock') return <span>Imagery: NASA Blue Marble</span>;
  return (
    <span>
      EOxCloudless{' '}
      <a className={linkClass} href={IMAGERY_LINKS.eox} target="_blank" rel="noopener noreferrer">
        https://cloudless.eox.at
      </a>{' '}
      by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016) released under{' '}
      <a className={linkClass} href={IMAGERY_LINKS.license} target="_blank" rel="noopener noreferrer">
        Creative Commons Attribution 4.0 International License
      </a>
      .
    </span>
  );
}

// ImageryAttribution renders the hairline credit for the globe imagery in the
// bottom-right corner.
export default function ImageryAttribution({ stage, position }: ImageryAttributionProps) {
  return (
    <div
      className={`${position} bottom-1 right-2 z-[25] max-w-[calc(100vw-16px)] text-right text-[11px] leading-snug text-slate-300/70`}
      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
    >
      <ImageryCredit stage={stage} />
    </div>
  );
}

// ImageryCreditChip is the phone form of the credit: a one-line chip that
// names the source and opens the full credit, links included, above it.
export function ImageryCreditChip({ stage }: { stage: ImageryStage }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 w-[300px] max-w-[86vw] rounded-xl p-4 text-[11.5px] leading-[1.55] text-slate-300 backdrop-blur-md"
          style={{
            background: 'rgba(8, 10, 18, 0.92)',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 16px 40px -12px rgba(0, 0, 0, 0.7)',
          }}
          role="note"
          aria-label="Imagery credit"
        >
          <ImageryCredit stage={stage} />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Imagery credit"
        className="inline-flex items-center h-11 px-2.5 rounded-full text-[10px] uppercase tracking-[0.08em] font-semibold whitespace-nowrap backdrop-blur-md focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        style={{
          background: 'rgba(8, 10, 18, 0.55)',
          border: '1px solid rgba(148, 163, 184, 0.25)',
          color: open ? '#e2e8f0' : '#94a3b8',
        }}
      >
        &copy; {stage === 'stock' ? 'NASA' : 'EOX'}
      </button>
    </div>
  );
}
