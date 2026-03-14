# GH Script Finder API — Integration Guide

Base URL: `http://172.29.36.59:8000`

Swagger docs: `http://172.29.36.59:8000/docs`

## Endpoints

### Search scripts (main feature)

```
POST /api/search
Content-Type: application/json

{
  "query": "voronoi nesting",
  "max_results": 10,
  "min_confidence": 0.3
}
```

Response:

```json
{
  "query": "voronoi nesting",
  "total_found": 2,
  "search_params": { "keywords": [...], "tags": [...], "category": "..." },
  "results": [
    {
      "document_id": "daec1fd2-...",
      "version_id": "998ecf77-...",
      "file_name": "ShapeDiver+OpenNest.ghx",
      "file_path": "C:\\...\\ShapeDiver+OpenNest.ghx",
      "description": "Parametric design that optimizes layout of 2D shapes for nesting...",
      "tags": ["parametric", "nesting", "fabrication"],
      "category": "fabrication",
      "confidence": 0.9,
      "inputs": ["number slider (count)", "rectangle (boundary)"],
      "outputs": ["nested geometry", "ShapeDiver export download"],
      "flow": "Rectangle → Populate 2D → Voronoi → Project → OpenNest → ShapeDiverExport",
      "plugins": ["ShapeDiver", "OpenNest"],
      "match_explanation": "Uses OpenNest to optimize layout of 2D voronoi shapes..."
    }
  ]
}
```

### Browse scripts

```
GET /api/scripts?skip=0&limit=20&category=fabrication&tag=mesh
```

All query parameters are optional. Returns `{ scripts: [...], total, skip, limit }`.

### Script detail

```
GET /api/scripts/{version_id}
```

Returns full detail including plugins (with descriptions), related documents, component count, wire count.

### Tags

```
GET /api/tags
```

Returns `[{ "tag": "geometry", "count": 378 }, ...]` sorted by count.

### Categories

```
GET /api/categories
```

Returns `[{ "category": "fabrication", "count": 168 }, ...]` sorted by count.

### Health check

```
GET /api/health
```

Returns `{ "status": "ok", "total_nodes": 122251 }`.

## Integration with Spaghettarium

The API returns `document_id` and `version_id` which match the identifiers used in Spaghettarium's Neo4j queries.

Example: calling the search API from a React Router loader:

```typescript
// app/routes/search.tsx
import type { Route } from "./+types/search";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";

  if (!query) return { results: [], query: "" };

  const res = await fetch("http://172.29.36.59:8000/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, max_results: 20 }),
  });

  const data = await res.json();
  return { results: data.results, query };
}

export default function Search({ loaderData }: Route.ComponentProps) {
  const { results, query } = loaderData;

  return (
    <div>
      <h1>Search Results for "{query}"</h1>
      {results.map((r) => (
        <div key={r.version_id}>
          <a href={`/script/${r.version_id}`}>
            <h2>{r.file_name}</h2>
          </a>
          <p>{r.description}</p>
          <p><strong>Flow:</strong> {r.flow}</p>
          <p><strong>Tags:</strong> {r.tags.join(", ")}</p>
          <p><strong>Why:</strong> {r.match_explanation}</p>
        </div>
      ))}
    </div>
  );
}
```

## Data available on each script

| Field | Type | Description |
|-------|------|-------------|
| `document_id` | string | Grasshopper document UUID |
| `version_id` | string | Version UUID (unique per file version) |
| `file_name` | string | Filename (e.g. `ShapeDiver+OpenNest.ghx`) |
| `file_path` | string | Full local path to the file |
| `description` | string | AI-generated description of what the script does |
| `tags` | string[] | 3-8 tags (e.g. `["nesting", "fabrication"]`) |
| `category` | string | One of: geometry, mesh, data, display, interop, analysis, optimization, fabrication, simulation, utility, other |
| `confidence` | float | 0.0-1.0 AI confidence score |
| `inputs` | string[] | User-facing inputs (sliders, toggles, geometry) |
| `outputs` | string[] | What the script produces (geometry, exports) |
| `flow` | string | Data flow pipeline (e.g. `"Slider → Voronoi → OpenNest → Export"`) |
| `plugins` | string[] | Grasshopper plugins used |
| `match_explanation` | string | Why this result matches the search query (search only) |

## CORS

CORS is fully open (`*`), so you can call the API from any origin.
