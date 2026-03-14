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
  plugins: string[];
}

export async function loader() {
  const rows = await runQuery<ScriptRow>(`
    MATCH (d:DocumentVersion)
    OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
    OPTIONAL MATCH (p:Plugin)-[:PluginToPluginVer]->(pv)
    RETURN
      d.DocumentId  AS documentId,
      d.VersionId   AS versionId,
      d.FileName    AS fileName,
      toString(d.FileLastWriteTimeUtc) AS updatedAt,
      collect(DISTINCT p.Name) AS plugins
  `);

  return { scripts: rows };
}

export default function Library({ loaderData }: Route.ComponentProps) {
  const { scripts } = loaderData;

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
                <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">File</th>
                <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Plugins</th>
                <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Last modified</th>
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
