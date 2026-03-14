"""
Neo4j Graph Enrichment Script using OpenAI API
================================================
Reads PluginVersion, ComponentDefinition, and DocumentVersion nodes from Neo4j,
enriches them with AI-generated tags/descriptions, and writes back to the graph.

Requirements:
    pip install neo4j openai

Usage:
    export OPENAI_API_KEY="sk-..."
    export NEO4J_URI="neo4j+s://xxxxx.databases.neo4j.io"
    export NEO4J_USER="neo4j"
    export NEO4J_PASSWORD="your-password"
    python enrich_graph.py
"""

import os
import json
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from dotenv import load_dotenv
from neo4j import GraphDatabase
from openai import OpenAI

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://127.0.0.1:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")  # cheap + fast, swap to gpt-4o if needed
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() == "true"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

client = OpenAI(api_key=OPENAI_API_KEY)


# ---------------------------------------------------------------------------
# OpenAI helpers
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """You are an expert in the Grasshopper visual programming environment for Rhino 3D.
You know all popular plugins, components, and their purposes in architecture, engineering, and computational design.

When given a plugin or component name, return ONLY valid JSON (no markdown fences) with this schema:
{
  "description": "1-2 sentence description of what this does",
  "tags": ["tag1", "tag2", ...],       // 3-8 lowercase tags describing functionality
  "category": "one of: geometry, mesh, data, display, interop, analysis, optimization, fabrication, simulation, utility, other",
  "confidence": 0.0-1.0                // how confident you are in this enrichment
}

If you don't recognize something, set confidence below 0.5 and give your best guess based on the name."""

DOC_SYSTEM_PROMPT = """You are an expert in the Grasshopper visual programming environment for Rhino 3D.
You analyze Grasshopper definition files (.gh/.ghx) based on their components, plugins, wiring, and file context.

Given details about a Grasshopper document, return ONLY valid JSON (no markdown fences) with this schema:
{
  "description": "2-3 sentence description of what this Grasshopper definition does, based on the components and plugins used",
  "tags": ["tag1", "tag2", ...],       // 3-8 lowercase tags describing functionality
  "category": "one of: geometry, mesh, data, display, interop, analysis, optimization, fabrication, simulation, utility, other",
  "confidence": 0.0-1.0,               // how confident you are in this enrichment
  "inputs": ["input1", "input2", ...],  // user-facing inputs (sliders, toggles, panels, geometry references, etc.)
  "outputs": ["output1", "output2", ...],  // final outputs (geometry, data, previews, exports, etc.)
  "flow": "Component A → Component B → Component C → Output"  // simplified data flow pipeline showing the main processing chain
}

For inputs, identify what the user controls (e.g. "width slider", "point grid", "material toggle").
For outputs, identify what the definition produces (e.g. "mesh surface", "baked geometry", "PDF export").
For flow, trace the main data processing chain from inputs to outputs using component names and arrows (→). Show the primary pipeline, not every branch. Example: "Number Slider → Populate 2D → Voronoi → Project → OpenNest → ShapeDiverExport"
Base your analysis on the component names, wire topology, and plugin context provided."""


def enrich_single(name: str, author: str | None, extra_context: str = "", system_prompt: str = None) -> dict:
    """Call OpenAI to enrich a single entity."""
    prompt = system_prompt or SYSTEM_PROMPT
    user_msg = f"Plugin/Component name: {name}"
    if author:
        user_msg += f"\nAuthor: {author}"
    if extra_context:
        user_msg += f"\n{extra_context}"

    try:
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.2,
            messages=[
                {"role": "system", "content": prompt},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content
        return json.loads(raw)
    except Exception as e:
        log.error(f"OpenAI error for '{name}': {e}")
        return None


def enrich_batch(items: list[dict], batch_size: int = 10) -> list[dict]:
    """Batch multiple items into one API call for efficiency."""
    user_msg = "Enrich the following Grasshopper plugins/components. Return a JSON array with one object per item, in the same order.\n\n"
    for i, item in enumerate(items):
        user_msg += f"{i+1}. Name: {item['name']}"
        if item.get("author"):
            user_msg += f" | Author: {item['author']}"
        if item.get("context"):
            user_msg += f" | Context: {item['context']}"
        user_msg += "\n"

    batch_system = SYSTEM_PROMPT.replace(
        "return ONLY valid JSON (no markdown fences) with this schema:",
        "return ONLY a valid JSON array (no markdown fences). Each element has this schema:"
    )

    try:
        response = client.chat.completions.create(
            model=OPENAI_MODEL,
            temperature=0.2,
            messages=[
                {"role": "system", "content": batch_system},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content
        parsed = json.loads(raw)
        # Handle both {"results": [...]} and direct array
        if isinstance(parsed, dict):
            for key in ("results", "items", "data", "enrichments"):
                if key in parsed:
                    return parsed[key]
            return list(parsed.values())[0] if parsed else []
        return parsed
    except Exception as e:
        log.error(f"OpenAI batch error: {e}")
        return []


# ---------------------------------------------------------------------------
# Neo4j read/write
# ---------------------------------------------------------------------------
def get_driver():
    return GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))


def fetch_plugins(driver) -> list[dict]:
    """Fetch PluginVersion nodes that haven't been enriched yet."""
    with driver.session() as session:
        result = session.run("""
            MATCH (p:PluginVersion)
            WHERE p.ai_description IS NULL
            RETURN elementId(p) AS elementId, p.Name AS name, p.Author AS author,
                   p.Version AS version, p.AssemblyName AS assembly
        """)
        return [dict(r) for r in result]


def fetch_component_definitions(driver) -> list[dict]:
    """Fetch ComponentDefinition nodes that haven't been enriched yet."""
    with driver.session() as session:
        result = session.run("""
            MATCH (cd:ComponentDefinition)
            WHERE cd.ai_description IS NULL
            OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToCompDef]->(cd)
            RETURN elementId(cd) AS elementId, cd.Name AS name, cd.ComponentGuid AS guid,
                   pv.Name AS pluginName
        """)
        return [dict(r) for r in result]


def fetch_documents(driver) -> list[dict]:
    """Fetch DocumentVersion nodes with rich context for enrichment."""
    with driver.session() as session:
        result = session.run("""
            MATCH (d:DocumentVersion)
            WHERE d.ai_description IS NULL
            OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
            WITH d, collect(DISTINCT {name: pv.Name, desc: pv.ai_description}) AS pluginDetails
            OPTIONAL MATCH (ci:ComponentInstance {VersionId: d.VersionId})
            WITH d, pluginDetails, collect(DISTINCT ci.ComponentName) AS componentNames
            OPTIONAL MATCH (d)-[:DocVerToDocVer]-(related:DocumentVersion)
            WITH d, pluginDetails, componentNames, collect(DISTINCT related.FileName) AS relatedDocs
            RETURN elementId(d) AS elementId, d.FileName AS fileName,
                   d.FilePath AS filePath, d.IsCluster AS isCluster,
                   d.VersionId AS versionId,
                   pluginDetails, componentNames, relatedDocs
        """)
        return [dict(r) for r in result]


def fetch_doc_wiring(driver, version_id: str) -> dict:
    """Fetch full wiring topology, inputs, and outputs for a document version."""
    with driver.session() as session:
        # Full wiring graph
        wires_result = session.run(
            "MATCH (src:ComponentInstance)-[w:Wire]->(tgt:ComponentInstance) "
            "WHERE src.VersionId = $vid AND tgt.VersionId = $vid "
            "RETURN src.ComponentName AS srcComp, src.InstanceName AS srcInst, "
            "w.SourceName AS srcPort, w.TargetName AS tgtPort, "
            "tgt.ComponentName AS tgtComp, tgt.InstanceName AS tgtInst",
            vid=version_id
        )
        wires = [dict(r) for r in wires_result]

        # Inputs: components with no incoming wires
        inputs_result = session.run(
            "MATCH (ci:ComponentInstance) "
            "WHERE ci.VersionId = $vid AND NOT ()-[:Wire]->(ci) "
            "RETURN DISTINCT ci.ComponentName AS name, ci.InstanceName AS instanceName",
            vid=version_id
        )
        inputs = [dict(r) for r in inputs_result]

        # Outputs: components with no outgoing wires
        outputs_result = session.run(
            "MATCH (ci:ComponentInstance) "
            "WHERE ci.VersionId = $vid AND NOT (ci)-[:Wire]->() "
            "RETURN DISTINCT ci.ComponentName AS name, ci.InstanceName AS instanceName",
            vid=version_id
        )
        outputs = [dict(r) for r in outputs_result]

    return {"wires": wires, "inputs": inputs, "outputs": outputs}


def format_wiring_summary(wiring: dict, max_wires: int = 60) -> str:
    """Format wiring data into a readable summary for the LLM."""
    lines = []

    # Wiring topology
    wires = wiring.get("wires", [])
    if wires:
        lines.append(f"Wiring topology ({len(wires)} connections):")
        for w in wires[:max_wires]:
            src = w["srcInst"] or w["srcComp"]
            tgt = w["tgtInst"] or w["tgtComp"]
            lines.append(f"  {src} [{w['srcPort']}] --> [{w['tgtPort']}] {tgt}")
        if len(wires) > max_wires:
            lines.append(f"  ... and {len(wires) - max_wires} more connections")

    # Inputs
    inputs = wiring.get("inputs", [])
    if inputs:
        input_names = [i["instanceName"] or i["name"] for i in inputs if i.get("name")]
        lines.append(f"Source components (no incoming wires): {', '.join(input_names[:30])}")

    # Outputs
    outputs = wiring.get("outputs", [])
    if outputs:
        output_names = [o["instanceName"] or o["name"] for o in outputs if o.get("name")]
        lines.append(f"Sink components (no outgoing wires): {', '.join(output_names[:30])}")

    return "\n".join(lines)


def write_enrichment(driver, element_id: str, enrichment: dict):
    """Write enrichment data back to a node."""
    if not enrichment:
        return
    params = {
        "elementId": element_id,
        "description": enrichment.get("description", ""),
        "tags": enrichment.get("tags", []),
        "category": enrichment.get("category", "other"),
        "confidence": enrichment.get("confidence", 0.0),
    }
    # Include inputs/outputs/flow for document nodes
    has_doc_fields = "inputs" in enrichment or "outputs" in enrichment
    if has_doc_fields:
        params["inputs"] = enrichment.get("inputs", [])
        params["outputs"] = enrichment.get("outputs", [])
        params["flow"] = enrichment.get("flow", "")

    query = """
        MATCH (n) WHERE elementId(n) = $elementId
        SET n.ai_description = $description,
            n.ai_tags = $tags,
            n.ai_category = $category,
            n.ai_confidence = $confidence
    """
    if has_doc_fields:
        query += """,
            n.ai_inputs = $inputs,
            n.ai_outputs = $outputs,
            n.ai_flow = $flow
    """

    with driver.session() as session:
        session.run(query, params)


# ---------------------------------------------------------------------------
# Enrichment pipeline
# ---------------------------------------------------------------------------
def enrich_plugins(driver):
    plugins = fetch_plugins(driver)
    log.info(f"Found {len(plugins)} PluginVersion nodes to enrich")
    if not plugins:
        return

    for plugin in plugins:
        enrichment = enrich_single(
            name=plugin["name"],
            author=plugin.get("author"),
            extra_context=f"Version: {plugin.get('version', 'unknown')}" if plugin.get("version") else "",
        )
        if enrichment:
            log.info(f"  Plugin: {plugin['name']} -> {enrichment.get('tags', [])}")
            if not DRY_RUN:
                write_enrichment(driver, plugin["elementId"], enrichment)


def enrich_component_definitions(driver):
    comps = fetch_component_definitions(driver)
    log.info(f"Found {len(comps)} ComponentDefinition nodes to enrich")
    if not comps:
        return

    for comp in comps:
        enrichment = enrich_single(
            name=comp["name"],
            author=None,
            extra_context=f"Part of plugin: {comp['pluginName']}" if comp.get("pluginName") else "",
        )
        if enrichment:
            log.info(f"  Component: {comp['name']} -> {enrichment.get('tags', [])}")
            if not DRY_RUN:
                write_enrichment(driver, comp["elementId"], enrichment)


def _build_doc_context(doc, driver) -> str:
    """Build rich context string for a document."""
    context = f"Grasshopper definition file: {doc.get('fileName', 'unknown')}"

    if doc.get("isCluster"):
        context += "\nThis is a cluster (reusable sub-definition embedded in other documents)."

    # Plugin details with their AI descriptions
    plugin_details = doc.get("pluginDetails", [])
    plugin_lines = []
    for p in plugin_details:
        if p.get("name"):
            line = p["name"]
            if p.get("desc"):
                line += f" - {p['desc']}"
            plugin_lines.append(line)
    if plugin_lines:
        context += f"\nPlugins used:\n" + "\n".join(f"  - {l}" for l in plugin_lines)

    # Component names used in the document
    comp_names = [c for c in doc.get("componentNames", []) if c]
    if comp_names:
        context += f"\nComponents used ({len(comp_names)} total): {', '.join(comp_names[:50])}"
        if len(comp_names) > 50:
            context += f" ... and {len(comp_names) - 50} more"

    # Full wiring topology analysis
    if doc.get("versionId"):
        wiring = fetch_doc_wiring(driver, doc["versionId"])
        wiring_summary = format_wiring_summary(wiring)
        if wiring_summary:
            context += f"\n{wiring_summary}"

    # Related documents (clusters or parent docs)
    related = [r for r in doc.get("relatedDocs", []) if r]
    if related:
        context += f"\nRelated documents: {', '.join(related)}"

    if doc.get("filePath"):
        parts = doc["filePath"].replace("\\", "/").split("/")
        relevant = [p for p in parts if p not in ("C:", "Users", "Documents", "dev", "")]
        context += f"\nPath hints: {' > '.join(relevant[-4:])}"

    return context


def _enrich_one_doc(doc, driver):
    """Enrich a single document. Returns (doc, enrichment)."""
    context = _build_doc_context(doc, driver)
    enrichment = enrich_single(
        name=doc.get("fileName", "unknown"),
        author=None,
        extra_context=context,
        system_prompt=DOC_SYSTEM_PROMPT,
    )
    return doc, enrichment


def enrich_documents(driver, max_workers: int = 10):
    docs = fetch_documents(driver)
    log.info(f"Found {len(docs)} DocumentVersion nodes to enrich")
    if not docs:
        return

    # Group by filename to skip duplicates
    unique_docs = {}  # fileName -> first doc
    duplicate_docs = {}  # fileName -> list of duplicate docs
    for doc in docs:
        fname = doc.get("fileName") or doc.get("elementId")
        if fname not in unique_docs:
            unique_docs[fname] = doc
            duplicate_docs[fname] = []
        else:
            duplicate_docs[fname].append(doc)

    total_unique = len(unique_docs)
    total_dupes = sum(len(v) for v in duplicate_docs.values())
    log.info(f"  Unique documents: {total_unique}, duplicates to copy: {total_dupes}")

    # Enrich unique documents concurrently
    enriched = 0
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(_enrich_one_doc, doc, driver): fname
            for fname, doc in unique_docs.items()
        }

        for future in as_completed(futures):
            fname = futures[future]
            try:
                doc, enrichment = future.result()
            except Exception as e:
                log.error(f"  Failed: {fname}: {e}")
                continue

            if enrichment:
                enriched += 1
                log.info(f"  [{enriched}/{total_unique}] {doc.get('fileName')}")
                log.info(f"    Flow: {enrichment.get('flow', 'N/A')}")
                if not DRY_RUN:
                    # Write to the primary doc
                    write_enrichment(driver, doc["elementId"], enrichment)
                    # Copy to duplicates
                    for dupe in duplicate_docs.get(fname, []):
                        write_enrichment(driver, dupe["elementId"], enrichment)

    log.info(f"  Enriched {enriched} unique docs, copied to {total_dupes} duplicates")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main():
    log.info("=" * 60)
    log.info("Neo4j Graph Enrichment via OpenAI")
    log.info(f"Model: {OPENAI_MODEL} | Dry run: {DRY_RUN}")
    log.info("=" * 60)

    driver = get_driver()

    try:
        # Verify connectivity
        with driver.session() as session:
            result = session.run("MATCH (n) RETURN count(n) AS total")
            total = result.single()["total"]
            log.info(f"Connected to Neo4j. Total nodes: {total}")

        # Layer 1: Plugins (highest value, lowest volume)
        log.info("\n--- Layer 1: Enriching PluginVersions ---")
        enrich_plugins(driver)

        # Layer 2: Component Definitions
        log.info("\n--- Layer 2: Enriching ComponentDefinitions ---")
        enrich_component_definitions(driver)

        # Layer 3: Documents (inferred from connected plugins + path)
        log.info("\n--- Layer 3: Enriching DocumentVersions ---")
        enrich_documents(driver)

        log.info("\nDone!")

    finally:
        driver.close()


if __name__ == "__main__":
    main()
