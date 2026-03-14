import type { ActionFunctionArgs } from "react-router";
import type Anthropic from "@anthropic-ai/sdk";
import { runAgent } from "~/server/agent.server";

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = (await request.json()) as {
    messages: Anthropic.MessageParam[];
    scriptContext?: string;
  };

  try {
    const reply = await runAgent(body.messages, body.scriptContext);
    return Response.json({ reply });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Agent error" },
      { status: 500 }
    );
  }
}
