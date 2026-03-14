// ============================================
// Dashboard Queries (pre-enrichment)
// ============================================

// --- BAR: Documents per plugin ---
MATCH (p:PluginVersion)-[:PluginVerToDocVer]->(d:DocumentVersion)
RETURN p.Name AS Plugin, count(DISTINCT d) AS Documents
ORDER BY Documents DESC

// --- PIE: Node distribution by label ---
MATCH (n)
WITH labels(n)[0] AS Label, count(*) AS Count
RETURN Label, Count ORDER BY Count DESC

// --- GRAPH: Full plugin-document network ---
MATCH (p:PluginVersion)-[r:PluginVerToDocVer]->(d:DocumentVersion)
RETURN p, r, d

// --- TABLE: All documents with metadata ---
MATCH (d:DocumentVersion)
RETURN d.FileName AS File, d.DocumentId AS DocId, d.FileLastWriteTimeUtc AS LastModified
ORDER BY d.FileName

// --- TABLE: Plugin versions with author info ---
MATCH (p:PluginVersion)
RETURN p.Name AS Plugin, p.Version AS Version, p.Author AS Author
ORDER BY p.Name

// --- PIE: Documents per plugin author ---
MATCH (p:PluginVersion)-[:PluginVerToDocVer]->(d:DocumentVersion)
WHERE p.Author IS NOT NULL
RETURN p.Author AS Author, count(DISTINCT d) AS Documents
ORDER BY Documents DESC

// --- TABLE: Multi-plugin documents ---
MATCH (p:PluginVersion)-[:PluginVerToDocVer]->(d:DocumentVersion)
WITH d, collect(p.Name) AS Plugins, count(p) AS PluginCount
WHERE PluginCount > 1
RETURN d.FileName AS File, Plugins, PluginCount
ORDER BY PluginCount DESC

// --- BAR: Document age timeline ---
MATCH (d:DocumentVersion)
WHERE d.FileLastWriteTimeUtc IS NOT NULL
RETURN d.FileName AS File, d.FileLastWriteTimeUtc AS LastModified
ORDER BY LastModified ASC

// --- GRAPH: Plugin to version to document chain ---
MATCH path = (pl:Plugin)-[:PluginToPluginVer]->(pv:PluginVersion)-[:PluginVerToDocVer]->(d:DocumentVersion)
RETURN path

// --- KPI: Total counts ---
MATCH (d:DocumentVersion) WITH count(d) AS docs
MATCH (p:PluginVersion) WITH docs, count(p) AS plugins
MATCH ()-[r:PluginVerToDocVer]->() WITH docs, plugins, count(r) AS relationships
RETURN docs AS Documents, plugins AS Plugins, relationships AS Connections

// ============================================
// Extended queries (using colleague's relations)
// ============================================

// --- GRAPH: Component wiring for a specific document ---
MATCH p=(n:ComponentInstance)-[:Wire]->(m:ComponentInstance)
WHERE n.VersionId = "3b59967e-4716-580b-a9f0-ee106f27afc2"
RETURN p LIMIT 2500

// --- BAR: Most connected components ---
MATCH (n:ComponentInstance)-[w:Wire]-()
WHERE n.VersionId = "3b59967e-4716-580b-a9f0-ee106f27afc2"
RETURN n.ComponentName AS Component, n.InstanceName AS Instance, count(w) AS Connections
ORDER BY Connections DESC LIMIT 20

// --- GRAPH: Document cluster hierarchy ---
MATCH p=(parent:DocumentVersion)-[:DocVerToDocVer]->(child:DocumentVersion)
RETURN p LIMIT 2500

// --- BAR: Cluster count per document ---
MATCH (parent:DocumentVersion)-[:DocVerToDocVer]->(child:DocumentVersion)
RETURN parent.FileName AS Document, count(child) AS Clusters
ORDER BY Clusters DESC

// --- GRAPH: Full plugin lineage ---
MATCH path=(pl:Plugin)-[:PluginToPluginVer]->(pv:PluginVersion)-[:PluginVerToCompDef]->(cd:ComponentDefinition)
RETURN path LIMIT 2500

// --- BAR: Components per plugin ---
MATCH (pl:Plugin)-[:PluginToPluginVer]->(pv:PluginVersion)-[:PluginVerToCompDef]->(cd:ComponentDefinition)
RETURN pl.Name AS Plugin, count(DISTINCT cd) AS Components
ORDER BY Components DESC

// --- BAR: Most reused component definitions ---
MATCH (cd:ComponentDefinition)<-[:PluginVerToCompDef]-(pv:PluginVersion)-[:PluginVerToDocVer]->(d:DocumentVersion)
RETURN cd.Name AS Component, count(DISTINCT d) AS UsedInDocuments
ORDER BY UsedInDocuments DESC LIMIT 20

// --- GRAPH: Full dependency supergraph ---
MATCH p=()-[r:Wire|DocVerToDocVer|PluginVerToDocVer|PluginToPluginVer|PluginVerToCompDef]->()
RETURN p LIMIT 3000

// --- TABLE: Orphan documents ---
MATCH (d:DocumentVersion)
WHERE NOT (d)<-[:PluginVerToDocVer]-() AND NOT (d)-[:DocVerToDocVer]-()
RETURN d.FileName AS OrphanDocument, d.DocumentId AS DocId

// --- BAR: Document complexity score ---
MATCH (d:DocumentVersion)
OPTIONAL MATCH (ci:ComponentInstance)-[w:Wire]->() WHERE ci.VersionId = d.VersionId
OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
OPTIONAL MATCH (d)-[:DocVerToDocVer]->(child)
WITH d, count(DISTINCT w) AS Wires, count(DISTINCT pv) AS Plugins, count(DISTINCT child) AS Clusters
RETURN d.FileName AS Document, Wires, Plugins, Clusters, (Wires + Plugins*10 + Clusters*5) AS ComplexityScore
ORDER BY ComplexityScore DESC
