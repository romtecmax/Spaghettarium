import type { Route } from "./+types/analytics";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Analytics – Spaghettarium" },
    { name: "description", content: "Analytics and insights about the script library." },
  ];
}

export default function Analytics() {
  return (
    <main className="container mx-auto px-6 py-8">
      <h1 className="text-2xl font-bold mb-6">Analytics</h1>

      {/* Analytics Graphs go here */}
      <p className="text-gray-500 dark:text-gray-400">Coming soon.</p>
    </main>
  );
}