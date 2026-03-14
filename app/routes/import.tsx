import { useState, useEffect, useCallback, useRef } from "react";
import type { Route } from "./+types/import";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Import | Spaghettarium" }];
}

const SEARCH_API_URL = "http://localhost:8000";

interface ImportStatus {
  status: string;
  file_names: string[];
  progress: string;
  files_total: number;
  files_imported: number;
  files_failed: number;
  error: string | null;
  log: string[];
}

const STEP_ORDER = ["importing", "enriching", "embedding", "done"];

function StepIndicator({ status }: { status: string }) {
  const currentIdx = STEP_ORDER.indexOf(status);
  const steps = [
    { key: "importing", label: "Import to Neo4j" },
    { key: "enriching", label: "AI enrichment" },
    { key: "embedding", label: "Embeddings" },
  ];

  return (
    <div className="flex items-center gap-2 mb-6">
      {steps.map((step, i) => {
        const stepIdx = STEP_ORDER.indexOf(step.key);
        const isActive = status === step.key;
        const isDone = currentIdx > stepIdx || status === "done";

        return (
          <div key={step.key} className="flex items-center gap-2">
            {i > 0 && (
              <div className={`h-0.5 w-8 ${isDone ? "bg-green-500" : "bg-gray-300 dark:bg-gray-700"}`} />
            )}
            <div className="flex items-center gap-1.5">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  isDone
                    ? "bg-green-500 text-white"
                    : isActive
                      ? "bg-blue-500 text-white animate-pulse"
                      : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                }`}
              >
                {isDone ? "\u2713" : i + 1}
              </div>
              <span
                className={`text-xs ${
                  isActive
                    ? "text-blue-600 dark:text-blue-400 font-medium"
                    : isDone
                      ? "text-green-600 dark:text-green-400"
                      : "text-gray-500 dark:text-gray-400"
                }`}
              >
                {step.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function Import() {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [polling, setPolling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Poll for status while pipeline is running
  useEffect(() => {
    if (!polling) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${SEARCH_API_URL}/api/import/status`);
        const data: ImportStatus = await res.json();
        setStatus(data);
        if (data.status === "done" || data.status === "error" || data.status === "idle") {
          setPolling(false);
        }
      } catch {
        // API might be down, keep polling
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [polling]);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const valid = Array.from(incoming).filter((f) => {
      const ext = f.name.toLowerCase();
      return ext.endsWith(".gh") || ext.endsWith(".ghx");
    });
    if (valid.length === 0) return;
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name));
      const newFiles = valid.filter((f) => !existing.has(f.name));
      return [...prev, ...newFiles];
    });
  }, []);

  const removeFile = useCallback((name: string) => {
    setFiles((prev) => prev.filter((f) => f.name !== name));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      addFiles(e.dataTransfer.files);
    },
    [addFiles]
  );

  const startImport = useCallback(async () => {
    if (files.length === 0) return;
    setError(null);

    const formData = new FormData();
    for (const f of files) {
      formData.append("files", f);
    }

    try {
      const res = await fetch(`${SEARCH_API_URL}/api/import/upload`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.detail || "Failed to start import");
        return;
      }
      setPolling(true);
      // Fetch initial status
      const statusRes = await fetch(`${SEARCH_API_URL}/api/import/status`);
      setStatus(await statusRes.json());
    } catch {
      setError("Could not connect to the API. Is the backend running?");
    }
  }, [files]);

  const isRunning = status && !["idle", "done", "error"].includes(status.status);

  return (
    <div className="container mx-auto px-6 pt-6 pb-4 flex flex-col h-full overflow-hidden">
      <h1 className="text-3xl font-bold mb-6">Import Grasshopper Scripts</h1>

      {/* Drop zone */}
      <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 mb-6">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => !isRunning && fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            dragOver
              ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20"
              : "border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600"
          } ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
        >
          <div className="text-4xl mb-3 text-gray-400">
            {dragOver ? "\u2B07" : "\u{1F4C2}"}
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
            Drop <code>.gh</code> / <code>.ghx</code> files here, or click to browse
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Files will be imported into Neo4j, enriched with AI, and indexed for search
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".gh,.ghx"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {/* File list */}
        {files.length > 0 && (
          <div className="mt-4 space-y-1.5">
            {files.map((f) => (
              <div
                key={f.name}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-mono">
                    {f.name.split(".").pop()}
                  </span>
                  <span className="text-sm truncate">{f.name}</span>
                  <span className="text-xs text-gray-400 shrink-0">
                    {(f.size / 1024).toFixed(0)} KB
                  </span>
                </div>
                {!isRunning && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(f.name);
                    }}
                    className="text-xs text-red-500 hover:text-red-700 dark:hover:text-red-400 ml-2"
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Start button */}
        {files.length > 0 && (
          <button
            onClick={startImport}
            disabled={!!isRunning}
            className="mt-4 px-6 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning
              ? "Pipeline running..."
              : `Import ${files.length} file${files.length !== 1 ? "s" : ""}`}
          </button>
        )}

        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      </div>

      {/* Pipeline status */}
      {status && status.status !== "idle" && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 flex-1 min-h-0 flex flex-col">
          <h2 className="text-lg font-semibold mb-4">Pipeline Status</h2>

          <StepIndicator status={status.status} />

          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3">
              <div className="text-2xl font-bold">{status.files_total}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Total files</div>
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3">
              <div className="text-2xl font-bold text-green-600">{status.files_imported}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Imported</div>
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3">
              <div className="text-2xl font-bold text-red-500">{status.files_failed}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Failed</div>
            </div>
            <div className="rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3">
              <div className="text-2xl font-bold text-blue-600">
                {status.files_total > 0
                  ? Math.round(((status.files_imported + status.files_failed) / status.files_total) * 100)
                  : 0}%
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Progress</div>
            </div>
          </div>

          {/* Progress message */}
          {status.progress && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{status.progress}</p>
          )}

          {/* Error */}
          {status.error && (
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 mb-3">
              <p className="text-sm text-red-700 dark:text-red-400">{status.error}</p>
            </div>
          )}

          {/* Done banner */}
          {status.status === "done" && (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3 mb-3">
              <p className="text-sm text-green-700 dark:text-green-400 font-medium">
                Import complete! {status.files_imported} scripts imported and enriched.
              </p>
            </div>
          )}

          {/* Log output */}
          <div className="flex-1 min-h-0 overflow-y-auto rounded-lg bg-gray-950 p-4 font-mono text-xs text-gray-300">
            {status.log.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap leading-relaxed">
                {line}
              </div>
            ))}
            {isRunning && <div className="animate-pulse text-blue-400 mt-1">...</div>}
          </div>
        </div>
      )}
    </div>
  );
}
