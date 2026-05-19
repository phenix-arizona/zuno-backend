// api/chat.js — Luo AI chat endpoint
// Vercel Serverless Function — no Express, no server.js needed.
// Handles: web search injection → Claude streaming → SSE back to client.

import Anthropic from "@anthropic-ai/sdk";
import { searchWeb } from "./lib/search.js";

const LUO_SYSTEM = `You are Luo, an AI assistant with real-time web access.

RULES:
1. You receive fresh web search results in each message when relevant.
2. Ground factual claims in the provided search results. Cite sources as [Title](url).
3. If search results do not answer the question, use your own knowledge and say so.
4. Never say "as of my knowledge cutoff" — you have live search results.
5. Be concise, direct, and genuinely helpful.`;

// Skip search for greetings and pure coding tasks
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

function injectSearch(messages, results) {
  if (!results.length) return messages;
  const ctx = results
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`)
    .join("\n\n");
  const last = messages[messages.length - 1];
  const text = extractText(last.content);
  return [
    ...messages.slice(0, -1),
    { role: "user", content: `${text}\n\n---\nReal-time web search results:\n${ctx}\n---` },
  ];
}

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST")   { res.status(405).json({ error: "Method not allowed" }); return; }

  // ── Validate env ──────────────────────────────────────────────────────────
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in Vercel Environment Variables." });
    return;
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; }
  catch { res.status(400).json({ error: "Invalid JSON body" }); return; }

  const { messages, model, system: customSystem, max_tokens, stream: wantStream } = body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: "messages array is required" });
    return;
  }

  // ── Web search ────────────────────────────────────────────────────────────
  const userText = extractText(messages[messages.length - 1].content);
  let augmented  = messages;

  if (shouldSearch(userText)) {
    try {
      const results = await searchWeb(userText, 5);
      augmented = injectSearch(messages, results);
    } catch (err) {
      console.error("[search]", err.message);
      // Search failure is non-fatal — continue without results
    }
  }

  // ── Build system prompt ───────────────────────────────────────────────────
  const finalSystem = customSystem
    ? `${LUO_SYSTEM}\n\n---\nCustom instructions:\n${customSystem}`
    : LUO_SYSTEM;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // ── Streaming ─────────────────────────────────────────────────────────────
  if (wantStream) {
    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");

    const write = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

    try {
      const stream = anthropic.messages.stream({
        model:      model ?? "claude-sonnet-4-6",
        max_tokens: max_tokens ?? 2048,
        system:     finalSystem,
        messages:   augmented,
      });

      stream.on("text",    text  => write({ type: "text", text }));
      stream.on("message", msg  => { write({ type: "done", usage: msg.usage }); res.end(); });
      stream.on("error",   err  => { write({ type: "error", message: err.message }); res.end(); });
    } catch (err) {
      console.error("[claude stream]", err);
      write({ type: "error", message: err.message });
      res.end();
    }
    return;
  }

  // ── Non-streaming fallback ────────────────────────────────────────────────
  try {
    const msg = await anthropic.messages.create({
      model:      model ?? "claude-sonnet-4-6",
      max_tokens: max_tokens ?? 2048,
      system:     finalSystem,
      messages:   augmented,
    });
    res.status(200).json(msg);
  } catch (err) {
    console.error("[claude]", err);
    res.status(500).json({ error: err.message ?? "Claude API error" });
  }
}
