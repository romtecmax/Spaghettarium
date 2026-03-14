# Neo4j Grasshopper Graph

Graph database model of Grasshopper plugin ↔ document relationships, with AI-powered enrichment and dashboard queries for Neo4j.

## Structure

```
neo4j-grasshopper-graph/
├── data/                          # Source CSV exports from Neo4j
│   ├── graph-export.csv
│   ├── node-export.csv
│   └── relationship-export.csv
├── queries/
│   ├── import-graph.cypher        # Cypher script to import all nodes & relationships
│   ├── dashboard-queries.cypher   # 20 dashboard card queries (pre-enrichment)
│   └── enriched-dashboard-queries.cypher  # Dashboard queries using AI-generated tags
├── scripts/
│   └── enrich_graph.py            # OpenAI enrichment script
├── .env.example                   # Environment variables template
├── .gitignore
├── requirements.txt
└── README.md
```

## Graph Schema

### Node Labels
| Label | Count | Key Properties |
|-------|-------|---------------|
| DocumentVersion | 13 | FileName, FilePath, DocumentId, VersionId |
| PluginVersion | 5 | Name, Version, Author, PluginId, AssemblyName |
| ComponentInstance | 1 | InstanceName, ComponentName, ComponentGuid |
| ComponentDefinition | 1 | Name, ComponentGuid |
| Plugin | 1 | Name, Author, PluginId |

### Relationship Types
| Type | Description |
|------|-------------|
| PluginVerToDocVer | Plugin version used in a document version |
| PluginToPluginVer | Plugin to its version(s) |
| DocVerToDocVer | Parent ↔ child document clusters |
| Wire | Component instance connections (GH canvas wiring) |
| PluginVerToCompDef | Plugin version provides a component definition |

## Setup

### 1. Import data into Neo4j

1. Start your local Neo4j instance (default: `neo4j://127.0.0.1:7687`)
2. Open **Neo4j Browser** at [http://localhost:7474](http://localhost:7474)
3. Run `queries/import-graph.cypher` (constraints first, then nodes, then relationships)

### 2. Create dashboard cards

1. Open **Neo4j Browser** or **Neo4j Bloom**
2. Create a new dashboard
3. Add cards using queries from `queries/dashboard-queries.cypher`
4. Set each card's visualization type (graph, bar, pie, table, KPI)

### 3. Enrich with AI (optional)

```bash
pip install -r requirements.txt

# Copy and fill in your credentials
cp .env.example .env

# Dry run first
DRY_RUN=true python scripts/enrich_graph.py

# Run for real
python scripts/enrich_graph.py
```

This adds `ai_description`, `ai_tags`, `ai_category`, and `ai_confidence` properties to each node. Uses `gpt-4o-mini` by default — set `OPENAI_MODEL=gpt-4o` for higher quality.

After enrichment, use `queries/enriched-dashboard-queries.cypher` for tag-based filtering and category breakdowns.

### 4. Run the API server

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

The API will be available at `http://localhost:8000` (Swagger docs at `/docs`).

## Enrichment Properties

| Property | Type | Description |
|----------|------|-------------|
| ai_description | string | 1-2 sentence description |
| ai_tags | string[] | 3-8 lowercase functional tags |
| ai_category | string | geometry, mesh, data, display, interop, analysis, optimization, fabrication, simulation, utility, other |
| ai_confidence | float | 0.0-1.0 confidence score |
