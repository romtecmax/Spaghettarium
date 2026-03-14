# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Graph database model of Grasshopper plugin-to-document relationships with AI-powered enrichment. Grasshopper is a visual programming environment for Rhino 3D used in computational design. The project imports graph data into Neo4j, enriches nodes with OpenAI-generated metadata, and provides dashboard queries for visualization.

## Commands

```bash
# Setup
pip install -r requirements.txt
cp .env.example .env  # then fill in credentials

# Import graph into Neo4j
# Run import-graph.cypher in Neo4j Browser

# Enrich graph with AI metadata (dry run first)
DRY_RUN=true python enrich_graph.py
python enrich_graph.py
```

There is no build step, test suite, or linter.

## Architecture

**Graph Schema — 5 node types:**
- `DocumentVersion` — Grasshopper definition files (.ghx)
- `PluginVersion` / `Plugin` — Plugin versions and parent plugin nodes
- `ComponentInstance` / `ComponentDefinition` — Component instances and their definitions

**Relationships:** `PluginVerToDocVer`, `PluginToPluginVer`, `DocVerToDocVer`, `Wire` (canvas wiring), `PluginVerToCompDef`

**Enrichment pipeline** (`enrich_graph.py`): Three-layer strategy — PluginVersion nodes first (high value, low volume), then ComponentDefinition (batched in groups of 10), then DocumentVersion (individual calls with context). Adds `ai_description`, `ai_tags`, `ai_category`, and `ai_confidence` properties. Skips already-enriched nodes (`ai_description IS NULL` filter).

**Key files:**
- `enrich_graph.py` — Main Python script: reads from Neo4j, calls OpenAI API, writes enrichment properties back
- `import-graph.cypher` — Creates constraints, nodes, and relationships
- `dashboard-queries.cypher` — 20 pre-enrichment dashboard card queries
- `enriched-dashboard-queries.cypher` — Dashboard queries using AI-generated tags

## Environment Variables (`.env`)

- `OPENAI_API_KEY` — Required
- `OPENAI_MODEL` — Defaults to `gpt-4o-mini`
- `NEO4J_URI`, `NEO4J_USER`, `NEO4J_PASSWORD` — Neo4j connection
- `DRY_RUN` — Set to `true` to preview enrichment without writing

## Dependencies

Python: `neo4j>=5.0.0`, `openai>=1.0.0`
