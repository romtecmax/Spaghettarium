import { useState } from "react";
import { Link } from "react-router";
import type Anthropic from "@anthropic-ai/sdk";

const TOOL_LABELS: Record<string, string> = {
  query_database: "Querying database…",
  search_documents: "Searching scripts…",
};

const SCRIPT_LINK_SPLIT = /(\/script\/[0-9a-f-]+)/i;
const SCRIPT_LINK_TEST = /^\/script\/[0-9a-f-]+$/i;

function MessageContent({ text }: { text: string }) {
  const parts = text.split(SCRIPT_LINK_SPLIT);
  return (
    <>
      {parts.map((part, i) =>
        SCRIPT_LINK_TEST.test(part) ? (
          <Link
            key={i}
            to={part}
            className="underline text-blue-300 hover:text-blue-100"
          >
            {part}
          </Link>
        ) : (
          part
        )
      )}
    </>
  );
}

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  title?: string;
  placeholder?: string;
  scriptContext?: string;
}

export function ChatPanel({
  title = "Ask the library",
  placeholder = "Ask a question…",
  scriptContext,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);

  async function sendMessage(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMsg: Message = { role: "user", content: input.trim() };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const apiMessages: Anthropic.MessageParam[] = next.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: apiMessages, scriptContext }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = JSON.parse(line.slice(6)) as
            | { type: "tool_call"; tool: string }
            | { type: "done"; reply: string }
            | { type: "error"; error: string };
          if (event.type === "tool_call") {
            setToolStatus(TOOL_LABELS[event.tool] ?? event.tool);
          } else if (event.type === "done") {
            setMessages([...next, { role: "assistant", content: event.reply }]);
            setToolStatus(null);
          } else if (event.type === "error") {
            setMessages([...next, { role: "assistant", content: `Error: ${event.error}` }]);
            setToolStatus(null);
          }
        }
      }
    } catch {
      setMessages([
        ...next,
        { role: "assistant", content: "Error: could not reach the agent." },
      ]);
      setToolStatus(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-800 flex flex-col h-full min-h-96">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 text-sm font-medium">
        {title}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-600">{placeholder}</p>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={
                m.role === "user"
                  ? "max-w-[80%] rounded-lg px-3 py-2 text-sm bg-blue-600 text-white"
                  : "max-w-[80%] rounded-lg px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 whitespace-pre-wrap"
              }
            >
              {m.role === "assistant" ? (
                <MessageContent text={m.content} />
              ) : (
                m.content
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-lg px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 text-gray-400 flex items-center gap-2">
              <span className="animate-pulse">⬤</span>
              {toolStatus ?? "Thinking…"}
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={sendMessage}
        className="p-3 border-t border-gray-200 dark:border-gray-800 flex gap-2"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          disabled={loading}
          className="flex-1 text-sm rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="text-sm rounded-md bg-blue-600 text-white px-4 py-2 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </form>
    </div>
  );
}
