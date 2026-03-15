import { useState, useEffect } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

interface SpaghettimeterProps {
  score: number;
  wires: number;
  plugins: number;
  clusters: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_SCORE = 500;
const CX = 100;
const CY = 100;
const RADIUS = 80;
const ARC_WIDTH = 16;

const ZONES = [
  { label: "Al dente",    color: "#22c55e", from: 0,    to: 0.25 },
  { label: "Tangled",     color: "#eab308", from: 0.25, to: 0.5  },
  { label: "Spaghetti!",  color: "#f97316", from: 0.5,  to: 0.75 },
  { label: "Mamma mia!",  color: "#ef4444", from: 0.75, to: 1    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function polarToXY(angleDeg: number) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: CX + RADIUS * Math.cos(rad), y: CY - RADIUS * Math.sin(rad) };
}

function arcPath(startDeg: number, endDeg: number) {
  const s = polarToXY(startDeg);
  const e = polarToXY(endDeg);
  const largeArc = Math.abs(startDeg - endDeg) > 180 ? 1 : 0;
  // Sweep flag 1 = clockwise in SVG coords (angles decrease left-to-right on screen)
  return `M ${s.x} ${s.y} A ${RADIUS} ${RADIUS} 0 ${largeArc} 1 ${e.x} ${e.y}`;
}

function getZone(normalized: number) {
  for (const z of ZONES) {
    if (normalized <= z.to) return z;
  }
  return ZONES[ZONES.length - 1];
}

// ─── Component ───────────────────────────────────────────────────────────────

export function Spaghettimeter({ score, wires, plugins, clusters }: SpaghettimeterProps) {
  const normalized = Math.min(Math.sqrt(score / MAX_SCORE), 1);
  const zone = getZone(normalized);

  // Animate needle from 0 on mount
  const [animVal, setAnimVal] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setAnimVal(normalized), 60);
    return () => clearTimeout(t);
  }, [normalized]);

  // Needle angle: 180° (left, score=0) → 0° (right, score=max)
  const needleAngle = 180 - animVal * 180;
  const needleRad = (needleAngle * Math.PI) / 180;
  const needleLen = RADIUS - 10;
  const nx = CX + needleLen * Math.cos(needleRad);
  const ny = CY - needleLen * Math.sin(needleRad);

  return (
    <div className="flex flex-col items-center">
      {/* Title */}
      <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 mb-6 tracking-wide uppercase">
        Spaghettimeter
      </h3>

      {/* Gauge SVG */}
      <svg viewBox="-30 -25 260 185" className="w-60 h-auto select-none">
        {/* Arc zone segments */}
        {ZONES.map((z) => {
          const startDeg = 180 - z.from * 180;
          const endDeg = 180 - z.to * 180;
          return (
            <path
              key={z.label}
              d={arcPath(startDeg, endDeg)}
              fill="none"
              stroke={z.color}
              strokeWidth={ARC_WIDTH}
              strokeLinecap="butt"
              opacity={0.85}
            />
          );
        })}

        {/* Zone labels along the arc */}
        {ZONES.map((z) => {
          const midNorm = (z.from + z.to) / 2;
          const midDeg = 180 - midNorm * 180;
          const labelR = RADIUS + 30;
          const rad = (midDeg * Math.PI) / 180;
          const lx = CX + labelR * Math.cos(rad);
          const ly = CY - labelR * Math.sin(rad);
          return (
            <text
              key={z.label}
              x={lx}
              y={ly}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={7}
              fontWeight={600}
              fill={z.color}
              fontFamily="system-ui, sans-serif"
            >
              {z.label}
            </text>
          );
        })}

        {/* Tick marks at zone boundaries */}
        {[0, 0.25, 0.5, 0.75, 1].map((n) => {
          const deg = 180 - n * 180;
          const inner = polarToXY(deg);
          const outerR = RADIUS + ARC_WIDTH / 2 + 2;
          const outerRad = (deg * Math.PI) / 180;
          return (
            <line
              key={n}
              x1={CX + (RADIUS - ARC_WIDTH / 2 - 2) * Math.cos(outerRad)}
              y1={CY - (RADIUS - ARC_WIDTH / 2 - 2) * Math.sin(outerRad)}
              x2={CX + outerR * Math.cos(outerRad)}
              y2={CY - outerR * Math.sin(outerRad)}
              stroke="#6b7280"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          );
        })}

        {/* Needle */}
        <line
          x1={CX}
          y1={CY}
          x2={nx}
          y2={ny}
          stroke="#1f2937"
          className="dark:stroke-gray-200"
          strokeWidth={2.5}
          strokeLinecap="round"
          style={{ transition: "all 0.8s ease-out" }}
        />

        {/* Pivot dot */}
        <circle cx={CX} cy={CY} r={5} fill="#374151" className="dark:fill-gray-300" />

        {/* Score number */}
        <text
          x={CX}
          y={CY + 25}
          textAnchor="middle"
          fontSize={20}
          fontWeight="bold"
          fill="#111827"
          className="dark:fill-gray-100"
          fontFamily="system-ui, sans-serif"
        >
          {score}
        </text>

        {/* Zone label */}
        <text
          x={CX}
          y={CY + 42}
          textAnchor="middle"
          fontSize={13}
          fontWeight={600}
          fill={zone.color}
          fontFamily="system-ui, sans-serif"
        >
          {zone.label}
        </text>
      </svg>

      {/* Breakdown chips */}
      <div className="flex flex-wrap justify-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-400" />
          {wires} wires
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-violet-400" />
          {plugins} plugins (×10)
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-cyan-400" />
          {clusters} clusters (×5)
        </span>
      </div>
    </div>
  );
}
