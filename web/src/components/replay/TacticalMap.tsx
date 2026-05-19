import { useMemo } from 'react';
import type {
  Phase,
  Terrain,
  Unit,
  Movement,
  Annotation,
  Faction,
} from '../../types/replay';
import { factionColorFor, factionGlowFor } from '../../types/replay';

interface TacticalMapProps {
  phase: Phase;
  aspectRatio: number;
  aggressor?: Faction;
}

const VIEW_H = 100;

export default function TacticalMap({ phase, aspectRatio, aggressor }: TacticalMapProps) {
  const viewW = useMemo(() => Math.round(VIEW_H * aspectRatio), [aspectRatio]);

  // Camera transform: when the phase declares a focus rect, scale+translate
  // the contents group so the focus area fills the viewBox. SVG transitions
  // the transform attribute smoothly. Phases with no focus render full-field.
  const cameraTransform = useMemo(() => {
    const f = phase.focus;
    if (!f) return 'translate(0 0) scale(1)';
    const fx = (f.x / 100) * viewW;
    const fy = f.y;
    const fw = (f.w / 100) * viewW;
    const fh = f.h;
    if (fw <= 0 || fh <= 0) return 'translate(0 0) scale(1)';
    // Uniform scale to fit the focus rect inside the viewBox while preserving
    // proportions. Cap zoom so even tiny focus rects don't pixelate.
    const scale = Math.min(viewW / fw, VIEW_H / fh, 4);
    const tx = (viewW - fw * scale) / 2 - fx * scale;
    const ty = (VIEW_H - fh * scale) / 2 - fy * scale;
    return `translate(${tx} ${ty}) scale(${scale})`;
  }, [phase.focus, viewW]);

  return (
    <div className="w-full h-full relative" style={{ aspectRatio: `${aspectRatio} / 1` }}>
      <svg
        viewBox={`0 0 ${viewW} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="w-full h-full"
      >
        <defs>
          {/* Faint topographic-feel pattern: thin diagonal contour lines
              evoke a map without the graph-paper feel of a square grid. */}
          <pattern id="bg-topo" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <path d="M 0 7 L 14 7" fill="none" stroke="rgba(148,163,184,0.05)" strokeWidth="0.18" />
          </pattern>
          <radialGradient id="bg-glow" cx="50%" cy="50%" r="75%">
            <stop offset="0%" stopColor="#1d2740" stopOpacity="1" />
            <stop offset="55%" stopColor="#10162a" stopOpacity="1" />
            <stop offset="100%" stopColor="#070a14" stopOpacity="1" />
          </radialGradient>
          {/* Subtle vignette for cinematic edge falloff. */}
          <radialGradient id="bg-vignette" cx="50%" cy="50%" r="80%">
            <stop offset="60%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.5)" />
          </radialGradient>
          {(['a', 'b', 'c'] as Faction[]).map((f) => (
            <marker
              key={f}
              id={`arrow-${f}`}
              viewBox="0 0 14 14"
              refX="11"
              refY="7"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 14 7 L 0 14 L 4 7 z" fill={factionColorFor(f, aggressor)} />
            </marker>
          ))}
        </defs>

        <rect x="0" y="0" width={viewW} height={VIEW_H} fill="url(#bg-glow)" />
        <rect x="0" y="0" width={viewW} height={VIEW_H} fill="url(#bg-topo)" />
        <rect x="0" y="0" width={viewW} height={VIEW_H} fill="url(#bg-vignette)" pointerEvents="none" />

        <g
          transform={cameraTransform}
          style={{ transition: 'transform 1.2s cubic-bezier(0.4, 0, 0.2, 1)' }}
        >
          {(phase.terrain ?? []).map((t, i) => (
            <TerrainShape key={`terrain-${i}`} terrain={t} viewW={viewW} />
          ))}

          {(phase.movements ?? []).map((m, i, all) => (
            <MovementArrow key={`mv-${i}-${phase.index}`} movement={m} viewW={viewW} index={i} total={all.length} aggressor={aggressor} />
          ))}

          {phase.units.map((u) => (
            <UnitBlock key={`unit-${u.label}`} unit={u} viewW={viewW} aggressor={aggressor} />
          ))}

          {/* Engagement pulses: shockwave rings + bright cores fire at the
              destination of every charge / flank movement (to mark the point
              of impact) and at the centre of every destroyed unit (to mark
              the kill). Layered on top of units but below labels so the
              user sees the punch without losing the unit identity. */}
          {(phase.movements ?? [])
            .filter((m) => m.kind === 'charge' || m.kind === 'flank')
            .map((m, i, all) => (
              <ImpactPulse
                key={`impact-mv-${i}-${phase.index}`}
                x={scaleX(m.toX, viewW)}
                y={m.toY}
                color={factionColorFor(m.faction, aggressor)}
                delayMs={1200 + i * 250}
              />
            ))}
          {phase.units
            .filter((u) => u.status === 'destroyed')
            .map((u, i) => (
              <ImpactPulse
                key={`impact-u-${u.label}-${phase.index}`}
                x={scaleX(u.x, viewW)}
                y={u.y}
                color={factionColorFor(u.faction, aggressor)}
                delayMs={600 + i * 220}
                kill
              />
            ))}

          {(phase.annotations ?? []).map((a, i) => (
            <AnnotationText key={`ann-${i}`} annotation={a} viewW={viewW} />
          ))}
        </g>
      </svg>
    </div>
  );
}

function scaleX(x: number, viewW: number): number {
  return (x / 100) * viewW;
}

interface TerrainProps {
  terrain: Terrain;
  viewW: number;
}

function TerrainShape({ terrain, viewW }: TerrainProps) {
  const pts = terrain.points;
  const toScreen = (i: number): [number, number] => [scaleX(pts[i], viewW), pts[i + 1]];

  switch (terrain.kind) {
    case 'river': {
      const points: string[] = [];
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = toScreen(i);
        points.push(`${x},${y}`);
      }
      return (
        <g>
          <polyline
            points={points.join(' ')}
            fill="none"
            stroke="#3b82f6"
            strokeOpacity="0.45"
            strokeWidth="4"
            strokeLinecap="round"
          />
          <polyline
            points={points.join(' ')}
            fill="none"
            stroke="#60a5fa"
            strokeOpacity="0.7"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
          {terrain.label && (
            <text
              x={scaleX(pts[0] + 2, viewW)}
              y={pts[1] - 1.5}
              fill="#60a5fa"
              fontSize="2.2"
              fontStyle="italic"
              opacity="0.65"
            >
              {terrain.label}
            </text>
          )}
        </g>
      );
    }
    case 'coast': {
      const points: string[] = [];
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = toScreen(i);
        points.push(`${x},${y}`);
      }
      return (
        <g>
          <polyline
            points={points.join(' ')}
            fill="none"
            stroke="#0ea5e9"
            strokeOpacity="0.6"
            strokeWidth="3"
            strokeDasharray="0.5,1"
          />
          {terrain.label && (
            <text
              x={scaleX(pts[0] - 2, viewW)}
              y={pts[1] + 4}
              fill="#7dd3fc"
              fontSize="2"
              fontStyle="italic"
              opacity="0.7"
            >
              {terrain.label}
            </text>
          )}
        </g>
      );
    }
    case 'hill':
    case 'ridge': {
      // points = [x1,y1, x2,y2] = top-left and bottom-right
      const x1 = scaleX(pts[0], viewW);
      const y1 = pts[1];
      const x2 = scaleX(pts[2], viewW);
      const y2 = pts[3];
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      return (
        <g>
          <ellipse
            cx={cx}
            cy={cy}
            rx={(x2 - x1) / 2}
            ry={(y2 - y1) / 2}
            fill="#78350f"
            fillOpacity="0.18"
            stroke="#92400e"
            strokeOpacity="0.4"
            strokeWidth="0.4"
            strokeDasharray={terrain.kind === 'ridge' ? '1,1' : undefined}
          />
          {terrain.label && (
            <text
              x={cx}
              y={cy}
              fill="#fbbf24"
              fontSize="2.2"
              fontStyle="italic"
              opacity="0.6"
              textAnchor="middle"
            >
              {terrain.label}
            </text>
          )}
        </g>
      );
    }
    case 'wood': {
      const x1 = scaleX(pts[0], viewW);
      const y1 = pts[1];
      const x2 = scaleX(pts[2], viewW);
      const y2 = pts[3];
      const dots: React.ReactNode[] = [];
      const stepX = (x2 - x1) / 6;
      const stepY = (y2 - y1) / 8;
      for (let i = 0; i < 6; i++) {
        for (let j = 0; j < 8; j++) {
          dots.push(
            <circle
              key={`${i}-${j}`}
              cx={x1 + stepX * (i + 0.3 + (j % 2) * 0.3)}
              cy={y1 + stepY * (j + 0.5)}
              r="0.6"
              fill="#166534"
              fillOpacity="0.45"
            />
          );
        }
      }
      return (
        <g>
          <rect
            x={x1}
            y={y1}
            width={x2 - x1}
            height={y2 - y1}
            fill="#166534"
            fillOpacity="0.12"
          />
          {dots}
          {terrain.label && (
            <text
              x={(x1 + x2) / 2}
              y={y1 + (y2 - y1) / 2}
              fill="#22c55e"
              fontSize="1.8"
              fontStyle="italic"
              opacity="0.55"
              textAnchor="middle"
            >
              {terrain.label}
            </text>
          )}
        </g>
      );
    }
    case 'town': {
      const x1 = scaleX(pts[0], viewW);
      const y1 = pts[1];
      const x2 = scaleX(pts[2], viewW);
      const y2 = pts[3];
      return (
        <g>
          <rect
            x={x1}
            y={y1}
            width={x2 - x1}
            height={y2 - y1}
            fill="#475569"
            fillOpacity="0.3"
            stroke="#94a3b8"
            strokeOpacity="0.4"
            strokeWidth="0.3"
          />
          <rect
            x={x1 + (x2 - x1) * 0.15}
            y={y1 + (y2 - y1) * 0.2}
            width={(x2 - x1) * 0.2}
            height={(y2 - y1) * 0.3}
            fill="#64748b"
            fillOpacity="0.5"
          />
          <rect
            x={x1 + (x2 - x1) * 0.55}
            y={y1 + (y2 - y1) * 0.5}
            width={(x2 - x1) * 0.25}
            height={(y2 - y1) * 0.25}
            fill="#64748b"
            fillOpacity="0.5"
          />
          {terrain.label && (
            <text
              x={(x1 + x2) / 2}
              y={y1 - 0.8}
              fill="#cbd5e1"
              fontSize="2"
              opacity="0.7"
              textAnchor="middle"
            >
              {terrain.label}
            </text>
          )}
        </g>
      );
    }
    case 'fort': {
      const x1 = scaleX(pts[0], viewW);
      const y1 = pts[1];
      const x2 = scaleX(pts[2], viewW);
      const y2 = pts[3];
      // Crenellated top
      const battlements: React.ReactNode[] = [];
      const segs = 4;
      const segW = (x2 - x1) / (segs * 2);
      for (let i = 0; i < segs; i++) {
        battlements.push(
          <rect
            key={i}
            x={x1 + i * 2 * segW}
            y={y1 - 0.8}
            width={segW}
            height={0.8}
            fill="#a8a29e"
            fillOpacity="0.7"
          />
        );
      }
      return (
        <g>
          <rect
            x={x1}
            y={y1}
            width={x2 - x1}
            height={y2 - y1}
            fill="#78716c"
            fillOpacity="0.4"
            stroke="#a8a29e"
            strokeOpacity="0.7"
            strokeWidth="0.3"
          />
          {battlements}
          {terrain.label && (
            <text
              x={(x1 + x2) / 2}
              y={y2 + 1.8}
              fill="#d6d3d1"
              fontSize="1.6"
              opacity="0.75"
              textAnchor="middle"
            >
              {terrain.label}
            </text>
          )}
        </g>
      );
    }
    case 'marsh': {
      const x1 = scaleX(pts[0], viewW);
      const y1 = pts[1];
      const x2 = scaleX(pts[2], viewW);
      const y2 = pts[3];
      return (
        <g>
          <rect
            x={x1}
            y={y1}
            width={x2 - x1}
            height={y2 - y1}
            fill="#0ea5e9"
            fillOpacity="0.12"
          />
          {[...Array(5)].map((_, i) => (
            <path
              key={i}
              d={`M ${x1 + (x2 - x1) * (0.1 + 0.2 * i)} ${y1 + (y2 - y1) * 0.5}
                  q 0.6 -0.5 1.2 0 q 0.6 0.5 1.2 0`}
              fill="none"
              stroke="#38bdf8"
              strokeOpacity="0.5"
              strokeWidth="0.3"
            />
          ))}
          {terrain.label && (
            <text
              x={(x1 + x2) / 2}
              y={(y1 + y2) / 2}
              fill="#7dd3fc"
              fontSize="1.6"
              fontStyle="italic"
              opacity="0.7"
              textAnchor="middle"
            >
              {terrain.label}
            </text>
          )}
        </g>
      );
    }
    case 'road': {
      const points: string[] = [];
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = toScreen(i);
        points.push(`${x},${y}`);
      }
      return (
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="#a8a29e"
          strokeOpacity="0.5"
          strokeWidth="0.4"
          strokeDasharray="1,1"
        />
      );
    }
    default:
      return null;
  }
}

interface UnitProps {
  unit: Unit;
  viewW: number;
  aggressor?: Faction;
}

function UnitBlock({ unit, viewW, aggressor }: UnitProps) {
  const color = factionColorFor(unit.faction, aggressor);
  const glow = factionGlowFor(unit.faction, aggressor);
  const x = scaleX(unit.x, viewW);
  const y = unit.y;
  const w = scaleX(unit.w ?? 8, viewW) - scaleX(0, viewW);
  const h = unit.h ?? 6;
  const dim = unit.status && ['broken', 'routed', 'destroyed'].includes(unit.status);
  const dashed = unit.status === 'concealed';
  const opacity = dim ? 0.35 : unit.status === 'destroyed' ? 0.18 : 1;
  const unitType = unit.unitType ?? 'infantry';

  // All inner shapes are positioned relative to the unit center (0,0). An
  // outer <g> applies translate(x, y) and CSS-transitions the transform so a
  // unit re-rendered at a new position in the next phase slides smoothly.
  const cx = 0;
  const cy = 0;
  const rx = w / 2;
  const ry = h / 2;
  const left = cx - rx;
  const top = cy - ry;

  // Plate: the unit's bounding container. NATO map symbols use a hollow
  // rectangle frame; we fill it lightly with the faction color so the team
  // identity is unmistakable, then layer the type glyph on top.
  const plate = (
    <rect
      x={left}
      y={top}
      width={w}
      height={h}
      rx={Math.min(1.2, h * 0.18)}
      fill={color}
      fillOpacity={dim ? 0.12 : 0.28}
      stroke={color}
      strokeWidth={dashed ? 0.55 : 0.85}
      strokeDasharray={dashed ? '0.8,0.8' : undefined}
    />
  );

  // Glyph: a single bold mark inside the plate that identifies the unit type.
  // Modeled on the NATO 2525 friendly-forces convention so anyone who has
  // seen a military map recognizes the shape at a glance.
  const inset = Math.min(rx, ry) * 0.55;
  let glyph: React.ReactNode = null;
  if (unitType === 'infantry') {
    // Diagonal cross. The infantry "X".
    glyph = (
      <g stroke={color} strokeWidth="0.7" strokeLinecap="round" opacity={dim ? 0.45 : 0.95}>
        <line x1={-inset} y1={-inset * 0.7} x2={inset} y2={inset * 0.7} />
        <line x1={-inset} y1={inset * 0.7} x2={inset} y2={-inset * 0.7} />
      </g>
    );
  } else if (unitType === 'cavalry') {
    // Single thick diagonal slash, NATO convention for cavalry / recon.
    glyph = (
      <g stroke={color} strokeWidth="0.9" strokeLinecap="round" opacity={dim ? 0.45 : 0.95}>
        <line x1={-inset} y1={inset * 0.75} x2={inset} y2={-inset * 0.75} />
      </g>
    );
  } else if (unitType === 'armor') {
    // Filled oval. Armored / mechanized.
    glyph = (
      <ellipse cx={0} cy={0} rx={inset * 1.15} ry={inset * 0.6} fill={color} fillOpacity={dim ? 0.55 : 0.9} />
    );
  } else if (unitType === 'artillery') {
    // Filled circle. Artillery battery.
    glyph = <circle cx={0} cy={0} r={Math.min(inset * 0.7, 0.9)} fill={color} fillOpacity={dim ? 0.55 : 0.95} />;
  } else if (unitType === 'archers') {
    // Two thin chevrons fanning up. Archery / missile fire.
    glyph = (
      <g stroke={color} strokeWidth="0.55" fill="none" strokeLinecap="round" opacity={dim ? 0.45 : 0.95}>
        <path d={`M ${-inset} ${inset * 0.6} L 0 ${-inset * 0.7} L ${inset} ${inset * 0.6}`} />
        <path d={`M ${-inset * 0.55} ${inset * 0.85} L 0 ${0} L ${inset * 0.55} ${inset * 0.85}`} />
      </g>
    );
  } else if (unitType === 'aircraft') {
    // Triangle pointing up. Aircraft / aerial.
    glyph = (
      <polygon
        points={`${0},${-inset * 1.0} ${inset * 0.95},${inset * 0.7} ${-inset * 0.95},${inset * 0.7}`}
        fill={color}
        fillOpacity={dim ? 0.5 : 0.9}
      />
    );
  } else if (unitType === 'ships') {
    // Stylized hull silhouette.
    glyph = (
      <path
        d={`M ${-inset * 1.0} ${inset * 0.2} Q 0 ${inset * 0.95} ${inset * 1.0} ${inset * 0.2} L ${inset * 0.7} ${-inset * 0.3} L ${-inset * 0.7} ${-inset * 0.3} Z`}
        fill={color}
        fillOpacity={dim ? 0.55 : 0.9}
      />
    );
  } else if (unitType === 'command') {
    // Pennant on a staff. Headquarters / command.
    glyph = (
      <g stroke={color} strokeWidth="0.6" fill="none" opacity={dim ? 0.5 : 0.95}>
        <line x1={-inset * 0.5} y1={inset * 0.7} x2={-inset * 0.5} y2={-inset * 1.0} />
        <polygon
          points={`${-inset * 0.5},${-inset * 1.0} ${inset * 0.8},${-inset * 0.6} ${-inset * 0.5},${-inset * 0.25}`}
          fill={color}
          fillOpacity={dim ? 0.55 : 0.95}
          strokeWidth="0"
        />
      </g>
    );
  }

  // Strength bars on the plate's top edge: each bar is one "X" segment in
  // NATO convention (battalion / regiment / brigade / division indicators).
  const strengthMarks = (() => {
    const n = Math.max(0, Math.min(unit.strength ?? 0, 5));
    if (n === 0) return null;
    const totalWidth = Math.min(w * 0.6, n * 1.2);
    const gap = totalWidth / Math.max(n, 1);
    const startX = -totalWidth / 2 + gap / 2;
    return (
      <g stroke={color} strokeWidth="0.5" opacity={dim ? 0.45 : 0.9}>
        {Array.from({ length: n }).map((_, i) => (
          <line
            key={i}
            x1={startX + i * gap}
            y1={top - 1.4}
            x2={startX + i * gap}
            y2={top - 0.2}
          />
        ))}
      </g>
    );
  })();

  const body = (
    <g opacity={opacity}>
      {plate}
      {glyph}
      {strengthMarks}
    </g>
  );

  // Status overlays
  let statusOverlay: React.ReactNode = null;
  if (unit.status === 'encircled') {
    statusOverlay = (
      <rect
        x={left - 1}
        y={top - 1}
        width={w + 2}
        height={h + 2}
        fill="none"
        stroke={color}
        strokeWidth="0.4"
        strokeDasharray="0.4,0.8"
        opacity="0.7"
      />
    );
  } else if (unit.status === 'pressed' || unit.status === 'pressing') {
    statusOverlay = (
      <rect
        x={left}
        y={top}
        width={w}
        height={h}
        fill="none"
        stroke="#fbbf24"
        strokeOpacity="0.8"
        strokeWidth="0.5"
      />
    );
  } else if (unit.status === 'broken' || unit.status === 'routed') {
    statusOverlay = (
      <line
        x1={left}
        y1={top}
        x2={left + w}
        y2={top + h}
        stroke="#7f1d1d"
        strokeWidth="0.5"
        opacity="0.6"
      />
    );
  } else if (unit.status === 'squares') {
    statusOverlay = (
      <g>
        {[0.2, 0.5, 0.8].map((fx) =>
          [0.5].map((fy) => (
            <rect
              key={`${fx}-${fy}`}
              x={left + w * fx - 0.5}
              y={top + h * fy - 0.5}
              width="1"
              height="1"
              fill="none"
              stroke={color}
              strokeWidth="0.2"
              opacity="0.9"
            />
          ))
        )}
      </g>
    );
  }

  return (
    <g
      transform={`translate(${x} ${y})`}
      style={{
        filter: dim ? undefined : `drop-shadow(0 0 1.2px ${glow})`,
        transition: 'transform 0.9s cubic-bezier(0.4, 0, 0.2, 1)',
      }}
      opacity={opacity}
    >
      {body}
      {statusOverlay}
      <text
        x={cx}
        y={top + h + 2}
        fontSize="1.6"
        textAnchor="middle"
        fill="#e2e8f0"
        opacity="0.85"
        style={{ paintOrder: 'stroke', stroke: 'rgba(10,13,24,0.85)', strokeWidth: 0.8 }}
      >
        {unit.label}
      </text>
    </g>
  );
}

interface MovementProps {
  movement: Movement;
  viewW: number;
  // index is the position of this movement within the phase's movements[]
  // list; used to stagger the dash-in animation so the eye reads the arrows
  // in narration order.
  index: number;
  // total is the number of movements in the phase, used to scale per-arrow
  // delay so the full choreography always finishes before the next phase.
  total: number;
  aggressor?: Faction;
}

function MovementArrow({ movement, viewW, index, total, aggressor }: MovementProps) {
  const color = factionColorFor(movement.faction, aggressor);
  const x1 = scaleX(movement.fromX, viewW);
  const y1 = movement.fromY;
  const x2 = scaleX(movement.toX, viewW);
  const y2 = movement.toY;
  const kind = movement.kind ?? 'advance';
  // Stagger: pace arrows ~600ms apart but cap so a phase with many movements
  // still completes inside its 6-7s window.
  const stagger = total <= 1 ? 0 : Math.min(0.6, 4 / Math.max(total, 1)) * index;

  // Curve depth tuned per movement kind for visual drama. Flank arrows bend
  // hard; charges drive nearly straight; retreats and routs curve outward
  // to feel like flight.
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const offsetMag =
    kind === 'flank' ? 14 :
    kind === 'rout' ? -8 :
    kind === 'retreat' || kind === 'withdrawal' ? -5 :
    kind === 'charge' ? 4 :
    6;
  const cx = (x1 + x2) / 2 - (dy / len) * offsetMag;
  const cy = (y1 + y2) / 2 + (dx / len) * offsetMag;
  const path = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;

  // Style by kind: solid sweeping arc by default, dashed for retreats and
  // routs, thicker for charge/flank. Far heavier than the old 1.2-unit
  // pencil stroke. These should read at a glance as army movement, not
  // a graph plot.
  let dash: string | undefined;
  let strokeWidth = 2.4;
  let opacity = 0.92;
  if (kind === 'retreat' || kind === 'withdrawal') {
    dash = '3,1.5';
    strokeWidth = 2.2;
    opacity = 0.85;
  } else if (kind === 'rout') {
    dash = '1.2,1.2';
    strokeWidth = 1.8;
    opacity = 0.75;
  } else if (kind === 'charge') {
    strokeWidth = 3.2;
  } else if (kind === 'flank') {
    strokeWidth = 2.8;
  }

  // Each arrow gets its own gradient + flow-id so colors blend along the
  // path direction and the dashed flow animation is unique per arrow.
  const gradId = `arrow-grad-${movement.faction}-${index}`;
  const flowId = `arrow-flow-${movement.faction}-${index}`;

  return (
    <g className="movement-arrow" style={{ opacity: 0, animation: `arrow-fade-in 0.35s ease-out ${stagger}s forwards` }}>
      <defs>
        <linearGradient id={gradId} x1={x1} y1={y1} x2={x2} y2={y2} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="55%" stopColor={color} stopOpacity="0.85" />
          <stop offset="100%" stopColor={color} stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Soft glow under the stroke for atmospheric depth. */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth + 1.6}
        strokeLinecap="round"
        opacity={0.18}
        style={{
          strokeDasharray: dash ?? '180',
          strokeDashoffset: 180,
          animation: `dash-in 1.6s ease-out ${stagger}s forwards`,
        }}
      />

      {/* Primary stroke draws in along the path. */}
      <path
        id={flowId}
        d={path}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={dash}
        markerEnd={`url(#arrow-${movement.faction})`}
        opacity={opacity}
        style={{
          strokeDasharray: dash ?? '180',
          strokeDashoffset: 180,
          animation: `dash-in 1.4s ease-out ${stagger}s forwards`,
        }}
      />

      {/* Flowing march dashes: an overlay stroke that runs continuously
          along the path after the trace lands, giving the arrow a sense
          of ongoing motion rather than a frozen line. The dash period is
          short and the cycle is loose enough to read as flow, not strobe.
          Skipped for retreat / rout kinds since those should look broken,
          not aggressive. */}
      {kind !== 'retreat' && kind !== 'withdrawal' && kind !== 'rout' && (
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={Math.max(1.0, strokeWidth * 0.55)}
          strokeLinecap="round"
          strokeDasharray="2.2 5"
          opacity={0}
          style={{
            animation: `arrow-march-in 600ms ease-out ${stagger + 1.4}s forwards, arrow-march-flow 2.2s linear ${stagger + 1.4}s infinite`,
            mixBlendMode: 'screen',
          }}
        />
      )}

      {/* Arrowhead glow pulse at the destination, fires once the trace
          lands. Reads as the column hitting the line. Skipped for routs
          and retreats. */}
      {kind !== 'retreat' && kind !== 'withdrawal' && kind !== 'rout' && (
        <circle
          cx={x2}
          cy={y2}
          r={1.6}
          fill={color}
          opacity={0}
          style={{
            transformBox: 'fill-box',
            transformOrigin: 'center',
            animation: `arrowhead-pulse 1100ms ${stagger + 1.45}s cubic-bezier(.25,.7,.25,1) forwards`,
            filter: `drop-shadow(0 0 1.4px ${color})`,
          }}
        />
      )}

      {movement.label && (
        <text
          x={cx}
          y={cy - 1.8}
          fontSize="1.6"
          fontWeight="600"
          textAnchor="middle"
          fill={color}
          opacity="0.95"
          style={{
            paintOrder: 'stroke',
            stroke: 'rgba(8,11,20,0.92)',
            strokeWidth: 1.1,
            letterSpacing: '0.04em',
          }}
        >
          {movement.label}
        </text>
      )}
    </g>
  );
}

interface AnnotationProps {
  annotation: Annotation;
  viewW: number;
}

function AnnotationText({ annotation, viewW }: AnnotationProps) {
  return (
    <text
      x={scaleX(annotation.x, viewW)}
      y={annotation.y}
      fontSize="1.8"
      textAnchor="middle"
      fill="#fbbf24"
      fontStyle="italic"
      opacity="0.9"
      style={{ paintOrder: 'stroke', stroke: 'rgba(10,13,24,0.85)', strokeWidth: 0.9 }}
    >
      {annotation.text}
    </text>
  );
}

interface ImpactPulseProps {
  x: number;
  y: number;
  color: string;
  delayMs: number;
  // kill marks the destruction of an existing unit rather than a charge
  // landing. The pulse runs a touch longer and adds an extra ring so the
  // "kill" reads as a more decisive event than a contact.
  kill?: boolean;
}

// ImpactPulse renders an animated shockwave + bright core + debris sparks
// at a point in the playfield. Used at charge / flank arrow endpoints and
// at destroyed unit positions. The visual vocabulary is intentionally the
// same as the globe-replay impact pulses so the user reads "engagement
// happened here" consistently across the 2D tactical map and the 3D
// globe.
function ImpactPulse({ x, y, color, delayMs, kill = false }: ImpactPulseProps) {
  // Spark vectors, normalised to a tactical-map unit radius (~3 units).
  // Eight outgoing motes scattered around a circle, jittered so they do
  // not look like a perfect star.
  const sparks = [
    { dx: 6.0, dy: 0 }, { dx: 4.2, dy: 4.2 },
    { dx: 0, dy: 6.0 }, { dx: -4.2, dy: 4.2 },
    { dx: -6.0, dy: 0 }, { dx: -4.2, dy: -4.2 },
    { dx: 0, dy: -6.0 }, { dx: 4.2, dy: -4.2 },
  ];
  return (
    <g style={{ pointerEvents: 'none' }}>
      {/* Outward shockwave ring. */}
      <circle
        cx={x} cy={y} r={1.4}
        fill="none"
        stroke={color}
        strokeWidth={0.6}
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `impact-ring 1400ms ${delayMs}ms cubic-bezier(.2,.6,.25,1) forwards`,
        }}
      />
      {/* Wider, slower second ring for kills only — reads as "this was a
          real kill, not a glancing blow". */}
      {kill && (
        <circle
          cx={x} cy={y} r={1.6}
          fill="none"
          stroke={color}
          strokeWidth={0.45}
          style={{
            opacity: 0,
            transformBox: 'fill-box',
            transformOrigin: 'center',
            animation: `impact-ring 1900ms ${delayMs + 220}ms cubic-bezier(.2,.6,.25,1) forwards`,
          }}
        />
      )}
      {/* Bright core dot. */}
      <circle
        cx={x} cy={y} r={1.0}
        fill={color}
        style={{
          opacity: 0,
          transformBox: 'fill-box',
          transformOrigin: 'center',
          animation: `impact-core 900ms ${delayMs}ms cubic-bezier(.25,.7,.25,1) forwards`,
          filter: `drop-shadow(0 0 1.2px ${color})`,
        }}
      />
      {/* Debris sparks: eight motes flung out from the center. */}
      {sparks.map((s, i) => (
        <circle
          key={`sp-${i}`}
          cx={x}
          cy={y}
          r={0.34}
          fill={color}
          style={{
            opacity: 0,
            ['--sx' as string]: `${s.dx}px`,
            ['--sy' as string]: `${s.dy}px`,
            animation: `impact-spark 950ms ${delayMs + 50 + i * 18}ms cubic-bezier(.25,.65,.25,1) forwards`,
          }}
        />
      ))}
    </g>
  );
}
