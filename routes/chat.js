import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { searchWeb } from "../services/webSearch.js";
import { logInteraction } from "../services/trainingLogger.js";

const router = express.Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ZUNO_SYSTEM_PROMPT = `You are Luo, an AI assistant with real-time web access.

RULES:
1. You ALWAYS have fresh web search results provided to you in each message when relevant.
2. Ground every factual claim in the provided search results.
3. Cite your sources inline using [Source: title](url) format.
4. If search results don't answer the question, use your own knowledge and say so.
5. Be concise, direct, and helpful.
6. Never say "as of my knowledge cutoff" — you have live search results.`;

// Heuristic: skip search for short greetings or pure coding tasks
function shouldSearch(query) {
  if (!query || query.length < 4) return false;
  const skip = [/^(hi|hello|hey|thanks|ok|sure|yes|no)\b/i, /^(write|fix|debug|refactor|explain this code)/i];
  return !skip.some((r) => r.test(query.trim()));
}

// Extract plain text from message content (handles string or content-block array)
function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.filter((b) => b.type === "text").map((b) => b.text).join(" ");
  }
  return "";
}

function formatSearchResults(results) {
  return results
    .slice(0, 5)
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\nSnippet: ${r.snippet}`)
    .join("\n\n");
}

// POST /api/chat
router.post("/", async (req, res) => {
  const { messages, conversationId, model, system: customSystem, max_tokens } = req.body;

  if (!messages?.length) return res.status(400).json({ error: "messages required" });

  const lastMsg = messages[messages.length - 1];
  const userQuery = extractText(lastMsg.content);

  // ── 1. Web Search ───────────────────────────────────────────────────────────
  let searchResults = [];
  let searchContext = "";
  if (shouldSearch(userQuery)) {
    try {
      searchResults = await searchWeb(userQuery);
      if (searchResults.length) searchContext = formatSearchResults(searchResults);
    } catch (err) {
      console.error("[search] failed:", err.message);
    }
  }

  // ── 2. Augment last message with search context ─────────────────────────────
  const augmentedMessages = [
    ...messages.slice(0, -1),
    {
      role: "user",
      content: searchContext
        ? `${userQuery}\n\n---\nReal-time web search results:\n${searchContext}\n---`
        : userQuery,
    },
  ];

  // Merge system prompts
  const finalSystem = customSystem
    ? `${ZUNO_SYSTEM_PROMPT}\n\n---\nCustom instructions:\n${customSystem}`
    : ZUNO_SYSTEM_PROMPT;

  // ── 3. Stream from Claude ───────────────────────────────────────────────────
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  try {
    const stream = anthropic.messages.stream({
      model: model || "claude-sonnet-4-6",
      max_tokens: max_tokens || 2048,
      system: finalSystem,
      messages: augmentedMessages,
    });

    stream.on("text", (text) => {
      fullResponse += text;
      res.write(`data: ${JSON.stringify({ type: "text", text })}\n\n`);
    });

    stream.on("message", async (msg) => {
      // Send usage stats so frontend can display token count
      res.write(`data: ${JSON.stringify({
        type: "done",
        usage: msg.usage,
        searchResultCount: searchResults.length,
      })}\n\n`);
      res.end();

      // ── 4. Log to training dataset ──────────────────────────────────────────
      await logInteraction({
        conversationId,
        userQuery,
        searchResults,
        assistantResponse: fullResponse,
        timestamp: new Date().toISOString(),
      });
    });

    stream.on("error", (err) => {
      console.error("[claude] stream error:", err.message);
      res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
      res.end();
    });
  } catch (err) {
    console.error("[claude] fatal:", err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

export default router;
