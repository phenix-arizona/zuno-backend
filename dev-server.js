// dev-server.js — Luo Backend local development server
// Wraps the Vercel serverless functions so you can run them with plain Node.js.
// Usage: node dev-server.js

import http from "http";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

// Load .env manually (no dotenv package needed)
try {
  const envPath = resolve(__dirname, ".env");
  const lines   = readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq  = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = val;
  }
  console.log("✅ .env loaded");
} catch {
  console.warn("⚠  No .env file found — using system environment variables");
}

// Dynamically import the handler modules
const { default: chatHandler   } = await import("./api/chat.js");
const { default: healthHandler } = await import("./api/health.js");

// Minimal req/res adapter so Express-style handlers work with Node's http module
function adapt(req, res, handler) {
  const chunks = [];
  req.on("data", c => chunks.push(c));
  req.on("end", async () => {
    const raw = Buffer.concat(chunks).toString();
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }

    // Minimal res shim
    const headers = {};
    let   statusCode = 200;

    res.setHeader  = (k, v)  => { headers[k] = v; };
    res.getHeader  = (k)     => headers[k];
    res.status     = (code)  => { statusCode = code; return res; };
    res.json       = (data)  => {
      if (!res.headersSent) {
        res.writeHead(statusCode, { "Content-Type": "application/json", ...headers });
      }
      res.end(JSON.stringify(data));
    };

    const origWrite    = res.write.bind(res);
    const origEnd      = res.end.bind(res);
    let   headersWritten = false;

    res.write = (chunk) => {
      if (!headersWritten) {
        res.writeHead(statusCode, headers);
        headersWritten = true;
      }
      return origWrite(chunk);
    };
    res.end = (chunk) => {
      if (!headersWritten) {
        res.writeHead(statusCode, headers);
        headersWritten = true;
      }
      return origEnd(chunk);
    };

    try {
      await handler(req, res);
    } catch (err) {
      console.error("[handler error]", err);
      if (!headersWritten) {
        res.writeHead(500, { "Content-Type": "application/json" });
      }
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

const server = http.createServer((req, res) => {
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
});

server.listen(PORT, () => {
  console.log(`\n🚀 Luo backend  →  http://localhost:${PORT}`);
  console.log(`🔍 Search  : ${process.env.TAVILY_API_KEY ? "Tavily ✅" : process.env.BRAVE_SEARCH_API_KEY ? "Brave ✅" : process.env.SERPER_API_KEY ? "Serper ✅" : "⚠  Set TAVILY_API_KEY in .env"}`);
  console.log(`🤖 Claude  : ${process.env.ANTHROPIC_API_KEY   ? "✅ key found" : "⚠  ANTHROPIC_API_KEY missing"}`);
  console.log(`\nEndpoints:`);
  console.log(`  POST http://localhost:${PORT}/api/chat`);
  console.log(`  GET  http://localhost:${PORT}/api/health\n`);
});
