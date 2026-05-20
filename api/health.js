// api/health.js — health check endpoint
export default function handler(req, res) {
  const origin = process.env.FRONTEND_URL || "https://luo-ai.vercel.app";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.status(200).json({
    status:  "ok",
    model:   "luo-backend",
    search:  process.env.TAVILY_API_KEY        ? "tavily"
           : process.env.BRAVE_SEARCH_API_KEY  ? "brave"
           : process.env.SERPER_API_KEY         ? "serper"
           : "none — set TAVILY_API_KEY",
    claude:  !!process.env.ANTHROPIC_API_KEY,
    time:    new Date().toISOString(),
  });
}
