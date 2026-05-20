// dev-server.js — Luo Backend local dev server
// Handles Edge-style handlers (return new Response(...)) AND
// traditional Node handlers (res.write/res.end)

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
    const eq = t.indexOf("=");
    if (eq < 0) continue;
    const key = t.slice(0, eq).trim();
    const val = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = val;
  }
  console.log("✅ .env loaded");
} catch {
  console.warn("⚠  No .env file — using system env vars");
}

// ── Polyfill Web APIs needed by Edge-style handlers ───────────────────────────
if (!globalThis.Request) {
  const { Request, Response, Headers } = await import("undici").catch(() => {
    // undici not available — use minimal shims
    return { Request: class {}, Response: class {}, Headers: class {} };
  });
  globalThis.Request  = Request;
  globalThis.Response = Response;
  globalThis.Headers  = Headers;
}

// ── Import handlers ───────────────────────────────────────────────────────────
const { default: chatHandler   } = await import("./api/chat.js");
const { default: healthHandler } = await import("./api/health.js");

// ── Adapt Edge-style handler (returns Response) to Node http ─────────────────
async function adaptEdge(req, nodeRes, handler) {
  const chunks = [];
  await new Promise(r => { req.on("data", c => chunks.push(c)); req.on("end", r); });
  const rawBody = Buffer.concat(chunks).toString();

  // Build a Web API Request
  const url     = `http://localhost:${PORT}${req.url}`;
  const headers = new Headers(req.headers);
  const webReq  = new Request(url, {
    method:  req.method,
    headers,
    body:    ["POST","PUT","PATCH"].includes(req.method) ? rawBody : undefined,
  });
  webReq.json = () => Promise.resolve(rawBody ? JSON.parse(rawBody) : {});

  // Call handler
  const webRes = await handler(webReq);

  // Write status + headers
  const resHeaders = {};
  webRes.headers.forEach((v, k) => { resHeaders[k] = v; });
  // Always allow local frontend
  resHeaders["Access-Control-Allow-Origin"] = "*";

  nodeRes.writeHead(webRes.status, resHeaders);

  // Stream the body
  if (webRes.body) {
    const reader = webRes.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      nodeRes.write(Buffer.from(value));
    }
  }
  nodeRes.end();
}

// ── HTTP server ───────────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
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

  if (url === "/api/chat" && req.method === "POST") {
    await adaptEdge(req, res, chatHandler);
    return;
  }

  // Health uses traditional Node handler
  if (url === "/api/health" && req.method === "GET") {
    const chunks = [];
    await new Promise(r => { req.on("data", c => chunks.push(c)); req.on("end", r); });
    req.body = {};
    const headers = {};
    let statusCode = 200;
    res.setHeader = (k, v) => { headers[k] = v; };
    res.status    = (c)    => { statusCode = c; return res; };
    const _end    = res.end.bind(res);
    res.json = (d) => {
      headers["Content-Type"] = "application/json";
      headers["Access-Control-Allow-Origin"] = "*";
      res.writeHead(statusCode, headers);
      _end(JSON.stringify(d));
    };
    await healthHandler(req, res);
    return;
  }

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
