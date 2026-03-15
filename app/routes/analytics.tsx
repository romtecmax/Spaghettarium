import { Link } from "react-router";
import type { Route } from "./+types/analytics";
import { runQuery } from "~/server/db.server";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CountRow {
  label: string;
  count: number;
  description?: string;
}

interface ComplexityRow {
  VersionId: string;
  Document: string;
  Wires: number;
  Plugins: number;
  Clusters: number;
  ComplexityScore: number;
}

// ─── Meta ────────────────────────────────────────────────────────────────────

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Analytics – Spaghettarium" },
    { name: "description", content: "Analytics and insights about the script library." },
  ];
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader() {
  const [categories, tags, plugins, confidence, complexity] = await Promise.all([
    runQuery<CountRow>(`
      MATCH (d:DocumentVersion)
      WHERE d.ai_category IS NOT NULL
      RETURN d.ai_category AS label, count(*) AS count
      ORDER BY count DESC
    `),

    runQuery<CountRow>(`
      MATCH (d:DocumentVersion)
      WHERE d.ai_tags IS NOT NULL
      UNWIND d.ai_tags AS tag
      RETURN tag AS label, count(*) AS count
      ORDER BY count DESC
      LIMIT 15
    `),

    runQuery<CountRow>(`
      MATCH (p:Plugin)-[:PluginToPluginVer]->(pv:PluginVersion)-[:PluginVerToDocVer]->(d:DocumentVersion)
      RETURN p.Name AS label, count(DISTINCT d) AS count, head(collect(pv.ai_description)) AS description
      ORDER BY count DESC
      LIMIT 15
    `),

    runQuery<CountRow>(`
      MATCH (d:DocumentVersion)
      WHERE d.ai_confidence IS NOT NULL
      RETURN
        CASE
          WHEN d.ai_confidence >= 0.9 THEN '90-100%'
          WHEN d.ai_confidence >= 0.8 THEN '80-89%'
          WHEN d.ai_confidence >= 0.7 THEN '70-79%'
          WHEN d.ai_confidence >= 0.6 THEN '60-69%'
          ELSE 'Below 60%'
        END AS label,
        count(*) AS count
      ORDER BY label DESC
    `),

    runQuery<ComplexityRow>(`
      MATCH (d:DocumentVersion)
      OPTIONAL MATCH (ci:ComponentInstance)-[w:Wire]->() WHERE ci.VersionId = d.VersionId
      OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
      OPTIONAL MATCH (d)-[:DocVerToDocVer]->(child)
      WITH d, count(DISTINCT w) AS Wires, count(DISTINCT pv) AS Plugins, count(DISTINCT child) AS Clusters
      RETURN d.VersionId AS VersionId, d.FileName AS Document, Wires, Plugins, Clusters, (Wires + Plugins*10 + Clusters*5) AS ComplexityScore
      ORDER BY ComplexityScore DESC
      LIMIT 50
    `),
  ]);

  return { categories, tags, plugins, confidence, complexity };
}

// ─── Bar Chart Component ─────────────────────────────────────────────────────

function BarChart({
  data,
  colorClass,
  linkTo,
}: {
  data: CountRow[];
  colorClass: string;
  linkTo?: (label: string) => string;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400">No data available.</p>;
  }

  const max = Math.max(...data.map((d) => d.count));

  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="group relative flex items-center gap-3 text-sm">
          {linkTo ? (
            <Link
              to={linkTo(d.label)}
              className="w-28 text-right text-blue-600 dark:text-blue-400 hover:underline truncate"
              title={d.label}
            >
              {d.label}
            </Link>
          ) : (
            <span className="w-28 text-right text-gray-600 dark:text-gray-400 truncate" title={d.label}>
              {d.label}
            </span>
          )}
          <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-5 overflow-hidden">
            <div
              className={`${colorClass} h-full rounded-full transition-all`}
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </div>
          <span className="w-10 text-gray-500 dark:text-gray-400 text-xs text-right">{d.count}</span>
          {d.description && (
            <div className="pointer-events-none absolute left-32 bottom-full mb-1 z-10 hidden group-hover:block w-64 rounded-md bg-gray-900 dark:bg-gray-700 text-white text-xs p-2 shadow-lg">
              {d.description}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Complexity Chart Component (Vertical Bars) ─────────────────────────────

function ComplexityChart({ data }: { data: ComplexityRow[] }) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400">No data available.</p>;
  }

  const max = Math.max(...data.map((d) => d.ComplexityScore));
  const BAR_HEIGHT = 400;

  return (
    <div>
      <div className="flex items-end gap-1 overflow-x-auto" style={{ minHeight: BAR_HEIGHT + 140 }}>
        {data.map((d) => {
          const pct = d.ComplexityScore / max;
          const wiresWeight = d.Wires;
          const pluginsWeight = d.Plugins * 10;
          const clustersWeight = d.Clusters * 5;
          const name = d.Document?.replace(/\.gh$/i, "") ?? d.VersionId;

          return (
            <div key={d.VersionId} className="flex flex-col items-center flex-shrink-0" style={{ width: 28 }}>
              {/* Score label */}
              <span className="text-[10px] text-gray-500 dark:text-gray-400 mb-1">{d.ComplexityScore}</span>
              {/* Stacked bar */}
              <div
                className="w-5 rounded-t overflow-hidden flex flex-col-reverse"
                style={{ height: Math.max(pct * BAR_HEIGHT, 2) }}
              >
                <div className="bg-rose-400 w-full" style={{ flex: wiresWeight }} title={`Wires: ${d.Wires}`} />
                <div className="bg-violet-400 w-full" style={{ flex: pluginsWeight }} title={`Plugins: ${d.Plugins} (×10)`} />
                <div className="bg-cyan-400 w-full" style={{ flex: clustersWeight }} title={`Clusters: ${d.Clusters} (×5)`} />
              </div>
              {/* Script name link — rotated for readability */}
              <div className="relative h-28 w-full">
                <Link
                  to={`/script/${d.VersionId}`}
                  className="absolute top-1 left-1/2 origin-top-left rotate-60 whitespace-nowrap text-[11px] leading-tight text-blue-600 dark:text-blue-400 hover:underline"
                  title={d.Document}
                >
                  {name}
                </Link>
              </div>
            </div>
          );
        })}
      </div>
      {/* Legend */}
      <div className="flex gap-4 mt-2 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-rose-400" /> Wires</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-violet-400" /> Plugins (×10)</span>
        <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-cyan-400" /> Clusters (×5)</span>
      </div>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Analytics({ loaderData }: Route.ComponentProps) {
  const { categories, tags, plugins, confidence, complexity } = loaderData;

  return (
    <main className="container mx-auto px-6 py-8 h-full overflow-y-auto">
      <h1 className="text-2xl font-bold mb-8">Analytics</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Category Distribution */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Categories</h2>
          <BarChart data={categories} colorClass="bg-blue-500" linkTo={(l) => `/?category=${encodeURIComponent(l)}`} />
        </div>

        {/* Top Tags */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Top Tags</h2>
          <BarChart data={tags} colorClass="bg-green-500" linkTo={(l) => `/?tag=${encodeURIComponent(l)}`} />
        </div>

        {/* Plugin Popularity */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Plugin Popularity</h2>
          <BarChart data={plugins} colorClass="bg-purple-500" linkTo={(l) => `/?plugin=${encodeURIComponent(l)}`} />
        </div>

        {/* Confidence Distribution */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold mb-4">AI Confidence Distribution</h2>
          <BarChart data={confidence} colorClass="bg-amber-500" />
        </div>
      </div>

      {/* Complexity – full width */}
      <div className="mt-8 rounded-lg border border-gray-200 dark:border-gray-800 p-6">
        <h2 className="text-lg font-semibold mb-4">Script Complexity</h2>
        <ComplexityChart data={complexity} />
      </div>
    </main>
  );
}
