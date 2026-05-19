import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import chatRouter from "./routes/chat.js";
import { getTrainingStats } from "./services/trainingLogger.js";

dotenv.config();

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: process.env.FRONTEND_URL || "http://localhost:3001" }));
app.use(express.json({ limit: "50mb" }));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use("/api/chat", chatRouter);

// Training stats dashboard
app.get("/api/training/stats", (_req, res) => res.json(getTrainingStats()));

// Health check
app.get("/health", (_req, res) => res.json({
  status: "ok",
  claude: !!process.env.ANTHROPIC_API_KEY,
  search: process.env.TAVILY_API_KEY  ? "tavily"
        : process.env.SERPER_API_KEY  ? "serper"
        : "duckduckgo (no key — free fallback)",
}));

// ── Start ────────────────────────────────────────────────────────────────────
const searchProvider =
  process.env.TAVILY_API_KEY ? "✓ Tavily"
  : process.env.SERPER_API_KEY ? "✓ Serper"
  : "⚠ No key — using DuckDuckGo (free fallback)";

app.listen(PORT, () => {
  console.log(`\n🚀 Luo backend → http://localhost:${PORT}`);
  console.log(`🔍 Search:  ${searchProvider}`);
  console.log(`🤖 Claude:  ${process.env.ANTHROPIC_API_KEY ? "✓ key found" : "⚠ ANTHROPIC_API_KEY missing"}\n`);
});
