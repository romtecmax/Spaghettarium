"""
FastAPI application for Grasshopper Script Finder.
"""

import os
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from neo4j import GraphDatabase
from openai import OpenAI

from .models import (
    SearchRequest, SearchResponse, ScriptResult,
    ScriptDetail, TagCount, CategoryCount,
)
from .search import interpret_query, search_neo4j, explain_results, get_query_embedding

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://127.0.0.1:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage Neo4j driver and OpenAI client lifecycle."""
    app.state.neo4j_driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    app.state.openai_client = OpenAI(api_key=OPENAI_API_KEY)
    app.state.openai_model = OPENAI_MODEL
    log.info(f"Connected to Neo4j at {NEO4J_URI}")
    yield
    app.state.neo4j_driver.close()
    log.info("Neo4j driver closed")


app = FastAPI(
    title="GH Script Finder",
    description="AI-powered search for Grasshopper scripts in a Neo4j graph database",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/api/health")
def health_check():
    """Verify Neo4j connectivity."""
    try:
        with app.state.neo4j_driver.session() as session:
            total = session.run("MATCH (n) RETURN count(n) AS c").single()["c"]
        return {"status": "ok", "total_nodes": total}
    except Exception as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.post("/api/search", response_model=SearchResponse)
def search_scripts(req: SearchRequest):
    """AI-powered natural language search for Grasshopper scripts."""
    driver = app.state.neo4j_driver
    client = app.state.openai_client
    model = app.state.openai_model

    # Step 1: Interpret query
    params = interpret_query(client, model, req.query)
    log.info(f"Search: '{req.query}' -> {params}")

    # Step 1b: Generate query embedding for vector search
    try:
        query_embedding = get_query_embedding(client, req.query)
    except Exception as e:
        log.warning(f"Embedding generation failed, skipping vector search: {e}")
        query_embedding = None

    # Step 2: Search Neo4j
    raw_results = search_neo4j(driver, params, req.max_results, req.min_confidence, query_embedding)

    # Step 3: Explain results
    explanations = explain_results(client, model, req.query, raw_results)

    # Build response
    results = []
    for i, r in enumerate(raw_results):
        results.append(ScriptResult(
            document_id=r["documentId"],
            version_id=r["versionId"],
            file_name=r.get("fileName"),
            file_path=r.get("filePath"),
            description=r.get("description"),
            tags=r.get("tags") or [],
            category=r.get("category"),
            confidence=r.get("confidence"),
            inputs=r.get("inputs") or [],
            outputs=r.get("outputs") or [],
            flow=r.get("flow"),
            plugins=r.get("plugins") or [],
            match_explanation=explanations[i] if i < len(explanations) else "",
        ))

    return SearchResponse(
        query=req.query,
        results=results,
        total_found=len(results),
        search_params=params,
    )


@app.get("/api/scripts")
def list_scripts(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    category: str | None = None,
    tag: str | None = None,
):
    """List all enriched scripts with optional filtering."""
    driver = app.state.neo4j_driver

    where_clauses = ["d.ai_description IS NOT NULL"]
    params = {"skip": skip, "limit": limit}

    if category:
        where_clauses.append("d.ai_category = $category")
        params["category"] = category
    if tag:
        where_clauses.append("$tag IN d.ai_tags")
        params["tag"] = tag

    where = " AND ".join(where_clauses)

    with driver.session() as session:
        result = session.run(f"""
            MATCH (d:DocumentVersion)
            WHERE {where}
            OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
            WITH d, collect(DISTINCT pv.Name) AS plugins
            RETURN d.DocumentId AS documentId, d.VersionId AS versionId,
                   d.FileName AS fileName, d.FilePath AS filePath,
                   d.ai_description AS description, d.ai_tags AS tags,
                   d.ai_category AS category, d.ai_confidence AS confidence,
                   d.ai_inputs AS inputs, d.ai_outputs AS outputs,
                   d.ai_flow AS flow, plugins
            ORDER BY d.FileName
            SKIP $skip LIMIT $limit
        """, params)
        scripts = [dict(r) for r in result]

        # Get total count
        count_result = session.run(f"""
            MATCH (d:DocumentVersion) WHERE {where} RETURN count(d) AS total
        """, params)
        total = count_result.single()["total"]

    return {"scripts": scripts, "total": total, "skip": skip, "limit": limit}


@app.get("/api/scripts/{version_id}", response_model=ScriptDetail)
def get_script_detail(version_id: str):
    """Get full detail for a single script by VersionId."""
    driver = app.state.neo4j_driver

    with driver.session() as session:
        result = session.run("""
            MATCH (d:DocumentVersion) WHERE d.VersionId = $vid
            OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
            WITH d, collect(DISTINCT {name: pv.Name, description: pv.ai_description, tags: pv.ai_tags}) AS plugins
            OPTIONAL MATCH (d)-[:DocVerToDocVer]-(related:DocumentVersion)
            WITH d, plugins, collect(DISTINCT related.FileName) AS relatedDocs
            OPTIONAL MATCH (ci:ComponentInstance {VersionId: d.VersionId})
            WITH d, plugins, relatedDocs, count(ci) AS compCount
            OPTIONAL MATCH (src:ComponentInstance {VersionId: d.VersionId})-[:Wire]->(tgt:ComponentInstance {VersionId: d.VersionId})
            WITH d, plugins, relatedDocs, compCount, count(*) AS wireCount
            RETURN d.DocumentId AS documentId, d.VersionId AS versionId,
                   d.FileName AS fileName, d.FilePath AS filePath,
                   d.ai_description AS description, d.ai_tags AS tags,
                   d.ai_category AS category, d.ai_confidence AS confidence,
                   d.ai_inputs AS inputs, d.ai_outputs AS outputs,
                   d.ai_flow AS flow, d.IsCluster AS isCluster,
                   plugins, relatedDocs, compCount, wireCount
        """, vid=version_id)

        record = result.single()
        if not record:
            raise HTTPException(status_code=404, detail="Script not found")

    return ScriptDetail(
        document_id=record["documentId"],
        version_id=record["versionId"],
        file_name=record.get("fileName"),
        file_path=record.get("filePath"),
        description=record.get("description"),
        tags=record.get("tags") or [],
        category=record.get("category"),
        confidence=record.get("confidence"),
        inputs=record.get("inputs") or [],
        outputs=record.get("outputs") or [],
        flow=record.get("flow"),
        plugins=record.get("plugins") or [],
        related_docs=[d for d in (record.get("relatedDocs") or []) if d],
        component_count=record.get("compCount") or 0,
        wire_count=record.get("wireCount") or 0,
        is_cluster=record.get("isCluster"),
    )


@app.get("/api/tags", response_model=list[TagCount])
def get_tags():
    """Get all unique tags with counts."""
    driver = app.state.neo4j_driver
    with driver.session() as session:
        result = session.run("""
            MATCH (d:DocumentVersion)
            WHERE d.ai_tags IS NOT NULL
            UNWIND d.ai_tags AS tag
            RETURN tag, count(*) AS count
            ORDER BY count DESC
        """)
        return [TagCount(tag=r["tag"], count=r["count"]) for r in result]


@app.get("/api/categories", response_model=list[CategoryCount])
def get_categories():
    """Get all categories with counts."""
    driver = app.state.neo4j_driver
    with driver.session() as session:
        result = session.run("""
            MATCH (d:DocumentVersion)
            WHERE d.ai_category IS NOT NULL
            RETURN d.ai_category AS category, count(*) AS count
            ORDER BY count DESC
        """)
        return [CategoryCount(category=r["category"], count=r["count"]) for r in result]
