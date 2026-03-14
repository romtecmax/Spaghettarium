"""
Search logic: interpret natural language queries, search Neo4j, explain results.
"""

import json
import logging
from openai import OpenAI

log = logging.getLogger(__name__)

INTERPRET_PROMPT = """You extract search parameters from natural language queries about Grasshopper 3D scripts.
Grasshopper is a visual programming environment for Rhino 3D used in architecture, engineering, and computational design.

Return ONLY valid JSON (no markdown fences) with this schema:
{
  "keywords": ["word1", "word2"],
  "tags": ["tag1", "tag2", "tag3"],
  "category": "geometry|mesh|data|display|interop|analysis|optimization|fabrication|simulation|utility|other|null",
  "input_hints": ["curve", "surface"],
  "output_hints": ["mesh", "panel"]
}

For tags, expand the user's query into likely matching tags (synonyms, related terms).
For category, pick the most likely one or null if unclear.
For input/output hints, infer what the script might take/produce."""

EXPLAIN_PROMPT = """You are given a user's search query and a numbered list of Grasshopper script results.
For EACH script (in the same order), write 1 sentence explaining why THAT SPECIFIC SCRIPT
is relevant to the query. Focus on what the script itself does, not other scripts.
If a script is not very relevant, say so honestly (e.g. "Only loosely related: ...").

IMPORTANT: Return exactly one explanation per script, in the same order as the input list.
Do NOT reference other scripts in an explanation. Each explanation must be self-contained.

Return ONLY valid JSON (no markdown fences):
{"explanations": ["reason for script 1", "reason for script 2", ...]}"""


def interpret_query(client: OpenAI, model: str, query: str) -> dict:
    """Use LLM to extract structured search parameters from natural language."""
    try:
        response = client.chat.completions.create(
            model=model,
            temperature=0.2,
            messages=[
                {"role": "system", "content": INTERPRET_PROMPT},
                {"role": "user", "content": query},
            ],
            response_format={"type": "json_object"},
        )
        return json.loads(response.choices[0].message.content)
    except Exception as e:
        log.error(f"Query interpretation failed: {e}")
        # Fallback: use the raw query words as keywords and tags
        words = query.lower().split()
        return {"keywords": words, "tags": words, "category": None, "input_hints": [], "output_hints": []}


SEARCH_QUERY = """
MATCH (d:DocumentVersion)
WHERE d.ai_description IS NOT NULL
  AND d.ai_confidence >= $min_confidence

// Score tag overlap
WITH d,
  [tag IN d.ai_tags WHERE tag IN $tags | tag] AS matched_tags

// Score keyword matches in description and flow
WITH d, matched_tags,
  REDUCE(score = 0, kw IN $keywords |
    CASE WHEN toLower(coalesce(d.ai_description, '')) CONTAINS toLower(kw) THEN score + 1 ELSE score END
  ) AS desc_score,
  REDUCE(score = 0, kw IN $keywords |
    CASE WHEN toLower(coalesce(d.ai_flow, '')) CONTAINS toLower(kw) THEN score + 1 ELSE score END
  ) AS flow_score

// Score category match
WITH d, matched_tags, desc_score, flow_score,
  CASE WHEN $category IS NOT NULL AND d.ai_category = $category THEN 2 ELSE 0 END AS category_score

// Score input/output hints
WITH d, matched_tags, desc_score, flow_score, category_score,
  REDUCE(score = 0, hint IN $input_hints |
    CASE WHEN ANY(inp IN coalesce(d.ai_inputs, []) WHERE toLower(inp) CONTAINS toLower(hint)) THEN score + 1 ELSE score END
  ) AS input_score,
  REDUCE(score = 0, hint IN $output_hints |
    CASE WHEN ANY(outp IN coalesce(d.ai_outputs, []) WHERE toLower(outp) CONTAINS toLower(hint)) THEN score + 1 ELSE score END
  ) AS output_score

// Combine scores
WITH d, matched_tags,
  (size(matched_tags) * 3 + desc_score * 2 + flow_score * 2 + category_score + input_score + output_score) AS total_score
WHERE total_score > 0

// Get related plugins
OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
WITH d, matched_tags, total_score, collect(DISTINCT pv.Name) AS plugins

RETURN d.DocumentId AS documentId, d.VersionId AS versionId,
       d.FileName AS fileName, d.FilePath AS filePath,
       d.ai_description AS description, d.ai_tags AS tags,
       d.ai_category AS category, d.ai_confidence AS confidence,
       d.ai_inputs AS inputs, d.ai_outputs AS outputs,
       d.ai_flow AS flow,
       plugins, total_score
ORDER BY total_score DESC
LIMIT $max_results
"""

PLUGIN_SEARCH_QUERY = """
MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d:DocumentVersion)
WHERE d.ai_description IS NOT NULL
  AND d.ai_confidence >= $min_confidence
  AND (ANY(tag IN coalesce(pv.ai_tags, []) WHERE tag IN $tags)
       OR ANY(kw IN $keywords WHERE toLower(coalesce(pv.ai_description, '')) CONTAINS toLower(kw)))
WITH d, collect(DISTINCT pv.Name) AS plugins
RETURN d.DocumentId AS documentId, d.VersionId AS versionId,
       d.FileName AS fileName, d.FilePath AS filePath,
       d.ai_description AS description, d.ai_tags AS tags,
       d.ai_category AS category, d.ai_confidence AS confidence,
       d.ai_inputs AS inputs, d.ai_outputs AS outputs,
       d.ai_flow AS flow,
       plugins, 1 AS total_score
LIMIT $max_results
"""

VECTOR_SEARCH_QUERY = """
CALL db.index.vector.queryNodes('doc_embedding', $top_k, $query_embedding)
YIELD node AS d, score AS vector_score
WHERE d.ai_confidence >= $min_confidence
OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
WITH d, vector_score, collect(DISTINCT pv.Name) AS plugins
RETURN d.DocumentId AS documentId, d.VersionId AS versionId,
       d.FileName AS fileName, d.FilePath AS filePath,
       d.ai_description AS description, d.ai_tags AS tags,
       d.ai_category AS category, d.ai_confidence AS confidence,
       d.ai_inputs AS inputs, d.ai_outputs AS outputs,
       d.ai_flow AS flow,
       plugins, vector_score
"""

EMBEDDING_MODEL = "text-embedding-3-small"


def get_query_embedding(client: OpenAI, query: str) -> list[float]:
    """Generate embedding for a search query."""
    response = client.embeddings.create(model=EMBEDDING_MODEL, input=query)
    return response.data[0].embedding


def search_neo4j(driver, params: dict, max_results: int = 10, min_confidence: float = 0.3,
                 query_embedding: list[float] | None = None) -> list[dict]:
    """Search Neo4j using interpreted query parameters + vector similarity."""
    query_params = {
        "tags": params.get("tags", []),
        "keywords": params.get("keywords", []),
        "category": params.get("category"),
        "input_hints": params.get("input_hints", []),
        "output_hints": params.get("output_hints", []),
        "max_results": max_results,
        "min_confidence": min_confidence,
    }

    results = {}

    with driver.session() as session:
        # Primary search: direct document matching
        for record in session.run(SEARCH_QUERY, query_params):
            key = f"{record['documentId']}:{record['versionId']}"
            results[key] = dict(record)

        # Secondary search: via plugin relationships
        for record in session.run(PLUGIN_SEARCH_QUERY, query_params):
            key = f"{record['documentId']}:{record['versionId']}"
            if key not in results:
                results[key] = dict(record)

        # Vector search: semantic similarity
        if query_embedding:
            try:
                for record in session.run(VECTOR_SEARCH_QUERY, {
                    "query_embedding": query_embedding,
                    "top_k": max_results * 2,
                    "min_confidence": min_confidence,
                }):
                    key = f"{record['documentId']}:{record['versionId']}"
                    r = dict(record)
                    vector_score = r.pop("vector_score", 0)
                    # Skip low-similarity vector results (below 0.3 cosine similarity)
                    if vector_score < 0.3:
                        continue
                    # Convert vector score to comparable scale (vector_score is 0-1 cosine similarity)
                    r["total_score"] = vector_score * 10
                    if key in results:
                        # Boost existing results found by both methods
                        results[key]["total_score"] = results[key].get("total_score", 0) + r["total_score"]
                    else:
                        results[key] = r
            except Exception as e:
                log.warning(f"Vector search skipped: {e}")

    # Sort by score, return top N
    sorted_results = sorted(results.values(), key=lambda r: r.get("total_score", 0), reverse=True)
    return sorted_results[:max_results]


def explain_results(client: OpenAI, model: str, query: str, results: list[dict]) -> list[str]:
    """Use LLM to explain why each result matches the query."""
    if not results:
        return []

    scripts_summary = []
    for i, r in enumerate(results):
        scripts_summary.append(
            f"{i+1}. {r.get('fileName', 'unknown')} - {r.get('description', 'no description')}"
            f" | tags: {r.get('tags', [])} | flow: {r.get('flow', 'N/A')}"
        )

    user_msg = f"Search query: {query}\n\nResults:\n" + "\n".join(scripts_summary)

    try:
        response = client.chat.completions.create(
            model=model,
            temperature=0.3,
            messages=[
                {"role": "system", "content": EXPLAIN_PROMPT},
                {"role": "user", "content": user_msg},
            ],
            response_format={"type": "json_object"},
        )
        parsed = json.loads(response.choices[0].message.content)
        return parsed.get("explanations", [])
    except Exception as e:
        log.error(f"Result explanation failed: {e}")
        return [r.get("description", "") for r in results]
