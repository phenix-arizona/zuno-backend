// api/health.js — health check endpoint
export default function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200).json({
    status:  "ok",
    model:   "luo-backend",
    search:  process.env.BRAVE_SEARCH_API_KEY  ? "brave"
           : process.env.SERPER_API_KEY         ? "serper"
           : "none",
    claude:  !!process.env.ANTHROPIC_API_KEY,
    time:    new Date().toISOString(),
  });
}
