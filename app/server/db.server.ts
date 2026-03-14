import neo4j, { type Driver } from "neo4j-driver";

let driver: Driver;

function getDriver(): Driver {
  if (!driver) {
    const uri = process.env.NEO4J_URI;
    const username = process.env.NEO4J_USERNAME;
    const password = process.env.NEO4J_PASSWORD;
    

    if (!uri || !username || !password) {
      throw new Error("Missing NEO4J_URI, NEO4J_USERNAME, or NEO4J_PASSWORD env vars");
    }

    driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  }
  return driver;
}


export async function runQuery<T = unknown>(
  cypher: string,
  params: Record<string, unknown> = {}
): Promise<T[]> {
  const DATABASE = process.env.NEO4J_DATABASE
  if (!DATABASE) {
      throw new Error("Missing NEO4J_DATABASE env var!");
    }
  const session = getDriver().session({ database: DATABASE });
  try {
    console.log(`querying for ${cypher}`)
    const result = await session.run(cypher, params);
    console.log(`Result: ${JSON.stringify(result)}`)
    return result.records.map((r) => r.toObject() as T);
  } finally {
    await session.close();
  }
}