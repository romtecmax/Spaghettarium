import { Link } from "react-router";
import type { Route } from "./+types/home";
import { runQuery } from "~/server/db.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Spaghettarium" }];
}

// ─── Loader ───────────────────────────────────────────────────────────────────

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

  const scripts = await runQuery<ScriptRow>(`
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

  return { scripts, sortKey, sortDir };
}

// ─── Sortable header ──────────────────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home({ loaderData }: Route.ComponentProps) {
  const { scripts, sortKey, sortDir } = loaderData;

  return (
    <div className="container mx-auto px-6 pt-6 pb-4 flex flex-col h-full overflow-hidden">
      {/* Title */}
      <h1 className="text-5xl h-30 my-6 font-bold text-center bg-linear-to-r from-blue-600 via-green-500 to-indigo-400 text-transparent bg-clip-text animate-pulse">
        Welcome to the Spaghettarium
      </h1>

      {/* Two-column layout */}
      <div className="grid grid-cols-3 gap-6 flex-1 min-h-0">

        {/* Library — 2/3 */}
        <div className="col-span-2 overflow-y-auto min-h-0">
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
        </div>

        {/* Chat — 1/3 */}
        <div className="col-span-1 flex flex-col min-h-0">
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 flex items-center justify-center px-6 py-8 overflow-y-auto">
              <p className="text-sm text-gray-400 dark:text-gray-600">
                Chat interface — coming soon
              </p>
            </div>
            <div className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 flex gap-2">
              <input
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ask a question about the library…"
                disabled
              />
              <button
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm opacity-50 cursor-not-allowed"
                disabled
              >
                Send
              </button>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
