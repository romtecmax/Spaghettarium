import Anthropic from "@anthropic-ai/sdk";
import { runQuery } from "~/server/db.server";
import { searchScripts } from "~/server/search.server";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const tools: Anthropic.Tool[] = [
  {
    name: "query_database",
    description: `Execute a Cypher query against the Neo4j graph database to explore Grasshopper scripts, components, plugins, and their relationships.

Schema:
- (:DocumentVersion {versionId, fileName, filePath, ai_description, ai_category, ai_tags, ai_flow, ai_inputs, ai_outputs, ai_confidence})
- (:ComponentInstance {instanceGuid, componentName, pivotX, pivotY})
- (:PluginVersion {pluginName, pluginAuthor})
- (:DocumentVersion)-[:HAS_COMPONENT]->(:ComponentInstance)
- (:DocumentVersion)-[:USES_PLUGIN]->(:PluginVersion)
- (:ComponentInstance)-[:CONNECTS_TO]->(:ComponentInstance)`,
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The Cypher query to execute" },
      },
      required: ["query"],
    },
  },
  {
    name: "search_documents",
    description:
      "Search for Grasshopper scripts using semantic similarity on their AI-generated descriptions. Use this to find scripts related to a topic or similar to a description.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "The natural language search query" },
        max_results: { type: "number", description: "Maximum results to return (default: 5)" },
      },
      required: ["query"],
    },
  },
];

async function executeTool(name: string, input: Record<string, unknown>): Promise<string> {
  try {
    if (name === "query_database") {
      const results = await runQuery(input.query as string);
      return JSON.stringify(results, null, 2);
    }
    if (name === "search_documents") {
      const results = await searchScripts(
        input.query as string,
        (input.max_results as number) ?? 5
      );
      return JSON.stringify(results, null, 2);
    }
    return `Unknown tool: ${name}`;
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function runAgent(
  messages: Anthropic.MessageParam[],
  scriptContext: string | undefined,
  onToolCall: (tool: string) => void
): Promise<string> {
  const system = [
    "You are a helpful assistant for Spaghettarium, a library of Grasshopper parametric design scripts.",
    "You can explore the script database with Cypher queries and search scripts by description.",
    "You can link to a script by linking to /script/{id}",
    "When answering questions, keep your reply as short as possible, 1-2 sentences max.",
    "Do not use markdown formatting, only reply in plain text.",
    "You can give the user 1-2 proposed follow-up questions, if adequate.",
    scriptContext ? `\nCurrent script context:\n${scriptContext}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const history = [...messages];

  while (true) {
    const response = await client.messages.create({
      model: "claude-opus-4-6",
      max_tokens: 4096,
      system,
      tools,
      messages: history,
    });

    if (response.stop_reason === "end_turn") {
      const text = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
      return text?.text ?? "";
    }

    if (response.stop_reason === "tool_use") {
      history.push({ role: "assistant", content: response.content });

      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          onToolCall(block.name);
          const result = await executeTool(block.name, block.input as Record<string, unknown>);
          results.push({ type: "tool_result", tool_use_id: block.id, content: result });
        }
      }
      history.push({ role: "user", content: results });
    } else {
      break;
    }
  }

  return "";
}
