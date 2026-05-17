/**
 * Training Data Logger
 *
 * Saves every Q&A turn as a JSONL record — your growing training dataset.
 * Compatible with OpenAI, Together AI, and Replicate fine-tuning formats.
 *
 * Export:  node scripts/exportFineTuneDataset.js
 */

import fs from "fs";
import path from "path";

const LOG_DIR  = process.env.TRAINING_LOG_DIR || "./data/training";
const LOG_FILE = path.join(LOG_DIR, "interactions.jsonl");

// Ensure directory exists on startup
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

export async function logInteraction({ conversationId, userQuery, searchResults, assistantResponse, timestamp }) {
  // Skip very short or empty responses
  if (!assistantResponse || assistantResponse.length < 50) return;

  const record = {
    id: `${conversationId || "anon"}-${Date.now()}`,
    timestamp,
    // ── OpenAI fine-tune format ─────────────────────────────────────────────
    messages: [
      {
        role: "system",
        content: "You are Zuno, a helpful AI assistant with real-time web access.",
      },
      { role: "user",      content: userQuery },
      { role: "assistant", content: assistantResponse },
    ],
    // ── Metadata (analysis only, not used in fine-tuning) ───────────────────
    meta: {
      searchResultCount: searchResults?.length || 0,
      responseLength: assistantResponse.length,
      topSources: searchResults?.slice(0, 3).map((r) => r.url) || [],
    },
  };

  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify(record) + "\n", "utf8");
  } catch (err) {
    console.error("[logger] Failed to write training record:", err.message);
  }
}

export function getTrainingStats() {
  if (!fs.existsSync(LOG_FILE)) {
    return { totalRecords: 0, fileSizeKB: 0, readyForFineTuning: false, logFile: LOG_FILE };
  }

  const lines = fs.readFileSync(LOG_FILE, "utf8").trim().split("\n").filter(Boolean);
  const { size } = fs.statSync(LOG_FILE);

  return {
    totalRecords: lines.length,
    fileSizeKB: Math.round(size / 1024),
    logFile: LOG_FILE,
    readyForFineTuning: lines.length >= 50,   // 50+ examples = fine-tunable
    nextMilestone: lines.length < 50 ? `${50 - lines.length} more to fine-tune` : "Ready!",
  };
}