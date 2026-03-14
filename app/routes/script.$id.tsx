import type { Route } from "./+types/script.$id";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Script – Spaghettarium" },
  ];
}

export default function ScriptDetail({ params }: Route.ComponentProps) {
  return (
    <main className="container mx-auto px-6 py-8">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Script View (left / main) */}
        <div className="lg:col-span-2">
          {/* Script View component goes here */}
          <p className="text-gray-500 dark:text-gray-400">
            Script <code className="font-mono">{params.id}</code>
          </p>
        </div>

        {/* Chat Interface (right sidebar) */}
        <div className="lg:col-span-1">
          {/* Chat Interface component goes here */}
        </div>
      </div>
    </main>
  );
}