"""
Generate vector embeddings for DocumentVersion nodes and store in Neo4j.
Uses OpenAI text-embedding-3-small (1536 dimensions).
"""

import os
import logging
from dotenv import load_dotenv
from neo4j import GraphDatabase
from openai import OpenAI

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://127.0.0.1:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
EMBEDDING_MODEL = "text-embedding-3-small"
BATCH_SIZE = 100  # OpenAI supports up to 2048 inputs per call


def build_embedding_text(doc: dict) -> str:
    """Build a rich text string for embedding from document properties."""
    parts = []
    if doc.get("fileName"):
        parts.append(doc["fileName"])
    if doc.get("description"):
        parts.append(doc["description"])
    if doc.get("flow"):
        parts.append(f"Flow: {doc['flow']}")
    if doc.get("tags"):
        parts.append(f"Tags: {', '.join(doc['tags'])}")
    if doc.get("category"):
        parts.append(f"Category: {doc['category']}")
    if doc.get("inputs"):
        parts.append(f"Inputs: {', '.join(doc['inputs'])}")
    if doc.get("outputs"):
        parts.append(f"Outputs: {', '.join(doc['outputs'])}")
    if doc.get("plugins"):
        parts.append(f"Plugins: {', '.join(doc['plugins'])}")
    return " | ".join(parts)


def main():
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))
    client = OpenAI(api_key=OPENAI_API_KEY)

    # Step 1: Create vector index if it doesn't exist
    log.info("Creating vector index...")
    with driver.session() as session:
        session.run("""
            CREATE VECTOR INDEX doc_embedding IF NOT EXISTS
            FOR (d:DocumentVersion)
            ON (d.embedding)
            OPTIONS {indexConfig: {
                `vector.dimensions`: 1536,
                `vector.similarity_function`: 'cosine'
            }}
        """)
    log.info("Vector index ready")

    # Step 2: Fetch all enriched documents
    with driver.session() as session:
        result = session.run("""
            MATCH (d:DocumentVersion)
            WHERE d.ai_description IS NOT NULL AND d.embedding IS NULL
            OPTIONAL MATCH (pv:PluginVersion)-[:PluginVerToDocVer]->(d)
            WITH d, collect(DISTINCT pv.Name) AS plugins
            RETURN elementId(d) AS elementId,
                   d.FileName AS fileName,
                   d.ai_description AS description,
                   d.ai_flow AS flow,
                   d.ai_tags AS tags,
                   d.ai_category AS category,
                   d.ai_inputs AS inputs,
                   d.ai_outputs AS outputs,
                   plugins
        """)
        docs = [dict(r) for r in result]

    log.info(f"Found {len(docs)} documents to embed")
    if not docs:
        log.info("All documents already have embeddings")
        driver.close()
        return

    # Step 3: Generate embeddings in batches
    texts = [build_embedding_text(d) for d in docs]
    all_embeddings = []

    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i:i + BATCH_SIZE]
        log.info(f"  Embedding batch {i // BATCH_SIZE + 1}/{(len(texts) - 1) // BATCH_SIZE + 1} ({len(batch)} docs)")
        response = client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        for item in response.data:
            all_embeddings.append(item.embedding)

    log.info(f"Generated {len(all_embeddings)} embeddings")

    # Step 4: Write embeddings back to Neo4j
    log.info("Writing embeddings to Neo4j...")
    with driver.session() as session:
        for i, (doc, embedding) in enumerate(zip(docs, all_embeddings)):
            session.run(
                "MATCH (n) WHERE elementId(n) = $eid SET n.embedding = $embedding",
                eid=doc["elementId"],
                embedding=embedding,
            )
            if (i + 1) % 100 == 0:
                log.info(f"  Written {i + 1}/{len(docs)}")

    log.info(f"Done! {len(all_embeddings)} embeddings stored")
    driver.close()


if __name__ == "__main__":
    main()
