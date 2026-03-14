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

// ─── Meta ─────────────────────────────────────────────────────────────────────

export function meta({ loaderData }: Route.MetaArgs) {
  return [{ title: `${loaderData?.script?.fileName ?? "Script"} – Spaghettarium` }];
}

// ─── Loader ───────────────────────────────────────────────────────────────────

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
        toString(d.FileLastWriteTimeUtc)   AS updatedAt
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

// ─── Graph Preview ────────────────────────────────────────────────────────────

const COMP_W = 100;
const COMP_H = 26;
const PADDING = 60;

function GraphPreview({ components, wires }: { components: ComponentNode[]; wires: WireEdge[] }) {
  const positioned = components.filter((c) => c.pivotX != null && c.pivotY != null);

  if (positioned.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-400 dark:text-gray-600 text-sm border rounded-lg border-gray-200 dark:border-gray-800">
        No graph data
      </div>
    );
  }

  const xs = positioned.map((c) => c.pivotX!);
  const ys = positioned.map((c) => c.pivotY!);
  const minX = Math.min(...xs) - COMP_W / 2 - PADDING;
  const minY = Math.min(...ys) - COMP_H / 2 - PADDING;
  const maxX = Math.max(...xs) + COMP_W / 2 + PADDING;
  const maxY = Math.max(...ys) + COMP_H / 2 + PADDING;
  const vbWidth = maxX - minX;
  const vbHeight = maxY - minY;

  const compMap = new Map(positioned.map((c) => [c.instanceGuid, c]));

  return (
    <svg
      viewBox={`${minX} ${minY} ${vbWidth} ${vbHeight}`}
      className="w-full rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-950"
      style={{ maxHeight: "480px" }}
    >
      {/* Wires */}
      {wires.map((w, i) => {
        const src = compMap.get(w.from);
        const tgt = compMap.get(w.to);
        if (!src || !tgt) return null;
        return (
          <line
            key={i}
            x1={src.pivotX!}
            y1={src.pivotY!}
            x2={tgt.pivotX!}
            y2={tgt.pivotY!}
            stroke="#475569"
            strokeWidth={1.5}
          />
        );
      })}

      {/* Component nodes */}
      {positioned.map((c) => (
        <g key={c.instanceGuid} transform={`translate(${c.pivotX! - COMP_W / 2}, ${c.pivotY! - COMP_H / 2})`}>
          <rect
            width={COMP_W}
            height={COMP_H}
            rx={3}
            fill="#1e293b"
            stroke="#334155"
            strokeWidth={0.75}
          />
          <text
            x={COMP_W / 2}
            y={COMP_H / 2}
            dominantBaseline="middle"
            textAnchor="middle"
            fill="#94a3b8"
            fontSize={8}
            fontFamily="monospace"
          >
            {c.componentName}
          </text>
        </g>
      ))}
    </svg>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScriptDetail({ loaderData }: Route.ComponentProps) {
  const { script, plugins, components, wires } = loaderData;

  if (!script) {
    return (
      <main className="container mx-auto px-6 py-8">
        <p className="text-gray-500">Script not found.</p>
      </main>
    );
  }

  return (
    <main className="container mx-auto px-6 py-8">
      {/* Breadcrumb */}
      <div className="mb-6">
        <Link to="/library" className="text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">
          ← Library
        </Link>
        <h1 className="text-2xl font-bold mt-1">{script.fileName}</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* ── Left: Script View ── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div>
              <span className="text-gray-500 dark:text-gray-400">File path</span>
              <p className="font-mono text-xs mt-0.5 truncate">{script.filePath ?? "—"}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Components</span>
              <p className="mt-0.5">{components.length}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Created</span>
              <p className="mt-0.5">{script.createdAt ? new Date(script.createdAt).toLocaleDateString() : "—"}</p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Last modified</span>
              <p className="mt-0.5">{script.updatedAt ? new Date(script.updatedAt).toLocaleDateString() : "—"}</p>
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

          {/* Description (editable – storage TBD) */}
          <div>
            <h2 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-2">Description</h2>
            <textarea
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={3}
              placeholder="Add a description…"
            />
          </div>

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
