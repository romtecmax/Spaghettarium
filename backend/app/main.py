"""
FastAPI application for Grasshopper Script Finder.
"""

import json
import os
import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Query, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from neo4j import GraphDatabase
from openai import OpenAI

from pathlib import Path

from .models import (
    SearchRequest, SearchResponse, ScriptResult,
    ScriptDetail, TagCount, CategoryCount,
)
from .search import interpret_query, search_neo4j, explain_results, get_query_embedding
from .importer import get_job, start_pipeline, UPLOAD_DIR
from .launcher import launch_in_grasshopper

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

NEO4J_URI = os.environ["NEO4J_URI"]
NEO4J_USER = os.environ.get("NEO4J_USERNAME", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")
logging.info(f"{NEO4J_URI}, {NEO4J_PASSWORD}, {NEO4J_USER}")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

# Directories where .gh/.ghx files may be stored
BACKEND_DIR = Path(__file__).resolve().parent.parent
# Flat directories checked first (fast), then recursive roots searched as fallback
GH_FILE_DIRS_FLAT = [
    UPLOAD_DIR,
    BACKEND_DIR / "data" / "scraped" / "gh_files",
    BACKEND_DIR / "data" / "import" / "gh_files",
    Path(os.environ.get("GH_FILES_DIR", BACKEND_DIR.parent.parent / "neo4j-grasshopper-graph" / "data" / "scraped" / "gh_files")),
]
# Root directories to search recursively if flat lookup fails
GH_FILE_DIRS_RECURSIVE = [
    Path(os.environ.get("GH_DATA_ROOT", BACKEND_DIR.parent.parent / "neo4j-grasshopper-graph" / "data")),
    BACKEND_DIR / "data",
]

# Yak mapping file
YAK_MAPPING_FILE = Path(__file__).resolve().parent / "yak_mapping.json"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage Neo4j driver and OpenAI client lifecycle."""
    app.state.neo4j_driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    app.state.openai_client = OpenAI(api_key=OPENAI_API_KEY)
    app.state.openai_model = OPENAI_MODEL

    # Load Yak plugin mapping from JSON (manual overrides)
    if YAK_MAPPING_FILE.exists():
        with open(YAK_MAPPING_FILE) as f:
            data = json.load(f)
        yak_mapping = {m["pluginId"]: m for m in data["mappings"]}
        log.info(f"Loaded {len(yak_mapping)} manual Yak plugin mappings")
    else:
        yak_mapping = {}
        log.warning(f"Yak mapping file not found: {YAK_MAPPING_FILE}")

    # Auto-populate from Neo4j: discover all plugins and merge
    try:
        with app.state.neo4j_driver.session() as session:
            result = session.run("""
                MATCH (p:Plugin)-[:PluginToPluginVer]->(pv:PluginVersion)
                RETURN DISTINCT p.PluginId AS pluginId, p.Name AS pluginName,
                       p.Author AS author, collect(DISTINCT pv.Version) AS versions
            """)
            new_count = 0
            for record in result:
                pid = record["pluginId"]
                if pid and pid not in yak_mapping:
                    yak_mapping[pid] = {
                        "pluginId": pid,
                        "pluginName": record["pluginName"] or "Unknown",
                        "yakPackage": record["pluginName"],
                        "yakAvailable": False,
                        "notes": "Auto-discovered from Neo4j — verify Yak availability and set yakAvailable to true",
                        "author": record["author"] or "",
                        "versions": record["versions"] or [],
                    }
                    new_count += 1
            if new_count:
                log.info(f"Auto-discovered {new_count} unmapped plugins from Neo4j")
    except Exception as e:
        log.warning(f"Failed to auto-populate plugins from Neo4j: {e}")

    app.state.yak_mapping = yak_mapping
    log.info(f"Total Yak plugin mappings: {len(yak_mapping)}")
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

@app.get("/")
def index():
    return health_check()

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


# ---------------------------------------------------------------------------
# Launcher / file download
# ---------------------------------------------------------------------------

_gh_file_cache: dict[str, Path] = {}


def _find_gh_file(file_name: str) -> Path | None:
    """Look for a .gh/.ghx file — flat dirs first, then recursive search."""
    if file_name in _gh_file_cache:
        cached = _gh_file_cache[file_name]
        if cached.is_file():
            return cached

    # Fast: check flat directories
    for d in GH_FILE_DIRS_FLAT:
        candidate = d / file_name
        if candidate.is_file():
            _gh_file_cache[file_name] = candidate
            return candidate

    # Slow fallback: recursive search through data roots
    for root in GH_FILE_DIRS_RECURSIVE:
        if not root.is_dir():
            continue
        for match in root.rglob(file_name):
            if match.is_file():
                _gh_file_cache[file_name] = match
                return match

    return None


@app.get("/api/scripts/{version_id}/file")
def download_script_file(version_id: str):
    """Download the .gh/.ghx file for a script."""
    driver = app.state.neo4j_driver
    with driver.session() as session:
        result = session.run(
            "MATCH (d:DocumentVersion {VersionId: $vid}) RETURN d.FileName AS fileName",
            vid=version_id,
        )
        record = result.single()
    if not record or not record["fileName"]:
        raise HTTPException(status_code=404, detail="Script not found")

    file_name = record["fileName"]
    path = _find_gh_file(file_name)
    if not path:
        raise HTTPException(status_code=404, detail=f"File not found locally: {file_name}")

    return FileResponse(
        path=str(path),
        filename=file_name,
        media_type="application/octet-stream",
    )


@app.post("/api/scripts/{version_id}/launch")
def launch_script(version_id: str):
    """Install required plugins via Yak and open the script in Rhino/Grasshopper."""
    driver = app.state.neo4j_driver
    with driver.session() as session:
        result = session.run("""
            MATCH (d:DocumentVersion {VersionId: $vid})
            OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
            RETURN d.FileName AS fileName,
                   collect({pluginId: pv.PluginId, name: pv.Name, version: pv.Version}) AS plugins
        """, vid=version_id)
        record = result.single()

    if not record or not record["fileName"]:
        raise HTTPException(status_code=404, detail="Script not found")

    file_name = record["fileName"]
    gh_path = _find_gh_file(file_name)
    if not gh_path:
        raise HTTPException(status_code=404, detail=f"File not found locally: {file_name}")

    plugins = [dict(p) for p in record["plugins"] if p.get("pluginId")]

    result = launch_in_grasshopper(
        gh_file=gh_path,
        plugins=plugins,
        yak_mapping=app.state.yak_mapping,
    )

    if not result["success"]:
        raise HTTPException(status_code=500, detail=result["error"])

    return result


@app.get("/api/yak-mapping")
def get_yak_mapping():
    """Return the current plugin-to-Yak mapping table."""
    mappings = list(app.state.yak_mapping.values())
    manual_count = sum(1 for m in mappings if "Auto-discovered" not in (m.get("notes") or ""))
    auto_count = len(mappings) - manual_count
    return {
        "mappings": mappings,
        "total": len(mappings),
        "manual": manual_count,
        "auto_discovered": auto_count,
    }


@app.put("/api/yak-mapping/{plugin_id}")
def update_yak_mapping(plugin_id: str, update: dict):
    """Update a single plugin's Yak mapping and persist to disk.

    Body example: {"yakPackage": "Kangaroo2", "yakAvailable": true, "notes": ""}
    """
    if plugin_id not in app.state.yak_mapping:
        raise HTTPException(status_code=404, detail="Plugin not found in mapping")

    entry = app.state.yak_mapping[plugin_id]
    for key in ("yakPackage", "yakAvailable", "notes"):
        if key in update:
            entry[key] = update[key]

    # Persist manual mappings back to JSON
    _save_yak_mapping(app.state.yak_mapping)
    return entry


def _save_yak_mapping(mapping: dict):
    """Write the mapping table back to yak_mapping.json (only manually-curated entries)."""
    # Save all entries (both manual and auto-discovered that have been updated)
    data = {"mappings": list(mapping.values())}
    with open(YAK_MAPPING_FILE, "w") as f:
        json.dump(data, f, indent=2, default=str)
    log.info(f"Saved {len(data['mappings'])} Yak mappings to {YAK_MAPPING_FILE}")


# ---------------------------------------------------------------------------
# Import pipeline
# ---------------------------------------------------------------------------

@app.post("/api/import/upload")
async def upload_and_import(files: list[UploadFile] = File(...)):
    """Upload .gh/.ghx files and start the import pipeline."""
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    saved: list[Path] = []
    for f in files:
        if not f.filename:
            continue
        ext = Path(f.filename).suffix.lower()
        if ext not in (".gh", ".ghx"):
            continue
        dest = UPLOAD_DIR / f.filename
        content = await f.read()
        dest.write_bytes(content)
        saved.append(dest)

    if not saved:
        raise HTTPException(status_code=400, detail="No valid .gh/.ghx files provided")

    try:
        start_pipeline(saved)
        return {"status": "started", "files": [p.name for p in saved]}
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))


@app.get("/api/import/status")
def import_status():
    """Get the current import pipeline status."""
    return get_job().to_dict()
