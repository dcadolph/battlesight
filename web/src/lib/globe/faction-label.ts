// Faction-label DOM element factory. Shared by BattleGlobe and
// GlobeReplay so the on-globe identity layer (period-accurate flag
// banner + editorial small-caps name) renders identically in both
// browse mode and replay mode. Pulled out so PersistentGlobe can use
// the exact same factory once both globes merge.
//
// Returns an HTMLElement ready to hand to react-globe.gl's
// `htmlElement` callback. The element is positioned with a
// translate(-50%,-50%) so its center sits at the lat/lng anchor.

export interface FactionLabelDatum {
  text: string;
  faction: string;
  flag: string | null;
}

export function buildFactionLabelElement(d: FactionLabelDatum): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = [
    'pointer-events:none',
    'transform:translate(-50%,-50%)',
    'display:flex',
    'flex-direction:column',
    'align-items:center',
    'gap:4px',
    'user-select:none',
    'filter:drop-shadow(0 2px 4px rgba(0,0,0,0.9))',
  ].join(';');
  if (d.flag) {
    const img = document.createElement('img');
    img.src = d.flag;
    img.alt = '';
    img.style.cssText = [
      'width:42px',
      'height:auto',
      'max-height:28px',
      'object-fit:contain',
      'border:1px solid rgba(255,255,255,0.18)',
      'box-shadow:0 1px 3px rgba(0,0,0,0.6)',
      'display:block',
    ].join(';');
    img.onerror = () => { img.style.display = 'none'; };
    wrap.appendChild(img);
  }
  const label = document.createElement('div');
  label.style.cssText = [
    'font-family:Georgia,"Times New Roman",serif',
    'font-weight:700',
    'font-size:11px',
    'letter-spacing:0.24em',
    'color:rgba(255,255,255,0.94)',
    'text-shadow:0 1px 2px rgba(0,0,0,0.98),0 0 6px rgba(0,0,0,0.7)',
    'white-space:nowrap',
  ].join(';');
  label.textContent = d.text;
  wrap.appendChild(label);
  return wrap;
}
