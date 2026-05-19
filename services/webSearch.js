/**
 * Web Search Service
 * Primary:  Brave Search API  →  https://api.search.brave.com  (free: 2,000/month)
 * Fallback: Serper.dev        →  https://serper.dev            (free: 2,500/month)
 */

export async function searchWeb(query, count = 6) {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;
  const serperKey = process.env.SERPER_API_KEY;

  if (braveKey) return braveSearch(query, count, braveKey);
  if (serperKey) return serperSearch(query, count, serperKey);

  console.warn("[search] No API key set — returning empty results. Set BRAVE_SEARCH_API_KEY or SERPER_API_KEY in .env");
  return [];
}

async function braveSearch(query, count, apiKey) {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(count));
  url.searchParams.set("freshness", "pw"); // past week preferred

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });

  if (!res.ok) throw new Error(`Brave Search HTTP ${res.status}`);
  const data = await res.json();

  return (data.web?.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description || "",
    published: r.age || null,
    source: "brave",
  }));
}

async function serperSearch(query, count, apiKey) {
  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ q: query, num: count }),
  });

  if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
  const data = await res.json();

  return (data.organic || []).map((r) => ({
    title: r.title,
    url: r.link,
    snippet: r.snippet || "",
    published: r.date || null,
    source: "serper",
  }));
}
