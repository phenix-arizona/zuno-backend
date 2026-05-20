// dev-server.js — Luo Backend local dev server
// Properly handles SSE streaming for /api/chat

import http    from "http";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath }   from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// ── Load .env ─────────────────────────────────────────────────────────────────
try {
  const lines = readFileSync(resolve(__dirname, ".env"), "utf8").split("\n");
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq  = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = val;
  }
  console.log("✅ .env loaded");
} catch {
  console.warn("⚠  No .env file — using system env vars");
}

// ── Import handlers ───────────────────────────────────────────────────────────
const { default: chatHandler   } = await import("./api/chat.js");
const { default: healthHandler } = await import("./api/health.js");

// ── req/res adapter ───────────────────────────────────────────────────────────
function adapt(req, res, handler) {
  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", async () => {
    // Parse body
    const raw = Buffer.concat(chunks).toString();
    try   { req.body = raw ? JSON.parse(raw) : {}; }
    catch { req.body = {}; }

    // Header store — flushed on first write/end
    const pendingHeaders = {
      "Access-Control-Allow-Origin": "*",
    };
    let statusCode    = 200;
    let headsFlushed  = false;

    function flushHeaders() {
      if (!headsFlushed) {
        headsFlushed = true;
        res.writeHead(statusCode, pendingHeaders);
      }
    }

    // Shim methods
    res.setHeader = (k, v) => {
      if (headsFlushed) return; // too late — ignore (headers already sent)
      pendingHeaders[k] = v;
    };
    res.getHeader = (k) => pendingHeaders[k];
    res.status    = (code) => { statusCode = code; return res; };

    res.json = (data) => {
      pendingHeaders["Content-Type"] = pendingHeaders["Content-Type"] || "application/json";
      flushHeaders();
      res.end(JSON.stringify(data));
    };

    // write() — used by SSE streaming; flush headers first
    const _write = res.write.bind(res);
    res.write = (chunk) => {
      flushHeaders();        // ensures Content-Type: text/event-stream is sent first
      return _write(chunk);
    };

    // end() — final flush
    const _end = res.end.bind(res);
    res.end = (chunk) => {
      flushHeaders();
      return _end(chunk);
    };

    try {
      await handler(req, res);
    } catch (err) {
      console.error("[handler]", err.message);
      if (!headsFlushed) {
        res.writeHead(500, { "Content-Type": "application/json" });
        headsFlushed = true;
      }
      _end(JSON.stringify({ error: err.message }));
    }
  });
}

// ── HTTP server ───────────────────────────────────────────────────────────────
http.createServer((req, res) => {
  const url = req.url.split("?")[0];

  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin":  "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (url === "/api/chat"   && req.method === "POST") return adapt(req, res, chatHandler);
  if (url === "/api/health" && req.method === "GET")  return adapt(req, res, healthHandler);

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found", available: ["/api/chat", "/api/health"] }));

}).listen(PORT, () => {
  console.log(`\n🚀 Luo backend  →  http://localhost:${PORT}`);
  console.log(`🔍 Search  : ${
    process.env.TAVILY_API_KEY       ? "Tavily ✅" :
    process.env.BRAVE_SEARCH_API_KEY ? "Brave ✅"  :
    process.env.SERPER_API_KEY       ? "Serper ✅" :
    "⚠  Set TAVILY_API_KEY in .env"
  }`);
  console.log(`🤖 Claude  : ${process.env.ANTHROPIC_API_KEY ? "✅ key found" : "⚠  ANTHROPIC_API_KEY missing"}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST http://localhost:${PORT}/api/chat`);
  console.log(`  GET  http://localhost:${PORT}/api/health\n`);
});
