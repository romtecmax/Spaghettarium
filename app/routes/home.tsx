import { Link, useFetcher } from "react-router";
import type { Route } from "./+types/home";
import { runQuery } from "~/server/db.server";
import { searchScripts, type SearchResultItem } from "~/server/search.server";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Spaghettarium" }];
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface ScriptRow {
  documentId: string;
  versionId: string;
  fileName: string;
  updatedAt: string | null;
  updatedAtRaw: unknown;
  description: string | null;
  category: string | null;
  tags: string[];
  flow: string | null;
  plugins: string[];
}

interface CategoryCount {
  category: string;
  count: number;
}

interface TagCount {
  tag: string;
  count: number;
}

type SortKey = "fileName" | "updatedAt" | "category";
type SortDir = "asc" | "desc";

const SORT_COLUMNS: Record<SortKey, string> = {
  fileName: "fileName",
  updatedAt: "coalesce(updatedAtRaw, datetime({year: 1900}))",
  category: "coalesce(d.ai_category, '')",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildQuery(
  base: URLSearchParams,
  overrides: Record<string, string | null>
): string {
  const params = new URLSearchParams(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null) {
      params.delete(key);
    } else {
      params.set(key, value);
    }
  }
  const str = params.toString();
  return str ? `?${str}` : "";
}

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const sortKey = (url.searchParams.get("sort") ?? "fileName") as SortKey;
  const sortDir = (url.searchParams.get("dir") ?? "asc") as SortDir;
  const activeCategory = url.searchParams.get("category");
  const activeTag = url.searchParams.get("tag");

  const orderBy = SORT_COLUMNS[sortKey] ?? SORT_COLUMNS.fileName;
  const direction = sortDir === "desc" ? "DESC" : "ASC";

  // Build dynamic WHERE clause
  const whereClauses: string[] = [];
  const queryParams: Record<string, unknown> = {};

  if (activeCategory) {
    whereClauses.push("d.ai_category = $category");
    queryParams.category = activeCategory;
  }
  if (activeTag) {
    whereClauses.push("$tag IN d.ai_tags");
    queryParams.tag = activeTag;
  }

  const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";

  const [scripts, categories, topTags] = await Promise.all([
    runQuery<ScriptRow>(`
      MATCH (d:DocumentVersion)
      ${whereStr}
      OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
      OPTIONAL MATCH (p:Plugin)-[:PluginToPluginVer]->(pv)
      RETURN
        d.DocumentId  AS documentId,
        d.VersionId   AS versionId,
        d.FileName    AS fileName,
        toString(d.FileLastWriteTimeUtc) AS updatedAt,
        d.FileLastWriteTimeUtc AS updatedAtRaw,
        d.ai_description AS description,
        d.ai_category    AS category,
        d.ai_tags        AS tags,
        d.ai_flow        AS flow,
        collect(DISTINCT p.Name) AS plugins
      ORDER BY ${orderBy} ${direction}
    `, queryParams),

    runQuery<CategoryCount>(`
      MATCH (d:DocumentVersion)
      WHERE d.ai_category IS NOT NULL
      RETURN d.ai_category AS category, count(*) AS count
      ORDER BY count DESC
    `),

    runQuery<TagCount>(`
      MATCH (d:DocumentVersion)
      WHERE d.ai_tags IS NOT NULL
      UNWIND d.ai_tags AS tag
      RETURN tag, count(*) AS count
      ORDER BY count DESC
      LIMIT 20
    `),
  ]);

  return { scripts, sortKey, sortDir, categories, topTags, activeCategory, activeTag };
}

// ─── Action (search) ─────────────────────────────────────────────────────────

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const query = formData.get("q") as string;
  if (!query?.trim()) {
    return { query: "", results: [] as SearchResultItem[], error: null };
  }

  try {
    const data = await searchScripts(query);
    return { query, results: data.results, error: null };
  } catch (e) {
    return {
      query,
      results: [] as SearchResultItem[],
      error: "Search service unavailable. Make sure the API is running.",
    };
  }
}

// ─── Sortable header ─────────────────────────────────────────────────────────

function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentDir,
  searchParams,
}: {
  label: string;
  sortKey: SortKey;
  currentSort: SortKey;
  currentDir: SortDir;
  searchParams: URLSearchParams;
}) {
  const isActive = currentSort === sortKey;
  const nextDir = isActive && currentDir === "asc" ? "desc" : "asc";
  return (
    <th className="px-4 py-3">
      <Link
        to={buildQuery(searchParams, { sort: sortKey, dir: nextDir })}
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

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Home({ loaderData }: Route.ComponentProps) {
  const { scripts, sortKey, sortDir, categories, topTags, activeCategory, activeTag } = loaderData;
  const searchParams = new URLSearchParams();
  if (sortKey !== "fileName") searchParams.set("sort", sortKey);
  if (sortDir !== "asc") searchParams.set("dir", sortDir);
  if (activeCategory) searchParams.set("category", activeCategory);
  if (activeTag) searchParams.set("tag", activeTag);

  const fetcher = useFetcher<typeof action>();
  const searchResults = fetcher.data?.results;
  const searchError = fetcher.data?.error;
  const searchQuery = fetcher.data?.query;
  const isSearching = fetcher.state === "submitting";

  return (
    <div className="container mx-auto px-6 pt-6 pb-4 flex flex-col h-full overflow-hidden">
      {/* Title */}
      <h1 className="text-5xl h-30 my-6 font-bold text-center bg-linear-to-r from-blue-600 via-green-500 to-indigo-400 text-transparent bg-clip-text animate-pulse">
        Welcome to the Spaghettarium
      </h1>

      {/* Filter bar */}
      <div className="mb-4 space-y-2">
        {/* Categories */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-1">Category:</span>
          <Link
            to={buildQuery(searchParams, { category: null })}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              !activeCategory
                ? "bg-blue-600 text-white"
                : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
            }`}
          >
            All
          </Link>
          {categories.map((c) => (
            <Link
              key={c.category}
              to={buildQuery(searchParams, { category: c.category })}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                activeCategory === c.category
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700"
              }`}
            >
              {c.category} ({c.count})
            </Link>
          ))}
        </div>

        {/* Tags */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 mr-1">Tags:</span>
          {activeTag && (
            <Link
              to={buildQuery(searchParams, { tag: null })}
              className="px-2.5 py-1 rounded-full text-xs font-medium bg-blue-600 text-white"
            >
              {activeTag} ✕
            </Link>
          )}
          {topTags
            .filter((t) => t.tag !== activeTag)
            .slice(0, 15)
            .map((t) => (
              <Link
                key={t.tag}
                to={buildQuery(searchParams, { tag: t.tag })}
                className="px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              >
                {t.tag}
              </Link>
            ))}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-3 gap-6 flex-1 min-h-0">

        {/* Library — 2/3 */}
        <div className="col-span-2 overflow-y-auto min-h-0">
          {scripts.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No scripts match the current filters.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-800">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900 text-left">
                  <tr>
                    <SortableHeader label="File" sortKey="fileName" currentSort={sortKey} currentDir={sortDir} searchParams={searchParams} />
                    <SortableHeader label="Category" sortKey="category" currentSort={sortKey} currentDir={sortDir} searchParams={searchParams} />
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Tags</th>
                    <th className="px-4 py-3 font-medium text-gray-600 dark:text-gray-400">Plugins</th>
                    <SortableHeader label="Last modified" sortKey="updatedAt" currentSort={sortKey} currentDir={sortDir} searchParams={searchParams} />
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
                        {s.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5 line-clamp-1">
                            {s.description}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {s.category && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                            {s.category}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {(s.tags ?? []).slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="px-1.5 py-0.5 rounded text-xs bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400"
                            >
                              {tag}
                            </span>
                          ))}
                          {(s.tags ?? []).length > 3 && (
                            <span className="text-xs text-gray-400">+{s.tags.length - 3}</span>
                          )}
                        </div>
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

        {/* Search panel — 1/3 */}
        <div className="col-span-1 flex flex-col min-h-0">
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex flex-col flex-1 overflow-hidden">
            {/* Results area */}
            <div className="flex-1 overflow-y-auto px-4 py-4">
              {isSearching ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-gray-400 dark:text-gray-500 animate-pulse">Searching...</p>
                </div>
              ) : searchError ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-red-500">{searchError}</p>
                </div>
              ) : searchResults && searchResults.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                    {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{searchQuery}"
                  </p>
                  {searchResults.map((r) => (
                    <div
                      key={r.version_id}
                      className="rounded-lg border border-gray-100 dark:border-gray-800 p-3 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
                    >
                      <Link
                        to={`/script/${r.version_id}`}
                        className="font-medium text-sm text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {r.file_name ?? r.version_id}
                      </Link>
                      {r.category && (
                        <span className="ml-2 px-1.5 py-0.5 rounded-full text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                          {r.category}
                        </span>
                      )}
                      {r.description && (
                        <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2">
                          {r.description}
                        </p>
                      )}
                      {r.match_explanation && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 italic">
                          {r.match_explanation}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : searchResults && searchResults.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-gray-400 dark:text-gray-500">No results found for "{searchQuery}"</p>
                </div>
              ) : (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-gray-400 dark:text-gray-600">
                    Ask me to find Grasshopper scripts...
                  </p>
                </div>
              )}
            </div>

            {/* Search input */}
            <fetcher.Form method="post" className="border-t border-gray-100 dark:border-gray-800 px-4 py-3 flex gap-2">
              <input
                name="q"
                className="flex-1 rounded-lg border border-gray-200 dark:border-gray-700 bg-transparent px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Search scripts... e.g. &quot;voronoi nesting&quot;"
                defaultValue={searchQuery ?? ""}
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
                disabled={isSearching}
              >
                {isSearching ? "..." : "Send"}
              </button>
            </fetcher.Form>
          </div>
        </div>

      </div>
    </div>
  );
}
