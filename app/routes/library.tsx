import { Link } from "react-router";
import type { Route } from "./+types/library";
import { runQuery } from "~/server/db.server";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Library – Spaghettarium" },
    { name: "description", content: "Browse all Grasshopper scripts in the database." },
  ];
}

interface ScriptRow {
  documentId: string;
  versionId: string;
  fileName: string;
  updatedAt: string | null;
  updatedAtRaw: unknown;
  plugins: string[];
}

type SortKey = "fileName" | "updatedAt";
type SortDir = "asc" | "desc";

const SORT_COLUMNS: Record<SortKey, string> = {
  fileName: "fileName",
  updatedAt: "coalesce(updatedAtRaw, datetime({year: 1900}))",
};

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const sortKey = (url.searchParams.get("sort") ?? "fileName") as SortKey;
  const sortDir = (url.searchParams.get("dir") ?? "asc") as SortDir;

  const orderBy = SORT_COLUMNS[sortKey] ?? SORT_COLUMNS.fileName;
  const direction = sortDir === "desc" ? "DESC" : "ASC";

  const rows = await runQuery<ScriptRow>(`
    MATCH (d:DocumentVersion)
    OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
    OPTIONAL MATCH (p:Plugin)-[:PluginToPluginVer]->(pv)
    RETURN
      d.DocumentId  AS documentId,
      d.VersionId   AS versionId,
      d.FileName    AS fileName,
      toString(d.FileLastWriteTimeUtc) AS updatedAt,
      d.FileLastWriteTimeUtc AS updatedAtRaw,
      collect(DISTINCT p.Name) AS plugins
    ORDER BY ${orderBy} ${direction}
  `);

  return { scripts: rows, sortKey, sortDir };
}

function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
}) {
  const isActive = currentSort === sortKey;
  const nextDir = isActive && currentDir === "asc" ? "desc" : "asc";

  return (
    <th className="px-4 py-3">
      <Link
        to={`?sort=${sortKey}&dir=${nextDir}`}
        className="inline-flex items-center gap-1 font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 select-none"
      >
        {label}
        <span className="text-xs">
          {isActive ? (currentDir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </Link>
    </th>
  );
}

export default function Library({ loaderData }: Route.ComponentProps) {
  const { scripts, sortKey, sortDir } = loaderData;

  return (
    <main className="container mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Script Library</h1>
        {/* Upload Pad goes here */}
      </div>

      {/* Script Search goes here */}

      {scripts.length === 0 ? (
        <p className="text-gray-500 dark:text-gray-400">No scripts in the database yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900 text-left">
              <tr>
                <SortableHeader label="File" sortKey="fileName" currentSort={sortKey} currentDir={sortDir} />
                <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Plugins</th>
                <SortableHeader label="Last modified" sortKey="updatedAt" currentSort={sortKey} currentDir={sortDir} />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {scripts.map((s) => (
                <tr
                  key={`${s.documentId}-${s.versionId}`}
                  className="hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                >
                  <td className="px-4 py-3">
                    <Link
                      to={`/script/${s.versionId}`}
                      className="font-medium text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {s.fileName ?? s.versionId}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-400">
                    {s.plugins.filter(Boolean).join(", ") || "—"}
                  </td>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-500">
                    {s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
