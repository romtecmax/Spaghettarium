# Integrating AI Enrichment Data into Spaghettarium

This guide explains how to use the enriched `DocumentVersion` properties in the Spaghettarium web app. All 824 documents have been enriched with AI-generated metadata stored directly on the Neo4j nodes.

---

## What's Available

Every `DocumentVersion` node now has these additional properties:

| Property | Type | Description | Example |
|----------|------|-------------|---------|
| `ai_description` | `string` | What the script does, in plain English | `"Creates a parametric facade panel system using attractor points to vary opening sizes"` |
| `ai_flow` | `string` | Simplified data flow pipeline | `"Number Slider → Populate 2D → Voronoi → Project → OpenNest → ShapeDiverExport"` |
| `ai_tags` | `string[]` | 3–8 descriptive tags | `["voronoi", "nesting", "fabrication"]` |
| `ai_category` | `string` | One of: `geometry`, `mesh`, `data`, `display`, `interop`, `analysis`, `optimization`, `fabrication`, `simulation`, `utility`, `other` | `"fabrication"` |
| `ai_confidence` | `float` | How confident the AI is (0.0–1.0) | `0.9` |
| `ai_inputs` | `string[]` | What the user feeds the script | `["number slider (count)", "surface (boundary)"]` |
| `ai_outputs` | `string[]` | What the script produces | `["mesh geometry", "baked brep"]` |
| `embedding` | `float[]` | 1536-dim vector for semantic search (used by the API, not needed in the UI) | — |

**Coverage:** 824 documents enriched (100%). A small number may have `ai_confidence < 0.5` — these had limited component/wiring data.

---

## 1. Update the Library Page (home.tsx)

### Update the query

Current query returns only `fileName`, `updatedAt`, and `plugins`. Add the enriched fields:

```cypher
MATCH (d:DocumentVersion)
OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
OPTIONAL MATCH (p:Plugin)-[:PluginToPluginVer]->(pv)
RETURN
  d.DocumentId                     AS documentId,
  d.VersionId                      AS versionId,
  d.FileName                       AS fileName,
  toString(d.FileLastWriteTimeUtc) AS updatedAt,
  d.FileLastWriteTimeUtc           AS updatedAtRaw,
  d.ai_description                 AS description,
  d.ai_category                    AS category,
  d.ai_tags                        AS tags,
  d.ai_flow                        AS flow,
  collect(DISTINCT p.Name)         AS plugins
ORDER BY ${orderBy} ${direction}
```

### Update the TypeScript interface

```typescript
interface ScriptRow {
  documentId: string;
  versionId: string;
  fileName: string;
  updatedAt: string | null;
  updatedAtRaw: unknown;
  description: string | null;   // NEW
  category: string | null;      // NEW
  tags: string[];               // NEW
  flow: string | null;          // NEW
  plugins: string[];
}
```

### Display suggestions for the library table

You can add new columns or enrich existing rows. Some ideas:

**Option A: Add columns to the table**

| File | Description | Category | Tags | Plugins | Last modified |
|------|-------------|----------|------|---------|---------------|

```tsx
<td className="...">{s.description ?? "—"}</td>
<td className="...">
  {s.category && (
    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-800">
      {s.category}
    </span>
  )}
</td>
<td className="...">
  {(s.tags ?? []).map(tag => (
    <span key={tag} className="mr-1 rounded bg-gray-100 px-1.5 py-0.5 text-xs">
      {tag}
    </span>
  ))}
</td>
```

**Option B: Expandable row with description + flow**

Keep the table compact but allow clicking a row to expand and show:
- Description (full text)
- Flow pipeline (monospace)
- Tags (pill badges)

### Add sorting by category

Add `category` to the `SORT_COLUMNS` map:

```typescript
const SORT_COLUMNS: Record<SortKey, string> = {
  fileName: "fileName",
  updatedAt: "coalesce(updatedAtRaw, datetime({year: 1900}))",
  category: "coalesce(d.ai_category, '')",
};
```

### Add filtering by category and tag

Update the loader to accept query params:

```typescript
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const category = url.searchParams.get("category");
  const tag = url.searchParams.get("tag");

  let whereClause = "";
  const params: Record<string, unknown> = {};

  if (category) {
    whereClause += " WHERE d.ai_category = $category";
    params.category = category;
  }
  if (tag) {
    whereClause += whereClause ? " AND $tag IN d.ai_tags" : " WHERE $tag IN d.ai_tags";
    params.tag = tag;
  }

  const rows = await runQuery<ScriptRow>(`
    MATCH (d:DocumentVersion)
    ${whereClause}
    OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
    OPTIONAL MATCH (p:Plugin)-[:PluginToPluginVer]->(pv)
    RETURN
      d.DocumentId AS documentId,
      d.VersionId AS versionId,
      d.FileName AS fileName,
      toString(d.FileLastWriteTimeUtc) AS updatedAt,
      d.FileLastWriteTimeUtc AS updatedAtRaw,
      d.ai_description AS description,
      d.ai_category AS category,
      d.ai_tags AS tags,
      d.ai_flow AS flow,
      collect(DISTINCT p.Name) AS plugins
    ORDER BY fileName ASC
  `, params);

  return { rows, category, tag };
}
```

---

## 2. Update the Script Detail Page (script.$id.tsx)

### Update the metadata query

```cypher
MATCH (d:DocumentVersion {VersionId: $versionId})
RETURN
  d.DocumentId                     AS documentId,
  d.VersionId                      AS versionId,
  d.FileName                       AS fileName,
  d.FilePath                       AS filePath,
  toString(d.FileCreationTimeUtc)  AS createdAt,
  toString(d.FileLastWriteTimeUtc) AS updatedAt,
  d.ai_description                 AS description,
  d.ai_flow                        AS flow,
  d.ai_tags                        AS tags,
  d.ai_category                    AS category,
  d.ai_confidence                  AS confidence,
  d.ai_inputs                      AS inputs,
  d.ai_outputs                     AS outputs
```

### Update the TypeScript interface

```typescript
interface ScriptDetails {
  documentId: string;
  versionId: string;
  fileName: string;
  filePath: string;
  createdAt: string | null;
  updatedAt: string | null;
  description: string | null;   // NEW
  flow: string | null;          // NEW
  tags: string[];               // NEW
  category: string | null;      // NEW
  confidence: number | null;    // NEW
  inputs: string[];             // NEW
  outputs: string[];            // NEW
}
```

### Display suggestions for the detail page

Replace the empty description textarea with the AI-generated description and add new sections:

```tsx
{/* Description — replace the empty textarea */}
<div>
  <h3 className="text-sm font-medium text-zinc-400">Description</h3>
  <p className="mt-1 text-sm text-zinc-300">
    {script.description ?? "No description available"}
  </p>
</div>

{/* Category + Confidence */}
<div className="flex items-center gap-3">
  {script.category && (
    <span className="rounded-full bg-blue-900/50 px-3 py-1 text-xs font-medium text-blue-300">
      {script.category}
    </span>
  )}
  {script.confidence != null && (
    <span className="text-xs text-zinc-500">
      {Math.round(script.confidence * 100)}% confidence
    </span>
  )}
</div>

{/* Data Flow */}
{script.flow && (
  <div>
    <h3 className="text-sm font-medium text-zinc-400">Data Flow</h3>
    <p className="mt-1 font-mono text-sm text-zinc-300">{script.flow}</p>
  </div>
)}

{/* Tags */}
{script.tags?.length > 0 && (
  <div>
    <h3 className="text-sm font-medium text-zinc-400">Tags</h3>
    <div className="mt-1 flex flex-wrap gap-1.5">
      {script.tags.map(tag => (
        <a
          key={tag}
          href={`/?tag=${encodeURIComponent(tag)}`}
          className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
        >
          {tag}
        </a>
      ))}
    </div>
  </div>
)}

{/* Inputs / Outputs */}
<div className="grid grid-cols-2 gap-4">
  <div>
    <h3 className="text-sm font-medium text-zinc-400">Inputs</h3>
    <ul className="mt-1 space-y-0.5 text-sm text-zinc-300">
      {(script.inputs ?? []).map((inp, i) => (
        <li key={i}>→ {inp}</li>
      ))}
    </ul>
  </div>
  <div>
    <h3 className="text-sm font-medium text-zinc-400">Outputs</h3>
    <ul className="mt-1 space-y-0.5 text-sm text-zinc-300">
      {(script.outputs ?? []).map((out, i) => (
        <li key={i}>← {out}</li>
      ))}
    </ul>
  </div>
</div>
```

---

## 3. Add a Search Page

There are two options for search: query Neo4j directly (simple) or use the FastAPI search API (AI-powered with semantic understanding).

### Option A: Simple text search (Neo4j only, no API)

Create a new route `app/routes/search.tsx`:

```typescript
import type { Route } from "./+types/search";
import { runQuery } from "~/server/db.server";

interface SearchResult {
  documentId: string;
  versionId: string;
  fileName: string;
  description: string | null;
  tags: string[];
  category: string | null;
  flow: string | null;
  plugins: string[];
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  if (!q) return { results: [], query: "" };

  const results = await runQuery<SearchResult>(`
    MATCH (d:DocumentVersion)
    WHERE d.ai_description IS NOT NULL
      AND (toLower(d.ai_description) CONTAINS toLower($q)
           OR toLower(d.ai_flow) CONTAINS toLower($q)
           OR ANY(tag IN coalesce(d.ai_tags, []) WHERE tag CONTAINS toLower($q))
           OR toLower(d.FileName) CONTAINS toLower($q))
    OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
    OPTIONAL MATCH (p:Plugin)-[:PluginToPluginVer]->(pv)
    RETURN
      d.DocumentId AS documentId,
      d.VersionId AS versionId,
      d.FileName AS fileName,
      d.ai_description AS description,
      d.ai_tags AS tags,
      d.ai_category AS category,
      d.ai_flow AS flow,
      collect(DISTINCT p.Name) AS plugins
    LIMIT 50
  `, { q });

  return { results, query: q };
}
```

This is fast and free (no API calls) but only does exact substring matching.

### Option B: AI-powered search (via FastAPI)

Uses the search API which interprets natural language, expands tags, and combines structured + vector similarity search.

```typescript
import type { Route } from "./+types/search";

const API_BASE = process.env.SEARCH_API_URL ?? "http://localhost:8000";

interface SearchResult {
  document_id: string;
  version_id: string;
  file_name: string;
  description: string | null;
  tags: string[];
  category: string | null;
  flow: string | null;
  plugins: string[];
  match_explanation: string;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() || "";
  if (!q) return { results: [], query: "" };

  const res = await fetch(`${API_BASE}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: q, max_results: 20 }),
  });

  if (!res.ok) return { results: [], query: q };

  const data = await res.json();
  return { results: data.results as SearchResult[], query: q };
}
```

> **Note:** The FastAPI server must be running (`uvicorn app.main:app --host 0.0.0.0 --port 8000` from the `neo4j-grasshopper-graph` directory). Add `SEARCH_API_URL` to your `.env` if the API is on a different machine.

**Key differences:**
- The API returns `match_explanation` — a sentence explaining *why* each result matches
- The API expands queries with synonyms (e.g., "nesting" → also searches "packing", "layout")
- The API uses vector embeddings for semantic similarity (finds conceptually related scripts even without keyword overlap)
- The API field names use `snake_case` (`file_name`, `version_id`) — map them when navigating to Spaghettarium routes that use `versionId`

---

## 4. Add a Categories/Tags Sidebar or Filter Bar

### Fetch all categories

```cypher
MATCH (d:DocumentVersion)
WHERE d.ai_category IS NOT NULL
RETURN d.ai_category AS category, count(*) AS count
ORDER BY count DESC
```

Returns something like:
```json
[
  { "category": "geometry", "count": 245 },
  { "category": "mesh", "count": 132 },
  { "category": "fabrication", "count": 98 },
  ...
]
```

### Fetch top tags

```cypher
MATCH (d:DocumentVersion)
WHERE d.ai_tags IS NOT NULL
UNWIND d.ai_tags AS tag
RETURN tag, count(*) AS count
ORDER BY count DESC
LIMIT 30
```

### Filter UI example

```tsx
{/* Category filter bar */}
<div className="flex flex-wrap gap-2 mb-4">
  {categories.map(c => (
    <a
      key={c.category}
      href={`/?category=${c.category}`}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        activeCategory === c.category
          ? "bg-blue-600 text-white"
          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
      }`}
    >
      {c.category} ({c.count})
    </a>
  ))}
</div>
```

---

## 5. Analytics Page Ideas

The enriched data enables these visualizations:

### Category distribution
```cypher
MATCH (d:DocumentVersion)
WHERE d.ai_category IS NOT NULL
RETURN d.ai_category AS category, count(*) AS count
ORDER BY count DESC
```

### Most common tags (word cloud / bar chart)
```cypher
MATCH (d:DocumentVersion)
WHERE d.ai_tags IS NOT NULL
UNWIND d.ai_tags AS tag
RETURN tag, count(*) AS count
ORDER BY count DESC
LIMIT 50
```

### Plugin popularity
```cypher
MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d:DocumentVersion)
MATCH (p:Plugin)-[:PluginToPluginVer]->(pv)
RETURN p.Name AS plugin, count(DISTINCT d) AS scriptCount
ORDER BY scriptCount DESC
LIMIT 20
```

### Scripts by confidence level
```cypher
MATCH (d:DocumentVersion)
WHERE d.ai_confidence IS NOT NULL
RETURN
  CASE
    WHEN d.ai_confidence >= 0.9 THEN 'High (≥90%)'
    WHEN d.ai_confidence >= 0.7 THEN 'Medium (70-89%)'
    WHEN d.ai_confidence >= 0.5 THEN 'Low (50-69%)'
    ELSE 'Very Low (<50%)'
  END AS level,
  count(*) AS count
ORDER BY count DESC
```

### Average complexity by category
```cypher
MATCH (d:DocumentVersion)
WHERE d.ai_category IS NOT NULL
OPTIONAL MATCH (ci:ComponentInstance {VersionId: d.VersionId})
WITH d.ai_category AS category, d, count(ci) AS components
RETURN category,
       count(d) AS scripts,
       avg(components) AS avgComponents,
       max(components) AS maxComponents
ORDER BY scripts DESC
```

---

## Quick Reference: Property Names

When writing Cypher queries, use the exact Neo4j property names:

```
d.ai_description   →  string
d.ai_flow           →  string
d.ai_tags           →  string[]
d.ai_category       →  string
d.ai_confidence     →  float (0.0 – 1.0)
d.ai_inputs         →  string[]
d.ai_outputs        →  string[]
d.embedding         →  float[] (1536 dims, for vector search only)
```

All properties are prefixed with `ai_` to distinguish them from the original imported data. The `embedding` property is used internally by the search API and doesn't need to be displayed.

---

## Testing Queries

You can test any of these queries in the Neo4j Browser at http://localhost:7474. Some quick checks:

```cypher
// Check enrichment coverage
MATCH (d:DocumentVersion)
RETURN count(d) AS total,
       count(d.ai_description) AS enriched,
       count(d.embedding) AS withEmbeddings

// Sample a few enriched documents
MATCH (d:DocumentVersion)
WHERE d.ai_description IS NOT NULL
RETURN d.FileName, d.ai_description, d.ai_flow, d.ai_tags, d.ai_category
LIMIT 5

// Find scripts by tag
MATCH (d:DocumentVersion)
WHERE 'voronoi' IN d.ai_tags
RETURN d.FileName, d.ai_description, d.ai_flow
```
