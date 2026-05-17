/**
 * Export training dataset for fine-tuning
 *
 * Usage:   node scripts/exportFineTuneDataset.js
 * Output:  data/fine-tune-export.jsonl
 *
 * Then fine-tune:
 *   openai api fine_tunes.create -t data/fine-tune-export.jsonl -m gpt-4o-mini
 */

import fs from "fs";

const INPUT  = "./data/training/interactions.jsonl";
const OUTPUT = "./data/fine-tune-export.jsonl";
const MIN_LEN = 100;

if (!fs.existsSync(INPUT)) {
  console.error("❌ No training data yet. Use Zuno first to collect examples.");
  process.exit(1);
}

const lines = fs.readFileSync(INPUT, "utf8").trim().split("\n").filter(Boolean);
const out   = fs.createWriteStream(OUTPUT);
let exported = 0, skipped = 0;

for (const line of lines) {
  try {
    const record = JSON.parse(line);
    const assistant = record.messages?.find((m) => m.role === "assistant");
    if (!assistant || assistant.content.length < MIN_LEN) { skipped++; continue; }
    out.write(JSON.stringify({ messages: record.messages }) + "\n");
    exported++;
  } catch { skipped++; }
}
out.end();

console.log(`\n✅ Export complete`);
console.log(`   Exported : ${exported} examples → ${OUTPUT}`);
console.log(`   Skipped  : ${skipped} (too short / malformed)`);
if (exported < 10)  console.log("\n⚠  Need more data — keep chatting to collect examples.");
else if (exported < 50) console.log(`\n📈 ${50 - exported} more examples until fine-tuning threshold.`);
else console.log("\n🚀 Ready! Run:\n   openai api fine_tunes.create -t data/fine-tune-export.jsonl -m gpt-4o-mini");