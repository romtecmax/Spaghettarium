import type { Route } from "./+types/analytics";
import { runQuery } from "~/server/db.server";

// ─── Types ───────────────────────────────────────────────────────────────────

interface CountRow {
  label: string;
  count: number;
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
  const [categories, tags, plugins, confidence] = await Promise.all([
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
      RETURN p.Name AS label, count(DISTINCT d) AS count
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
  ]);

  return { categories, tags, plugins, confidence };
}

// ─── Bar Chart Component ─────────────────────────────────────────────────────

function BarChart({ data, colorClass }: { data: CountRow[]; colorClass: string }) {
  if (data.length === 0) {
    return <p className="text-sm text-gray-400">No data available.</p>;
  }

  const max = Math.max(...data.map((d) => d.count));

  return (
    <div className="space-y-2">
      {data.map((d) => (
        <div key={d.label} className="flex items-center gap-3 text-sm">
          <span className="w-28 text-right text-gray-600 dark:text-gray-400 truncate" title={d.label}>
            {d.label}
          </span>
          <div className="flex-1 bg-gray-100 dark:bg-gray-800 rounded-full h-5 overflow-hidden">
            <div
              className={`${colorClass} h-full rounded-full transition-all`}
              style={{ width: `${(d.count / max) * 100}%` }}
            />
          </div>
          <span className="w-10 text-gray-500 dark:text-gray-400 text-xs text-right">{d.count}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Analytics({ loaderData }: Route.ComponentProps) {
  const { categories, tags, plugins, confidence } = loaderData;

  return (
    <main className="container mx-auto px-6 py-8 h-full overflow-y-auto">
      <h1 className="text-2xl font-bold mb-8">Analytics</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Category Distribution */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Categories</h2>
          <BarChart data={categories} colorClass="bg-blue-500" />
        </div>

        {/* Top Tags */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Top Tags</h2>
          <BarChart data={tags} colorClass="bg-green-500" />
        </div>

        {/* Plugin Popularity */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold mb-4">Plugin Popularity</h2>
          <BarChart data={plugins} colorClass="bg-purple-500" />
        </div>

        {/* Confidence Distribution */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 p-6">
          <h2 className="text-lg font-semibold mb-4">AI Confidence Distribution</h2>
          <BarChart data={confidence} colorClass="bg-amber-500" />
        </div>
      </div>
    </main>
  );
}
