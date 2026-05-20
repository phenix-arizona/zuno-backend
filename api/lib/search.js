// api/lib/search.js — Luo web search helper
// Priority: Tavily → Brave → Serper → empty (chat still works without search)

export async function searchWeb(query, count = 5) {
  const tavilyKey = process.env.TAVILY_API_KEY;
  const braveKey  = process.env.BRAVE_SEARCH_API_KEY;
  const serperKey = process.env.SERPER_API_KEY;

  if (tavilyKey) return tavilySearch(query, count, tavilyKey);
  if (braveKey)  return braveSearch(query, count, braveKey);
  if (serperKey) return serperSearch(query, count, serperKey);

  console.warn("[search] No API key set — set TAVILY_API_KEY in .env");
  return [];
}

// ── Tavily ────────────────────────────────────────────────────────────────────
// Docs: https://docs.tavily.com/docs/rest-api/api-reference
// Free tier: 1,000 credits/month — each search = 1 credit
async function tavilySearch(query, count, apiKey) {
  const res = await fetch("https://api.tavily.com/search", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key:        apiKey,
      query,
      search_depth:   "basic",   // "basic" (fast) or "advanced" (deeper, costs 2 credits)
      max_results:    count,
      include_answer: false,     // we let Claude synthesise — no need for Tavily's summary
    }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}: ${await res.text()}`);

  const data = await res.json();
  return (data.results ?? []).map(r => ({
    title:   r.title,
    url:     r.url,
    snippet: r.content ?? "",
    score:   r.score   ?? 0,     // Tavily provides a relevance score (0–1)
  }));
}

// ── Brave (fallback) ──────────────────────────────────────────────────────────
async function braveSearch(query, count, apiKey) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q",         query);
  url.searchParams.set("count",     String(count));
  url.searchParams.set("freshness", "pw");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
  });
  if (!res.ok) throw new Error(`Brave Search HTTP ${res.status}`);

  const data = await res.json();
  return (data.web?.results ?? []).map(r => ({
    title:   r.title,
    url:     r.url,
    snippet: r.description ?? "",
  }));
}

// ── Serper (fallback) ─────────────────────────────────────────────────────────
async function serperSearch(query, count, apiKey) {
  const res = await fetch("https://google.serper.dev/search", {
    method:  "POST",
    headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
    body:    JSON.stringify({ q: query, num: count }),
  });
  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);

  const data = await res.json();
  return (data.organic ?? []).map(r => ({
    title:   r.title,
    url:     r.link,
    snippet: r.snippet ?? "",
  }));
}
