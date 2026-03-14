const SEARCH_API_URL = process.env.SEARCH_API_URL ?? "http://localhost:8000";

export interface SearchResultItem {
  document_id: string;
  version_id: string;
  file_name: string | null;
  file_path: string | null;
  description: string | null;
  tags: string[];
  category: string | null;
  confidence: number | null;
  inputs: string[];
  outputs: string[];
  flow: string | null;
  plugins: string[];
  match_explanation: string;
}

export interface SearchResponse {
  query: string;
  results: SearchResultItem[];
  total_found: number;
  search_params: Record<string, unknown>;
}

export async function searchScripts(
  query: string,
  maxResults = 20,
  minConfidence = 0.3
): Promise<SearchResponse> {
  const res = await fetch(`${SEARCH_API_URL}/api/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      min_confidence: minConfidence,
    }),
  });

  if (!res.ok) {
    throw new Error(`Search API returned ${res.status}`);
  }

  return res.json();
}
