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

// ── Routes ──────────────────────────────────────────────────────────────────
app.use("/api/chat", chatRouter);

// Training stats dashboard
app.get("/api/training/stats", (_req, res) => res.json(getTrainingStats()));

// Health check
app.get("/health", (_req, res) => res.json({
  status: "ok",
  search: process.env.BRAVE_SEARCH_API_KEY ? "brave"
        : process.env.SERPER_API_KEY       ? "serper"
        : "none — set BRAVE_SEARCH_API_KEY in .env",
}));

app.listen(PORT, () => {
  console.log(`\n🚀 Zuno backend → http://localhost:${PORT}`);
  console.log(`🔍 Search: ${process.env.BRAVE_SEARCH_API_KEY ? "Brave" : process.env.SERPER_API_KEY ? "Serper" : "⚠ No key — set BRAVE_SEARCH_API_KEY"}`);
  console.log(`🤖 Claude: ${process.env.ANTHROPIC_API_KEY ? "✓ key found" : "⚠ ANTHROPIC_API_KEY missing"}\n`);
});