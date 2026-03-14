// ============================================
// Dashboard Queries for AI-Enriched Graph
// ============================================
// These queries use the ai_* properties added by enrich_graph.py

// --- PIE: Documents by AI category ---
MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d:DocumentVersion)
WHERE pv.ai_category IS NOT NULL
RETURN pv.ai_category AS Category, count(DISTINCT d) AS Documents
ORDER BY Documents DESC

// --- TABLE: Search by tag ---
// (change the tag value to filter)
MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d:DocumentVersion)
WHERE "mesh" IN pv.ai_tags
RETURN d.FileName AS Document, pv.Name AS Plugin, pv.ai_description AS Description

// --- TABLE: All enrichments with confidence ---
MATCH (n)
WHERE n.ai_description IS NOT NULL
RETURN labels(n)[0] AS Type, n.Name AS Name,
       n.ai_description AS Description,
       n.ai_tags AS Tags,
       n.ai_category AS Category,
       n.ai_confidence AS Confidence
ORDER BY Confidence ASC

// --- BAR: Tag frequency across all plugins ---
MATCH (pv:PluginVersion)
WHERE pv.ai_tags IS NOT NULL
UNWIND pv.ai_tags AS tag
RETURN tag AS Tag, count(*) AS Count
ORDER BY Count DESC

// --- TABLE: Low confidence enrichments (review queue) ---
MATCH (n)
WHERE n.ai_confidence IS NOT NULL AND n.ai_confidence < 0.5
RETURN labels(n)[0] AS Type, n.Name AS Name,
       n.ai_description AS Description,
       n.ai_confidence AS Confidence
ORDER BY Confidence ASC
