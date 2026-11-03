import { useState, type ReactNode } from 'react';

import { IMAGERY_LINKS } from '../lib/globe/imagery';

// CreditLink is one outbound link in the about card. Every link opens in a
// new tab without handing the destination a reference back to this page.
function CreditLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-slate-200 underline decoration-slate-500/60 underline-offset-2 hover:decoration-slate-200"
    >
      {children}
    </a>
  );
}

// AboutNote is the standing "Pre-release" chip beside the data-quality
// chip. The chip itself carries the pre-release label so it is visible
// without a click, and the card holds the credits the open data and map
// sources require, the source link, and the donation link.
export default function AboutNote() {
  const [open, setOpen] = useState(false);

  return (
    <div>
      {open && (
        <div
          className="absolute bottom-full left-0 mb-2 w-[320px] max-w-[86vw] max-h-[60vh] overflow-y-auto rounded-xl p-4 backdrop-blur-md"
          style={{
            background: 'rgba(8, 10, 18, 0.92)',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            boxShadow: '0 16px 40px -12px rgba(0, 0, 0, 0.7)',
          }}
          role="note"
          aria-label="About BattleSight"
        >
          <div className="text-[9px] font-semibold uppercase tracking-[0.3em] text-slate-400 mb-2">
            About BattleSight
          </div>
          <p className="text-[12px] leading-[1.6] text-slate-300 mb-3">
            Pre-release. Data and visuals change often.
          </p>
          <div className="text-[9px] font-semibold uppercase tracking-[0.3em] text-slate-500 mb-1.5">
            Credits
          </div>
          <ul className="space-y-1.5 mb-3 text-[11.5px] leading-[1.55] text-slate-400">
            <li>
              Battle records from <CreditLink href="https://en.wikipedia.org/">Wikipedia</CreditLink>, text
              under <CreditLink href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</CreditLink>,
              and <CreditLink href="https://www.wikidata.org/">Wikidata</CreditLink>, under{' '}
              <CreditLink href="https://creativecommons.org/publicdomain/zero/1.0/">CC0</CreditLink>.
            </li>
            <li>
              Force and casualty data from{' '}
              <CreditLink href="https://github.com/jrnold/CDB90">CDB90</CreditLink>, the U.S. Army Concepts
              Analysis Agency database of battles.
            </li>
            <li>
              Replay maps from{' '}
              <CreditLink href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</CreditLink>{' '}
              via <CreditLink href="https://openfreemap.org/">OpenFreeMap</CreditLink>, with relief from{' '}
              <CreditLink href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md">
                Mapzen terrain tiles
              </CreditLink>
              .
            </li>
            <li>
              Globe imagery: EOxCloudless{' '}
              <CreditLink href={IMAGERY_LINKS.eox}>https://cloudless.eox.at</CreditLink> by EOX IT Services
              GmbH (Contains modified Copernicus Sentinel data 2016) released under{' '}
              <CreditLink href={IMAGERY_LINKS.license}>
                Creative Commons Attribution 4.0 International License
              </CreditLink>
              . NASA Blue Marble when the imagery service is unavailable. Country outlines from Natural Earth
              via world-atlas.
            </li>
          </ul>
          <p className="text-[11.5px] leading-[1.6] text-slate-400 mb-3">
            <CreditLink href="https://github.com/dcadolph/battlesight">Source on GitHub</CreditLink>
          </p>
          <p className="text-[11.5px] leading-[1.6] text-slate-300">
            <CreditLink href="https://u24.gov.ua/donate">Support Ukraine's defense</CreditLink> through
            United24, the official fundraising platform of Ukraine.
          </p>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 max-sm:h-11 max-sm:py-0 rounded-full text-[10px] uppercase tracking-[0.2em] max-sm:tracking-[0.08em] font-semibold whitespace-nowrap backdrop-blur-md transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-white/30"
        style={{
          background: 'rgba(8, 10, 18, 0.55)',
          border: '1px solid rgba(148, 163, 184, 0.25)',
          color: open ? '#e2e8f0' : '#94a3b8',
        }}
        title="Pre-release status, credits, and source"
      >
        <span
          aria-hidden="true"
          className="inline-block rounded-full"
          style={{ width: 6, height: 6, background: '#f59e0b' }}
        />
        Pre-release
      </button>
    </div>
  );
}
