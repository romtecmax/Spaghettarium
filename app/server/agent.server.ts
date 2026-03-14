import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { runQuery } from "~/server/db.server";
import { searchScripts } from "~/server/search.server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const queryDatabase = betaZodTool({
  name: "query_database",
  description: `Execute a Cypher query against the Neo4j graph database to explore Grasshopper scripts, components, plugins, and their relationships.

Schema:
- (:DocumentVersion {versionId, fileName, filePath, ai_description, ai_category, ai_tags, ai_flow, ai_inputs, ai_outputs, ai_confidence})
- (:ComponentInstance {instanceGuid, componentName, pivotX, pivotY})
- (:PluginVersion {pluginName, pluginAuthor})
- (:DocumentVersion)-[:HAS_COMPONENT]->(:ComponentInstance)
- (:DocumentVersion)-[:USES_PLUGIN]->(:PluginVersion)
- (:ComponentInstance)-[:CONNECTS_TO]->(:ComponentInstance)`,
  inputSchema: z.object({
    query: z.string().describe("The Cypher query to execute"),
  }),
  run: async ({ query }) => {
    try {
      const results = await runQuery(query);
      return JSON.stringify(results, null, 2);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});

const searchDocuments = betaZodTool({
  name: "search_documents",
  description:
    "Search for Grasshopper scripts using semantic similarity on their AI-generated descriptions. Use this to find scripts related to a topic or similar to a description.",
  inputSchema: z.object({
    query: z.string().describe("The natural language search query"),
    max_results: z
      .number()
      .optional()
      .describe("Maximum number of results to return (default: 5)"),
  }),
  run: async ({ query, max_results }) => {
    try {
      const results = await searchScripts(query, max_results ?? 5);
      return JSON.stringify(results, null, 2);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  },
});

export async function runAgent(
  messages: Anthropic.MessageParam[],
  scriptContext?: string
): Promise<string> {
  const system = [
    "You are a helpful assistant for Spaghettarium, a library of Grasshopper parametric design scripts.",
    "You can explore the script database with Cypher queries and search scripts by description.",
    scriptContext ? `\nCurrent script context:\n${scriptContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const finalMessage = await client.beta.messages.toolRunner({
    model: "claude-opus-4-6",
    max_tokens: 4096,
    system,
    tools: [queryDatabase, searchDocuments],
    messages,
  });

  const textBlock = finalMessage.content.find(
    (b): b is Anthropic.Beta.BetaTextBlock => b.type === "text"
  );
  return textBlock?.text ?? "";
}
