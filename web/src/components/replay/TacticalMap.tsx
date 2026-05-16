import { useMemo } from 'react';
import type {
  Phase,
  Terrain,
  Unit,
  Movement,
  Annotation,
  Faction,
} from '../../types/replay';
import { FACTION_COLOR, FACTION_GLOW } from '../../types/replay';

interface TacticalMapProps {
  phase: Phase;
  aspectRatio: number;
}

const VIEW_H = 100;

export default function TacticalMap({ phase, aspectRatio }: TacticalMapProps) {
  const viewW = useMemo(() => Math.round(VIEW_H * aspectRatio), [aspectRatio]);

  return (
    <div className="w-full h-full relative" style={{ aspectRatio: `${aspectRatio} / 1` }}>
      <svg
        viewBox={`0 0 ${viewW} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="w-full h-full"
      >
        <defs>
          <pattern id="bg-grid" width="6" height="6" patternUnits="userSpaceOnUse">
            <path d="M 6 0 L 0 0 0 6" fill="none" stroke="rgba(148,163,184,0.06)" strokeWidth="0.2" />
          </pattern>
          <radialGradient id="bg-glow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="#1a2235" stopOpacity="1" />
            <stop offset="100%" stopColor="#0a0d18" stopOpacity="1" />
          </radialGradient>
          {(['a', 'b', 'c'] as Faction[]).map((f) => (
            <marker
              key={f}
              id={`arrow-${f}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="4"
              markerHeight="4"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill={FACTION_COLOR[f]} />
            </marker>
          ))}
        </defs>

        <rect x="0" y="0" width={viewW} height={VIEW_H} fill="url(#bg-glow)" />
        <rect x="0" y="0" width={viewW} height={VIEW_H} fill="url(#bg-grid)" />

        {(phase.terrain ?? []).map((t, i) => (
          <TerrainShape key={`terrain-${i}`} terrain={t} viewW={viewW} />
        ))}

        {(phase.movements ?? []).map((m, i) => (
          <MovementArrow key={`mv-${i}-${phase.index}`} movement={m} viewW={viewW} />
        ))}

        {phase.units.map((u, i) => (
          <UnitBlock key={`unit-${i}-${phase.index}`} unit={u} viewW={viewW} />
        ))}

        {(phase.annotations ?? []).map((a, i) => (
          <AnnotationText key={`ann-${i}`} annotation={a} viewW={viewW} />
        ))}
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
}

function UnitBlock({ unit, viewW }: UnitProps) {
  const color = FACTION_COLOR[unit.faction];
  const glow = FACTION_GLOW[unit.faction];
  const x = scaleX(unit.x, viewW);
  const y = unit.y;
  const w = scaleX(unit.w ?? 8, viewW) - scaleX(0, viewW);
  const h = unit.h ?? 6;
  const dim = unit.status && ['broken', 'routed', 'destroyed'].includes(unit.status);
  const dashed = unit.status === 'concealed';
  const opacity = dim ? 0.35 : unit.status === 'destroyed' ? 0.18 : 1;
  const unitType = unit.unitType ?? 'infantry';

  const cx = x;
  const cy = y;
  const rx = w / 2;
  const ry = h / 2;
  const left = cx - rx;
  const top = cy - ry;

  let body: React.ReactNode = (
    <rect
      x={left}
      y={top}
      width={w}
      height={h}
      fill={color}
      fillOpacity={dim ? 0.2 : 0.55}
      stroke={color}
      strokeWidth={dashed ? 0.4 : 0.6}
      strokeDasharray={dashed ? '0.8,0.8' : undefined}
    />
  );

  if (unitType === 'cavalry') {
    // Chevrons on top
    body = (
      <g opacity={opacity}>
        <rect
          x={left}
          y={top}
          width={w}
          height={h}
          fill={color}
          fillOpacity={dim ? 0.2 : 0.55}
          stroke={color}
          strokeWidth="0.5"
        />
        <path
          d={`M ${left + 0.5} ${top + 0.4} L ${cx} ${top - 1.2} L ${left + w - 0.5} ${top + 0.4}`}
          fill="none"
          stroke={color}
          strokeWidth="0.5"
        />
      </g>
    );
  } else if (unitType === 'archers') {
    body = (
      <g opacity={opacity}>
        <rect
          x={left}
          y={top}
          width={w}
          height={h}
          fill={color}
          fillOpacity={dim ? 0.2 : 0.5}
          stroke={color}
          strokeWidth="0.5"
        />
        <path
          d={`M ${cx} ${top - 0.4} L ${cx} ${top - 2.2} M ${cx - 0.8} ${top - 0.4} L ${cx + 0.8} ${top - 0.4}`}
          stroke={color}
          strokeWidth="0.4"
          fill="none"
        />
      </g>
    );
  } else if (unitType === 'artillery') {
    body = (
      <g opacity={opacity}>
        <rect
          x={left}
          y={top}
          width={w}
          height={h}
          fill={color}
          fillOpacity={dim ? 0.18 : 0.45}
          stroke={color}
          strokeWidth="0.5"
        />
        {[0.25, 0.5, 0.75].map((f) => (
          <circle key={f} cx={left + w * f} cy={cy} r="0.5" fill={color} fillOpacity="0.9" />
        ))}
      </g>
    );
  } else if (unitType === 'ships') {
    // pointed hexagon
    body = (
      <polygon
        points={`${left + 1.5},${top} ${left + w - 1.5},${top} ${left + w},${cy} ${left + w - 1.5},${top + h} ${left + 1.5},${top + h} ${left},${cy}`}
        fill={color}
        fillOpacity={dim ? 0.2 : 0.55}
        stroke={color}
        strokeWidth="0.5"
        opacity={opacity}
      />
    );
  } else if (unitType === 'command') {
    body = (
      <g opacity={opacity}>
        <rect
          x={left}
          y={top}
          width={w}
          height={h}
          fill={color}
          fillOpacity={dim ? 0.18 : 0.55}
          stroke={color}
          strokeWidth="0.7"
        />
        <polygon
          points={`${cx - 1.2},${top - 1.8} ${cx + 1.2},${top - 0.6} ${cx - 1.2},${top - 0.2}`}
          fill={color}
          opacity="0.9"
        />
      </g>
    );
  } else if (unitType === 'aircraft') {
    body = (
      <g opacity={opacity}>
        <polygon
          points={`${cx},${top} ${left + w},${top + h} ${cx},${top + h * 0.7} ${left},${top + h}`}
          fill={color}
          fillOpacity={dim ? 0.2 : 0.55}
          stroke={color}
          strokeWidth="0.5"
        />
      </g>
    );
  } else if (unitType === 'armor') {
    body = (
      <g opacity={opacity}>
        <rect
          x={left - 0.5}
          y={top - 0.5}
          width={w + 1}
          height={h + 1}
          fill="none"
          stroke={color}
          strokeOpacity="0.5"
          strokeWidth="0.3"
        />
        <rect
          x={left}
          y={top}
          width={w}
          height={h}
          fill={color}
          fillOpacity={dim ? 0.22 : 0.6}
          stroke={color}
          strokeWidth="0.7"
        />
      </g>
    );
  }

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
    <g style={{ filter: dim ? undefined : `drop-shadow(0 0 1.2px ${glow})` }} opacity={opacity}>
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
}

function MovementArrow({ movement, viewW }: MovementProps) {
  const color = FACTION_COLOR[movement.faction];
  const x1 = scaleX(movement.fromX, viewW);
  const y1 = movement.fromY;
  const x2 = scaleX(movement.toX, viewW);
  const y2 = movement.toY;
  const kind = movement.kind ?? 'advance';

  // Compute curved control point (perpendicular offset) for flank/rout
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;
  const offset = kind === 'flank' ? 8 : kind === 'rout' ? -4 : 2;
  const cx = (x1 + x2) / 2 - (dy / len) * offset;
  const cy = (y1 + y2) / 2 + (dx / len) * offset;
  const path = `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`;

  let dash: string | undefined;
  let strokeWidth = 1.2;
  let opacity = 0.95;
  if (kind === 'retreat' || kind === 'withdrawal') {
    dash = '2,1';
    strokeWidth = 1;
  } else if (kind === 'rout') {
    dash = '0.6,0.6';
    strokeWidth = 0.9;
    opacity = 0.7;
  } else if (kind === 'charge') {
    strokeWidth = 1.6;
  } else if (kind === 'flank') {
    strokeWidth = 1.4;
  }

  return (
    <g className="movement-arrow">
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={dash}
        markerEnd={`url(#arrow-${movement.faction})`}
        opacity={opacity}
        style={{
          strokeDasharray: dash ?? '120',
          strokeDashoffset: 120,
          animation: `dash-in 1.4s ease-out forwards`,
        }}
      />
      {movement.label && (
        <text
          x={cx}
          y={cy - 1.2}
          fontSize="1.4"
          textAnchor="middle"
          fill={color}
          opacity="0.9"
          style={{ paintOrder: 'stroke', stroke: 'rgba(10,13,24,0.85)', strokeWidth: 0.8 }}
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
