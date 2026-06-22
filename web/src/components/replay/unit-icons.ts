// unit-icons builds a deck.gl IconLayer sprite atlas for every UnitType
// in the replay schema. Each glyph is drawn once to canvas as a white
// silhouette over a faintly translucent plate, so the IconLayer can tint
// the whole stamp per faction via getColor (mask: true). One texture,
// many draws — far cheaper than per-data icon URLs.
//
// Symbol conventions follow simplified NATO APP-6 / MIL-STD-2525 lineage,
// modernised for readability at small zooms and on satellite backdrops:
//
//   infantry      rectangle with X
//   cavalry       rectangle with diagonal slash
//   armor         rectangle with horizontal oval
//   artillery     rectangle with filled dot
//   archers       rectangle with chevron
//   ships         hull silhouette
//   naval-fleet   triple hull
//   submarine     undersea silhouette
//   aircraft      triangle with fin
//   air-squadron  triple triangle
//   paratroop     parachute over figure
//   mechanized    rectangle with oval + slash
//   command       pennant flag
//   engineer      rectangle with E
//   recon         rectangle with zigzag
//   partisan      small rectangle with G
//   supply        rectangle with horizontal bar
//   medic         rectangle with cross
//
// Status overlays (destroyed / broken / routed / encircled) are drawn as
// a separate sprite per status and stamped from a parallel IconLayer so
// they read clearly without re-baking every unit icon.

import type { UnitType, UnitStatus } from '../../types/replay';

export const ICON_SIZE = 96;

export interface IconMappingEntry {
  x: number;
  y: number;
  width: number;
  height: number;
  anchorY: number;
  mask: true;
}

export type IconMapping = Record<string, IconMappingEntry>;

export interface IconAtlas {
  canvas: HTMLCanvasElement | null;
  mapping: IconMapping;
  size: number;
}

type Drawer = (ctx: CanvasRenderingContext2D) => void;

const PLATE_W = 64;
const PLATE_H = 44;
const STROKE = 5;

function ctxSetup(ctx: CanvasRenderingContext2D) {
  // Plate fill is the field color underneath the symbol. Bumped from
  // 0.18 to 0.55 so the icon reads on a satellite backdrop instead of
  // dissolving into bright terrain.
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function drawPlate(ctx: CanvasRenderingContext2D) {
  const x = (ICON_SIZE - PLATE_W) / 2;
  const y = (ICON_SIZE - PLATE_H) / 2;
  const r = 8;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + PLATE_W - r, y);
  ctx.quadraticCurveTo(x + PLATE_W, y, x + PLATE_W, y + r);
  ctx.lineTo(x + PLATE_W, y + PLATE_H - r);
  ctx.quadraticCurveTo(x + PLATE_W, y + PLATE_H, x + PLATE_W - r, y + PLATE_H);
  ctx.lineTo(x + r, y + PLATE_H);
  ctx.quadraticCurveTo(x, y + PLATE_H, x, y + PLATE_H - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

const cx = ICON_SIZE / 2;
const cy = ICON_SIZE / 2;
const innerL = cx - PLATE_W / 2 + 9;
const innerR = cx + PLATE_W / 2 - 9;
const innerT = cy - PLATE_H / 2 + 7;
const innerB = cy + PLATE_H / 2 - 7;

function drawInfantry(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  ctx.beginPath();
  ctx.moveTo(innerL, innerT); ctx.lineTo(innerR, innerB);
  ctx.moveTo(innerR, innerT); ctx.lineTo(innerL, innerB);
  ctx.stroke();
}

function drawCavalry(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  ctx.beginPath();
  ctx.moveTo(innerL, innerB); ctx.lineTo(innerR, innerT);
  ctx.stroke();
}

function drawArmor(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  const ovW = (innerR - innerL) * 0.7;
  const ovH = (innerB - innerT) * 0.55;
  ctx.beginPath();
  ctx.ellipse(cx, cy, ovW / 2, ovH / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

function drawArtillery(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  ctx.beginPath();
  ctx.arc(cx, cy, 6, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

function drawArchers(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  ctx.beginPath();
  ctx.moveTo(innerL, innerB - 2);
  ctx.lineTo(cx, innerT + 2);
  ctx.lineTo(innerR, innerB - 2);
  ctx.stroke();
}

function drawCommand(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  ctx.beginPath();
  ctx.moveTo(cx - 14, innerT + 2);
  ctx.lineTo(cx - 14, innerB - 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 14, innerT + 2);
  ctx.lineTo(cx + 16, innerT + 8);
  ctx.lineTo(cx - 14, innerT + 14);
  ctx.closePath();
  ctx.fillStyle = '#fff';
  ctx.fill();
}

function drawShips(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = STROKE;
  ctx.beginPath();
  ctx.moveTo(cx - 30, cy + 6);
  ctx.lineTo(cx - 22, cy + 16);
  ctx.lineTo(cx + 22, cy + 16);
  ctx.lineTo(cx + 30, cy + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx, cy + 4);
  ctx.lineTo(cx, cy - 18);
  ctx.moveTo(cx - 10, cy - 12);
  ctx.lineTo(cx + 10, cy - 12);
  ctx.stroke();
}

function drawNavalFleet(ctx: CanvasRenderingContext2D) {
  for (const dy of [-12, 0, 12]) {
    ctx.beginPath();
    ctx.moveTo(cx - 22, cy + 6 + dy);
    ctx.lineTo(cx - 16, cy + 12 + dy);
    ctx.lineTo(cx + 16, cy + 12 + dy);
    ctx.lineTo(cx + 22, cy + 6 + dy);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = STROKE * 0.6;
    ctx.stroke();
  }
}

function drawSubmarine(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = STROKE * 0.7;
  ctx.beginPath();
  for (let x = innerL; x <= innerR; x += 6) {
    if (x === innerL) ctx.moveTo(x, innerT + 6);
    else ctx.quadraticCurveTo(x - 3, innerT + 2, x, innerT + 6);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(cx, cy + 8, 26, 8, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = STROKE;
  ctx.stroke();
  ctx.beginPath();
  ctx.rect(cx - 4, cy - 2, 8, 10);
  ctx.fill();
  ctx.stroke();
}

function drawAircraft(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = STROKE;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 22);
  ctx.lineTo(cx + 22, cy + 16);
  ctx.lineTo(cx, cy + 6);
  ctx.lineTo(cx - 22, cy + 16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawAirSquadron(ctx: CanvasRenderingContext2D) {
  for (const dx of [-22, 0, 22]) {
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = STROKE * 0.6;
    ctx.beginPath();
    ctx.moveTo(cx + dx, cy - 14);
    ctx.lineTo(cx + dx + 12, cy + 12);
    ctx.lineTo(cx + dx, cy + 6);
    ctx.lineTo(cx + dx - 12, cy + 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawParatroop(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  ctx.beginPath();
  ctx.arc(cx, cy - 4, 14, Math.PI, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 14, cy - 4);
  ctx.lineTo(cx, cy + 12);
  ctx.lineTo(cx + 14, cy - 4);
  ctx.stroke();
}

function drawMechanized(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  const ovW = (innerR - innerL) * 0.65;
  const ovH = (innerB - innerT) * 0.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy, ovW / 2, ovH / 2, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = STROKE * 0.6;
  ctx.beginPath();
  ctx.moveTo(innerL, innerB);
  ctx.lineTo(innerR, innerT);
  ctx.stroke();
}

function drawEngineer(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  ctx.beginPath();
  ctx.moveTo(innerR - 4, innerT);
  ctx.lineTo(innerL + 4, innerT);
  ctx.lineTo(innerL + 4, innerB);
  ctx.lineTo(innerR - 4, innerB);
  ctx.moveTo(innerL + 4, cy);
  ctx.lineTo(innerR - 8, cy);
  ctx.stroke();
}

function drawRecon(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  ctx.beginPath();
  ctx.moveTo(innerL, innerB);
  ctx.lineTo(innerL + 12, innerT);
  ctx.lineTo(cx, innerB);
  ctx.lineTo(innerR - 12, innerT);
  ctx.lineTo(innerR, innerB);
  ctx.stroke();
}

function drawPartisan(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  ctx.font = 'bold 28px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText('G', cx, cy + 1);
}

function drawSupply(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  ctx.beginPath();
  ctx.moveTo(innerL + 2, cy);
  ctx.lineTo(innerR - 2, cy);
  ctx.stroke();
}

function drawMedic(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  ctx.beginPath();
  ctx.moveTo(cx, innerT + 2);
  ctx.lineTo(cx, innerB - 2);
  ctx.moveTo(innerL + 2, cy);
  ctx.lineTo(innerR - 2, cy);
  ctx.stroke();
}

function drawDefault(ctx: CanvasRenderingContext2D) {
  drawPlate(ctx);
  ctx.beginPath();
  ctx.arc(cx, cy, 7, 0, Math.PI * 2);
  ctx.fillStyle = '#fff';
  ctx.fill();
}

// drawArrowhead renders a solid chevron used for the directional cap at
// the end of every movement trip. The shape points UP (0 deg) so the
// renderer can rotate it by the trip's compass bearing. Has its own
// internal shadow ring for legibility on busy satellite backdrops.
function drawArrowhead(ctx: CanvasRenderingContext2D) {
  // Outer soft halo so the arrowhead glows on satellite imagery before
  // its own faction tint sets in.
  const grad = ctx.createRadialGradient(cx, cy, 4, cx, cy, 30);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.fill();
  // Solid chevron, point up. Wide stance + back notch so the silhouette
  // reads as a clear arrow at every size.
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 28);
  ctx.lineTo(cx + 24, cy + 18);
  ctx.lineTo(cx + 9, cy + 10);
  ctx.lineTo(cx, cy + 22);
  ctx.lineTo(cx - 9, cy + 10);
  ctx.lineTo(cx - 24, cy + 18);
  ctx.closePath();
  ctx.fill();
}

// drawMidChevron renders a smaller chevron that runs along the middle
// of a trip path, also rotatable. Less ornate than the destination
// arrowhead so it reads as "in motion" rather than "landed."
function drawMidChevron(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 14);
  ctx.lineTo(cx + 14, cy + 10);
  ctx.lineTo(cx, cy + 4);
  ctx.lineTo(cx - 14, cy + 10);
  ctx.closePath();
  ctx.fill();
}

const DRAWERS: Record<string, Drawer> = {
  infantry: drawInfantry,
  cavalry: drawCavalry,
  armor: drawArmor,
  artillery: drawArtillery,
  archers: drawArchers,
  command: drawCommand,
  ships: drawShips,
  'naval-fleet': drawNavalFleet,
  submarine: drawSubmarine,
  aircraft: drawAircraft,
  'air-squadron': drawAirSquadron,
  paratroop: drawParatroop,
  mechanized: drawMechanized,
  engineer: drawEngineer,
  recon: drawRecon,
  partisan: drawPartisan,
  supply: drawSupply,
  medic: drawMedic,
  fortification: drawDefault,
  default: drawDefault,
  // Movement-direction sprites. Sit in the same atlas so the IconLayer
  // can share a single texture across units AND arrowheads.
  arrowhead: drawArrowhead,
  'mid-chevron': drawMidChevron,
};

const STATUS_KEYS: UnitStatus[] = [
  'destroyed', 'broken', 'routed', 'encircled', 'pressing', 'pursuing', 'isolated',
];

function drawStatusDestroyed(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = STROKE * 1.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 28, cy - 18);
  ctx.lineTo(cx + 28, cy + 18);
  ctx.moveTo(cx + 28, cy - 18);
  ctx.lineTo(cx - 28, cy + 18);
  ctx.stroke();
}

function drawStatusBroken(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = STROKE * 0.9;
  ctx.setLineDash([6, 5]);
  drawPlate(ctx);
  ctx.setLineDash([]);
}

function drawStatusRouted(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = STROKE;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 22, cy + 18);
  ctx.quadraticCurveTo(cx, cy - 26, cx + 26, cy - 12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + 26, cy - 12);
  ctx.lineTo(cx + 16, cy - 18);
  ctx.moveTo(cx + 26, cy - 12);
  ctx.lineTo(cx + 18, cy - 4);
  ctx.stroke();
}

function drawStatusEncircled(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = STROKE * 0.9;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawStatusPressing(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = STROKE * 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - 24, cy);
  ctx.lineTo(cx + 22, cy);
  ctx.moveTo(cx + 22, cy);
  ctx.lineTo(cx + 12, cy - 8);
  ctx.moveTo(cx + 22, cy);
  ctx.lineTo(cx + 12, cy + 8);
  ctx.stroke();
}

function drawStatusPursuing(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = STROKE * 1.1;
  for (const dx of [-12, 0, 12]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx - 4, cy + 14);
    ctx.lineTo(cx + dx, cy - 4);
    ctx.lineTo(cx + dx + 4, cy + 14);
    ctx.stroke();
  }
}

function drawStatusIsolated(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = STROKE * 0.9;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  ctx.arc(cx, cy, 36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 30, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

const STATUS_DRAWERS: Partial<Record<UnitStatus, Drawer>> = {
  destroyed: drawStatusDestroyed,
  broken: drawStatusBroken,
  routed: drawStatusRouted,
  encircled: drawStatusEncircled,
  pressing: drawStatusPressing,
  pursuing: drawStatusPursuing,
  isolated: drawStatusIsolated,
};

let cachedUnitAtlas: IconAtlas | null = null;
let cachedStatusAtlas: IconAtlas | null = null;

function buildAtlas(drawers: Record<string, Drawer>, prefix: string): IconAtlas {
  if (typeof document === 'undefined') {
    return { canvas: null, mapping: {}, size: ICON_SIZE };
  }
  const keys = Object.keys(drawers);
  const cols = Math.min(8, keys.length);
  const rows = Math.ceil(keys.length / cols);
  const W = cols * ICON_SIZE;
  const H = rows * ICON_SIZE;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return { canvas: null, mapping: {}, size: ICON_SIZE };
  const mapping: IconMapping = {};
  keys.forEach((key, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * ICON_SIZE;
    const y = row * ICON_SIZE;
    ctx.save();
    ctx.translate(x, y);
    ctxSetup(ctx);
    drawers[key](ctx);
    ctx.restore();
    mapping[`${prefix}${key}`] = {
      x,
      y,
      width: ICON_SIZE,
      height: ICON_SIZE,
      anchorY: ICON_SIZE / 2,
      mask: true,
    };
  });
  return { canvas: c, mapping, size: ICON_SIZE };
}

// getUnitIconAtlas returns the unit-type symbol atlas. Lazy + memoized so
// the first replay open builds the canvas once and every subsequent
// render hits the cache.
export function getUnitIconAtlas(): IconAtlas {
  if (!cachedUnitAtlas) cachedUnitAtlas = buildAtlas(DRAWERS, '');
  return cachedUnitAtlas;
}

// getStatusOverlayAtlas returns the status overlay atlas. Each entry is a
// transparent canvas with only the status marking (slash for destroyed,
// dashed ring for encircled, etc.). Used as a parallel IconLayer stamped
// over the base unit icon.
export function getStatusOverlayAtlas(): IconAtlas {
  if (!cachedStatusAtlas) {
    const map: Record<string, Drawer> = {};
    for (const status of STATUS_KEYS) {
      const d = STATUS_DRAWERS[status];
      if (d) map[status] = d;
    }
    cachedStatusAtlas = buildAtlas(map, '');
  }
  return cachedStatusAtlas;
}

// iconNameFor maps a UnitType to the atlas key, falling back to 'default'
// when the type is unset or unknown.
export function iconNameFor(unitType: UnitType | undefined): string {
  if (!unitType) return 'default';
  return DRAWERS[unitType] ? unitType : 'default';
}

// hasStatusOverlay returns true when a status has a dedicated overlay
// glyph in the status atlas, so the caller can skip stamping for the
// statuses that only modulate opacity / size.
export function hasStatusOverlay(status: UnitStatus | undefined): boolean {
  if (!status) return false;
  return !!STATUS_DRAWERS[status];
}
