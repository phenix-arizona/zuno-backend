// api/lib/search.js — Luo web search helper
// Works inside Vercel Serverless Functions (Node 18+, native fetch available)

export async function searchWeb(query, count = 5) {
  const braveKey  = process.env.BRAVE_SEARCH_API_KEY;
  const serperKey = process.env.SERPER_API_KEY;

  if (braveKey)  return braveSearch(query, count, braveKey);
  if (serperKey) return serperSearch(query, count, serperKey);

  // No key set — return empty array gracefully (chat still works, just no search)
  return [];
}

async function braveSearch(query, count, apiKey) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q",         query);
  url.searchParams.set("count",     String(count));
  url.searchParams.set("freshness", "pw");

  const res  = await fetch(url.toString(), {
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
