// api/chat.js — Luo AI chat endpoint
// Uses Vercel Edge Runtime for true SSE streaming support

export const config = { runtime: "edge" };

import Anthropic from "@anthropic-ai/sdk";

const LUO_SYSTEM = `You are Luo, an AI assistant with real-time web access.

RULES:
1. You receive fresh web search results in each message when relevant.
2. Ground factual claims in the provided search results. Cite sources as [Title](url).
3. If search results do not answer the question, use your own knowledge and say so.
4. Never say "as of my knowledge cutoff" — you have live search results.
5. Be concise, direct, and genuinely helpful.`;

function shouldSearch(text) {
  if (!text || text.length < 4) return false;
  return !/^(hi|hello|hey|thanks|ok|sure|yes|no)\b/i.test(text.trim());
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content.filter(b => b.type === "text").map(b => b.text).join(" ");
  return "";
}

async function searchWeb(query) {
  const tavilyKey = process.env.TAVILY_API_KEY;
  const braveKey  = process.env.BRAVE_SEARCH_API_KEY;
  const serperKey = process.env.SERPER_API_KEY;

  try {
    if (tavilyKey) {
      const r = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: tavilyKey, query, search_depth: "basic", max_results: 5, include_answer: false }),
      });
      if (!r.ok) throw new Error(`Tavily ${r.status}`);
      const d = await r.json();
      return (d.results ?? []).map(x => ({ title: x.title, url: x.url, snippet: x.content ?? "" }));
    }
    if (braveKey) {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", query); url.searchParams.set("count", "5");
      const r = await fetch(url.toString(), { headers: { Accept: "application/json", "X-Subscription-Token": braveKey } });
      if (!r.ok) throw new Error(`Brave ${r.status}`);
      const d = await r.json();
      return (d.web?.results ?? []).map(x => ({ title: x.title, url: x.url, snippet: x.description ?? "" }));
    }
    if (serperKey) {
      const r = await fetch("https://google.serper.dev/search", {
        method: "POST", headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num: 5 }),
      });
      if (!r.ok) throw new Error(`Serper ${r.status}`);
      const d = await r.json();
      return (d.organic ?? []).map(x => ({ title: x.title, url: x.link, snippet: x.snippet ?? "" }));
    }
  } catch (err) {
    console.error("[search]", err.message);
  }
  return [];
}

function injectSearch(messages, results) {
  if (!results.length) return messages;
  const ctx = results.map((r, i) => `[${i+1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`).join("\n\n");
  const last = messages[messages.length - 1];
  const text = extractText(last.content);
  return [
    ...messages.slice(0, -1),
    { role: "user", content: `${text}\n\n---\nReal-time web search results:\n${ctx}\n---` },
  ];
}

export default async function handler(req) {
  const origin = process.env.FRONTEND_URL || "https://luo-ai.vercel.app";

  const corsHeaders = {
    "Access-Control-Allow-Origin":  origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: corsHeaders }); }

  const { messages, model, system: customSystem, max_tokens } = body ?? {};

  if (!Array.isArray(messages) || !messages.length) {
    return new Response(JSON.stringify({ error: "messages required" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Web search
  const userText = extractText(messages[messages.length - 1].content);
  let augmented = messages;
  if (shouldSearch(userText)) {
    const results = await searchWeb(userText);
    augmented = injectSearch(messages, results);
  }

  const finalSystem = customSystem ? `${LUO_SYSTEM}\n\n---\nCustom instructions:\n${customSystem}` : LUO_SYSTEM;
  const anthropic   = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // True streaming via Web Streams API (works on Vercel Edge)
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const aiStream = anthropic.messages.stream({
          model:      model ?? "claude-sonnet-4-6",
          max_tokens: max_tokens ?? 2048,
          system:     finalSystem,
          messages:   augmented,
        });
        aiStream.on("text",    text => send({ type: "text", text }));
        aiStream.on("message", msg  => { send({ type: "done", usage: msg.usage }); controller.close(); });
        aiStream.on("error",   err  => { send({ type: "error", message: err.message }); controller.close(); });
      } catch (err) {
        send({ type: "error", message: err.message });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no",   // disables nginx buffering on Vercel
    },
  });
}
