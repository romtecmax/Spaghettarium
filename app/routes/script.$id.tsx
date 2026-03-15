import { useState } from "react";
import { Link } from "react-router";
import { ChatPanel } from "~/components/ChatPanel";
import GraphViewer, { type LegendItem } from "~/components/GraphViewer";
import { Spaghettimeter } from "~/components/Spaghettimeter";
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
  pluginId: string;
  pluginVersion: string;
}

interface ComponentNode {
  instanceGuid: string;
  componentName: string;
  pivotX: number | null;
  pivotY: number | null;
  category: string | null;
}

interface WireEdge {
  from: string;
  to: string;
}

interface ClusterRow {
  clusters: number;
}

// ─── Meta ────────────────────────────────────────────────────────────────────

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.script?.fileName ?? "Script"} – Spaghettarium` }];
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ params }: Route.LoaderArgs) {
  const versionId = params.id;

  const [detailRows, pluginRows, componentRows, wireRows, clusterRows] = await Promise.all([
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
      RETURN DISTINCT p.Name AS pluginName, p.Author AS pluginAuthor,
             p.PluginId AS pluginId, pv.Version AS pluginVersion
      ORDER BY p.Name
    `, { versionId }),

    runQuery<ComponentNode>(`
      MATCH (ci:ComponentInstance {VersionId: $versionId})
      OPTIONAL MATCH (cd:ComponentDefinition {ComponentGuid: ci.ComponentGuid})
      RETURN
        ci.InstanceGuid   AS instanceGuid,
        ci.ComponentName  AS componentName,
        ci.PivotX         AS pivotX,
        ci.PivotY         AS pivotY,
        cd.ai_category    AS category
    `, { versionId }),

    runQuery<WireEdge>(`
      MATCH (ci1:ComponentInstance {VersionId: $versionId})-[:Wire]->(ci2:ComponentInstance {VersionId: $versionId})
      RETURN ci1.InstanceGuid AS from, ci2.InstanceGuid AS to
    `, { versionId }),

    runQuery<ClusterRow>(`
      MATCH (d:DocumentVersion {VersionId: $versionId})
      OPTIONAL MATCH (d)-[:DocVerToDocVer]->(child)
      RETURN count(DISTINCT child) AS clusters
    `, { versionId }),
  ]);

  const script = detailRows[0] ?? null;
  const clusters = clusterRows[0]?.clusters ?? 0;
  return { script, plugins: pluginRows, components: componentRows, wires: wireRows, clusters };
}

// ─── Graph Preview ───────────────────────────────────────────────────────────

const COMP_W = 100;
const COMP_H = 60;
const PADDING = 160;
const SCALE = 1.8;

const CATEGORY_FILL: Record<string, { fill: string; stroke: string }> = {
  geometry:     { fill: "#bbf7d0", stroke: "#4ade80" },
  mesh:         { fill: "#e9d5ff", stroke: "#a78bfa" },
  data:         { fill: "#fed7aa", stroke: "#fb923c" },
  display:      { fill: "#fbcfe8", stroke: "#f472b6" },
  interop:      { fill: "#a5f3fc", stroke: "#22d3ee" },
  analysis:     { fill: "#c7d2fe", stroke: "#818cf8" },
  optimization: { fill: "#fde68a", stroke: "#fbbf24" },
  fabrication:  { fill: "#fecaca", stroke: "#f87171" },
  simulation:   { fill: "#99f6e4", stroke: "#2dd4bf" },
  utility:      { fill: "#e5e7eb", stroke: "#9ca3af" },
};

function GraphPreview({ components, wires }: { components: ComponentNode[]; wires: WireEdge[] }) {
  const [open, setOpen] = useState(false);

  const positioned = components.filter((c) => c.pivotX != null && c.pivotY != null);
  const activeCategories = [...new Set(positioned.map((c) => c.category).filter(Boolean))] as string[];

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

  // Derive inputs (no incoming wires) and outputs (no outgoing wires)
  const hasIncoming = new Set(wires.map((w) => w.to));
  const hasOutgoing = new Set(wires.map((w) => w.from));
  const isInput  = (id: string) => !hasIncoming.has(id) && compMap.has(id);
  const isOutput = (id: string) => !hasOutgoing.has(id) && compMap.has(id);

  const legend: LegendItem[] = [
    ...activeCategories.sort().map((cat) => {
      const c = CATEGORY_FILL[cat] ?? CATEGORY_FILL.utility;
      return { label: cat, fill: c.fill, stroke: c.stroke };
    }),
    { label: "unknown", fill: "#9ca3af", stroke: "#6b7280" },
    { label: "input", fill: "transparent", stroke: "#2563eb", borderOnly: true },
    { label: "output", fill: "transparent", stroke: "#dc2626", borderOnly: true },
  ];

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
        const cat = CATEGORY_FILL[c.category ?? ""] ?? { fill: "#9ca3af", stroke: "#6b7280" };
        const input  = isInput(c.instanceGuid);
        const output = isOutput(c.instanceGuid);
        const ioStroke = input ? "#2563eb" : output ? "#dc2626" : null;
        return (
          <g key={c.instanceGuid} transform={`translate(${c.pivotX - w / 2}, ${c.pivotY - h / 2})`}>
            {isSlider ? (
              <>
                <rect width={w} height={h} rx={2} fill={cat.fill} stroke={ioStroke ?? cat.stroke} strokeWidth={ioStroke ? 2.5 : 0.75} />
                <rect x={0} width={w * 0.22} height={h} rx={2} fill={cat.stroke} />
                <rect x={w * 0.22 * 0.6} width={w * 0.22 * 0.4} height={h} fill={cat.stroke} />
              </>
            ) : isPanel ? (
              <rect width={w} height={h} rx={3} fill="#fde047" stroke={ioStroke ?? "#facc15"} strokeWidth={ioStroke ? 2.5 : 0.75} />
            ) : (
              <rect width={w} height={h} rx={3} fill={cat.fill} stroke={ioStroke ?? cat.stroke} strokeWidth={ioStroke ? 2.5 : 0.75} />
            )}
            <text x={w / 2} y={h / 2} dominantBaseline="middle" textAnchor="middle"
              fill="#1f2937" fontSize={8} fontFamily="monospace">
              {c.componentName}
            </text>
            {(input || output) && (
              <text x={w / 2} y={-5} textAnchor="middle" fill={ioStroke!} fontSize={6} fontFamily="monospace" fontWeight="bold">
                {input ? "INPUT" : "OUTPUT"}
              </text>
            )}
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

      {activeCategories.length > 0 && (
        <div className="flex flex-wrap gap-3 mt-2">
          {activeCategories.sort().map((cat) => {
            const colors = CATEGORY_FILL[cat] ?? CATEGORY_FILL.utility;
            return (
              <div key={cat} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                <span className="inline-block w-3 h-3 rounded-sm border" style={{ background: colors.fill, borderColor: colors.stroke }} />
                {cat}
              </div>
            );
          })}
          <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
            <span className="inline-block w-3 h-3 rounded-sm border" style={{ background: "#9ca3af", borderColor: "#6b7280" }} />
            unknown
          </div>
          <div className="border-l border-gray-300 dark:border-gray-700 h-3" />
          <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ border: "2px solid #2563eb" }} />
            input
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ border: "2px solid #dc2626" }} />
            output
          </div>
        </div>
      )}

      {open && (
        <GraphViewer
          svgContent={svgContent}
          initialViewBox={{ x: minX, y: minY, width: vbWidth, height: vbHeight }}
          legend={legend}
          onClose={() => setOpen(false)}
        />
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
  const { script, plugins, components, wires, clusters } = loaderData;

  if (!script) {
    return (
      <main className="container mx-auto px-6 py-8">
        <p className="text-gray-500">Script not found.</p>
      </main>
    );
  }

  const categoryColor = CATEGORY_COLORS[script.category ?? ""] ?? CATEGORY_COLORS.other;

  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<{ success: boolean; steps?: string[]; warnings?: string[]; error?: string } | null>(null);

  async function handleLaunch() {
    setLaunching(true);
    setLaunchResult(null);
    try {
      const res = await fetch(`http://localhost:8000/api/scripts/${script.versionId}/launch`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setLaunchResult({ success: false, error: data.detail || "Launch failed" });
      } else {
        setLaunchResult(data);
      }
    } catch (e) {
      setLaunchResult({ success: false, error: "Cannot reach backend. Is it running on port 8000?" });
    } finally {
      setLaunching(false);
    }
  }

  return (
    <main className="container mx-auto px-6 py-8 h-full overflow-y-auto">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link to="/" className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">
          ← Home
        </Link>
        <div className="flex items-center gap-4 mt-1">
          <h1 className="text-2xl font-bold">{script.fileName}</h1>
          <button
            onClick={handleLaunch}
            disabled={launching}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-lg bg-green-600 hover:bg-green-700 disabled:bg-green-800 disabled:opacity-60 text-white text-sm font-medium transition-colors"
          >
            {launching ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Launching...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Open in Grasshopper
              </>
            )}
          </button>
        </div>
        {launchResult && (
          <div className={`mt-3 p-3 rounded-lg text-sm ${launchResult.success ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800" : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"}`}>
            {launchResult.success ? (
              <>
                <p className="font-medium text-green-700 dark:text-green-300">Launched successfully</p>
                {(launchResult.steps ?? []).map((s, i) => (
                  <p key={i} className="text-green-600 dark:text-green-400">{s}</p>
                ))}
                {(launchResult.warnings ?? []).length > 0 && (
                  <div className="mt-1">
                    {launchResult.warnings!.map((w, i) => (
                      <p key={i} className="text-yellow-600 dark:text-yellow-400">{w}</p>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <p className="text-red-700 dark:text-red-300">{launchResult.error}</p>
            )}
          </div>
        )}
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

        {/* ── Right: Spaghettimeter + Chat ── */}
        <div className="lg:col-span-1 flex flex-col gap-6 lg:max-h-[calc(100vh-10rem)] lg:sticky lg:top-8">
          {/* Spaghettimeter */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-4 flex justify-center shrink-0">
            <Spaghettimeter
              score={wires.length + plugins.length * 10 + clusters * 5}
              wires={wires.length}
              plugins={plugins.length}
              clusters={clusters}
            />
          </div>

          <ChatPanel
            title="Ask about this script"
            placeholder="Ask anything about this script or find related ones…"
            scriptContext={[
              `File: ${script.fileName}`,
              script.category ? `Category: ${script.category}` : null,
              script.description ? `Description: ${script.description}` : null,
              script.tags?.length ? `Tags: ${script.tags.join(", ")}` : null,
              script.inputs?.length ? `Inputs: ${script.inputs.join(", ")}` : null,
              script.outputs?.length ? `Outputs: ${script.outputs.join(", ")}` : null,
              script.flow ? `Flow: ${script.flow}` : null,
            ].filter(Boolean).join("\n")}
          />
        </div>
      </div>
    </main>
  );
}
