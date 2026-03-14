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

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: object) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));

      try {
        const reply = await runAgent(body.messages, body.scriptContext, (tool) => {
          send({ type: "tool_call", tool });
        });
        send({ type: "done", reply });
      } catch (err) {
        send({ type: "error", error: err instanceof Error ? err.message : "Agent error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
