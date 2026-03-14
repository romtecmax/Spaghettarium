import { useState } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/script.$id";
import { runQuery } from "~/server/db.server";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScriptDetails {
  documentId: string;
  versionId: string;
  fileName: string;
  filePath: string;
  createdAt: string | null;
  updatedAt: string | null;
  description: string | null;
  flow: string | null;
  tags: string[];
  category: string | null;
  confidence: number | null;
  inputs: string[];
  outputs: string[];
}

interface PluginRow {
  pluginName: string;
  pluginAuthor: string;
}

interface ComponentNode {
  instanceGuid: string;
  componentName: string;
  pivotX: number | null;
  pivotY: number | null;
}

interface WireEdge {
  from: string;
  to: string;
}

// ─── Meta ────────────────────────────────────────────────────────────────────

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.script?.fileName ?? "Script"} – Spaghettarium` }];
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ params }: Route.LoaderArgs) {
  const versionId = params.id;

  const [detailRows, pluginRows, componentRows, wireRows] = await Promise.all([
    runQuery<ScriptDetails>(`
      MATCH (d:DocumentVersion {VersionId: $versionId})
      RETURN
        d.DocumentId AS documentId,
        d.VersionId  AS versionId,
        d.FileName   AS fileName,
        d.FilePath   AS filePath,
        toString(d.FileCreationTimeUtc)    AS createdAt,
        toString(d.FileLastWriteTimeUtc)   AS updatedAt,
        d.ai_description AS description,
        d.ai_flow        AS flow,
        d.ai_tags        AS tags,
        d.ai_category    AS category,
        d.ai_confidence  AS confidence,
        d.ai_inputs      AS inputs,
        d.ai_outputs     AS outputs
    `, { versionId }),

    runQuery<PluginRow>(`
      MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d:DocumentVersion {VersionId: $versionId})
      MATCH (p:Plugin)-[:PluginToPluginVer]->(pv)
      RETURN DISTINCT p.Name AS pluginName, p.Author AS pluginAuthor
      ORDER BY p.Name
    `, { versionId }),

    runQuery<ComponentNode>(`
      MATCH (ci:ComponentInstance {VersionId: $versionId})
      RETURN
        ci.InstanceGuid   AS instanceGuid,
        ci.ComponentName  AS componentName,
        ci.PivotX         AS pivotX,
        ci.PivotY         AS pivotY
    `, { versionId }),

    runQuery<WireEdge>(`
      MATCH (ci1:ComponentInstance {VersionId: $versionId})-[:Wire]->(ci2:ComponentInstance {VersionId: $versionId})
      RETURN ci1.InstanceGuid AS from, ci2.InstanceGuid AS to
    `, { versionId }),
  ]);

  const script = detailRows[0] ?? null;
  return { script, plugins: pluginRows, components: componentRows, wires: wireRows };
}

// ─── Graph Preview ───────────────────────────────────────────────────────────

const COMP_W = 100;
const COMP_H = 60;
const PADDING = 160;
const SCALE = 1.8;

function GraphPreview({ components, wires }: { components: ComponentNode[]; wires: WireEdge[] }) {
  const [open, setOpen] = useState(false);

  const positioned = components.filter((c) => c.pivotX != null && c.pivotY != null);

  if (positioned.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 dark:text-gray-600 text-sm border rounded-lg border-gray-200 dark:border-gray-800">
        No graph data
      </div>
    );
  }

  const scaled = positioned.map((c) => ({ ...c, pivotX: c.pivotX! * SCALE, pivotY: c.pivotY! * SCALE }));
  const xs = scaled.map((c) => c.pivotX);
  const ys = scaled.map((c) => c.pivotY);
  const minX = Math.min(...xs) - COMP_W / 2 - PADDING;
  const minY = Math.min(...ys) - COMP_H / 2 - PADDING;
  const maxX = Math.max(...xs) + COMP_W / 2 + PADDING;
  const maxY = Math.max(...ys) + COMP_H / 2 + PADDING;
  const vbWidth = maxX - minX;
  const vbHeight = maxY - minY;
  const viewBox = `${minX} ${minY} ${vbWidth} ${vbHeight}`;

  const compMap = new Map(scaled.map((c) => [c.instanceGuid, c]));

  const svgContent = (
    <>
      {wires.map((w, i) => {
        const src = compMap.get(w.from);
        const tgt = compMap.get(w.to);
        if (!src || !tgt) return null;
        return (
          <line key={i} x1={src.pivotX} y1={src.pivotY} x2={tgt.pivotX} y2={tgt.pivotY}
            stroke="#000000" strokeWidth={1.5} />
        );
      })}
      {scaled.map((c) => {
        const isSlider = c.componentName === "Number Slider";
        const isPanel  = c.componentName === "Panel";
        const h = isSlider ? COMP_H * 0.3 : isPanel ? COMP_W * (3 / 4) : COMP_H;
        const w = isSlider ? COMP_W * 1.5 : COMP_W;
        return (
          <g key={c.instanceGuid} transform={`translate(${c.pivotX - w / 2}, ${c.pivotY - h / 2})`}>
            {isSlider ? (
              <>
                <rect width={w} height={h} rx={2} fill="#e5e7eb" stroke="#d1d5db" strokeWidth={0.75} />
                <rect x={0} width={w * 0.22} height={h} rx={2} fill="#9ca3af" />
                <rect x={w * 0.22 * 0.6} width={w * 0.22 * 0.4} height={h} fill="#9ca3af" />
              </>
            ) : isPanel ? (
              <rect width={w} height={h} rx={3} fill="#fde047" stroke="#facc15" strokeWidth={0.75} />
            ) : (
              <rect width={w} height={h} rx={3} fill="#9ca3af" stroke="#6b7280" strokeWidth={0.75} />
            )}
            <text x={w / 2} y={h / 2} dominantBaseline="middle" textAnchor="middle"
              fill="#1f2937" fontSize={8} fontFamily="monospace">
              {c.componentName}
            </text>
          </g>
        );
      })}
    </>
  );

  return (
    <>
      <svg viewBox={viewBox} onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-gray-200 cursor-zoom-in"
        style={{ background: "#faf8f4", maxHeight: "700px" }}>
        {svgContent}
      </svg>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 overflow-auto" onClick={() => setOpen(false)}>
          <button
            onClick={() => setOpen(false)}
            className="fixed top-4 right-4 z-10 w-9 h-9 rounded-full bg-white text-gray-800 text-xl font-bold flex items-center justify-center shadow-lg hover:bg-gray-100"
          >
            x
          </button>

          <div className="p-8 min-w-fit min-h-fit" onClick={(e) => e.stopPropagation()}>
            <svg viewBox={viewBox} width={vbWidth} height={vbHeight}
              style={{ background: "#faf8f4", display: "block", borderRadius: 8 }}>
              {svgContent}
            </svg>
          </div>
        </div>
      )}
    </>
  );
}

// ─── Category colors ─────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  geometry: "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300",
  mesh: "bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300",
  data: "bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300",
  display: "bg-pink-100 dark:bg-pink-900/40 text-pink-700 dark:text-pink-300",
  interop: "bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300",
  analysis: "bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300",
  optimization: "bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300",
  fabrication: "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300",
  simulation: "bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300",
  utility: "bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300",
  other: "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400",
};

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ScriptDetail({ loaderData }: Route.ComponentProps) {
  const { script, plugins, components, wires } = loaderData;

  if (!script) {
    return (
      <main className="container mx-auto px-6 py-8">
        <p className="text-gray-500">Script not found.</p>
      </main>
    );
  }

  const categoryColor = CATEGORY_COLORS[script.category ?? ""] ?? CATEGORY_COLORS.other;

  return (
    <main className="container mx-auto px-6 py-8 h-full overflow-y-auto">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">
          ← Home
        </Link>
        <h1 className="text-2xl font-bold mt-1">{script.fileName}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* ── Left: Script View ── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Metadata */}
          <div className="grid grid-cols-3 gap-x-8 gap-y-2 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">File path</span>
              <p className="font-mono text-xs mt-0.5 truncate">{script.filePath ?? "—"}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Components</span>
              <p className="mt-0.5">{components.length}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Category</span>
              <div className="mt-0.5 flex items-center gap-2">
                {script.category ? (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${categoryColor}`}>
                    {script.category}
                  </span>
                ) : (
                  <span className="text-gray-400">—</span>
                )}
                {script.confidence != null && (
                  <span className="text-xs text-gray-400">
                    {Math.round(script.confidence * 100)}% confidence
                  </span>
                )}
              </div>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Created</span>
              <p className="mt-0.5">{script.createdAt ? new Date(script.createdAt).toLocaleDateString() : "—"}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Last modified</span>
              <p className="mt-0.5">{script.updatedAt ? new Date(script.updatedAt).toLocaleDateString() : "—"}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Wires</span>
              <p className="mt-0.5">{wires.length}</p>
            </div>
          </div>

          {/* Plugins */}
          {plugins.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Plugins</h2>
              <div className="flex flex-wrap gap-2">
                {plugins.map((p) => (
                  <span
                    key={p.pluginName}
                    title={p.pluginAuthor}
                    className="px-2 py-0.5 rounded-full text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                  >
                    {p.pluginName}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          <div>
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Description</h2>
            <p className="text-sm leading-relaxed">
              {script.description ?? "No description available."}
            </p>
          </div>

          {/* Data Flow */}
          {script.flow && (
            <div>
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Data Flow</h2>
              <p className="font-mono text-sm bg-gray-50 dark:bg-gray-900 rounded-lg px-4 py-3 border border-gray-200 dark:border-gray-800">
                {script.flow}
              </p>
            </div>
          )}

          {/* Tags */}
          {(script.tags ?? []).length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Tags</h2>
              <div className="flex flex-wrap gap-2">
                {script.tags.map((tag) => (
                  <Link
                    key={tag}
                    to={`/?tag=${encodeURIComponent(tag)}`}
                    className="px-2 py-0.5 rounded-full text-xs bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800 hover:bg-green-200 dark:hover:bg-green-800/40 transition-colors"
                  >
                    {tag}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Inputs / Outputs */}
          {((script.inputs ?? []).length > 0 || (script.outputs ?? []).length > 0) && (
            <div className="grid grid-cols-2 gap-6">
              {(script.inputs ?? []).length > 0 && (
                <div>
                  <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Inputs</h2>
                  <ul className="list-disc list-inside text-sm space-y-1">
                    {script.inputs.map((inp, i) => (
                      <li key={i} className="text-gray-700 dark:text-gray-300">{inp}</li>
                    ))}
                  </ul>
                </div>
              )}
              {(script.outputs ?? []).length > 0 && (
                <div>
                  <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Outputs</h2>
                  <ul className="list-disc list-inside text-sm space-y-1">
                    {script.outputs.map((out, i) => (
                      <li key={i} className="text-gray-700 dark:text-gray-300">{out}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Graph preview */}
          <div>
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">
              Graph preview
              <span className="ml-2 text-xs font-normal">{components.length} components · {wires.length} wires</span>
            </h2>
            <GraphPreview components={components} wires={wires} />
          </div>
        </div>

        {/* ── Right: Chat Interface ── */}
        <div className="lg:col-span-1">
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 h-full min-h-64 flex items-center justify-center text-gray-400 dark:text-gray-600 text-sm">
            Chat interface — coming soon
          </div>
        </div>
      </div>
    </main>
  );
}
