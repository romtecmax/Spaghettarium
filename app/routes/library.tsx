import type { Route } from "./+types/library";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Library – Spaghettarium" },
    { name: "description", content: "Browse all Grasshopper scripts in the database." },
  ];
}

export default function Library() {
  return (
    <main className="container mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Script Library</h1>
        {/* Upload Pad goes here */}
      </div>

      {/* Script Search goes here */}

      {/* Script List goes here */}
      <p className="text-gray-500 dark:text-gray-400">No scripts yet.</p>
    </main>
  );
}