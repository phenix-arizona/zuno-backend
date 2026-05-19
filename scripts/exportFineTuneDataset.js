/**
 * Export training dataset for fine-tuning
 *
 * Usage: node scripts/exportFineTuneDataset.js
 *
 * Outputs:  data/fine-tune-export.jsonl  (OpenAI / Together AI format)
 *
 * Then fine-tune with:
 *   openai api fine_tunes.create -t data/fine-tune-export.jsonl -m gpt-3.5-turbo
 */

import fs from "fs";

const INPUT_FILE = "./data/training/interactions.jsonl";
const OUTPUT_FILE = "./data/fine-tune-export.jsonl";
const MIN_RESPONSE_LENGTH = 100; // skip very short responses

if (!fs.existsSync(INPUT_FILE)) {
  console.error("No training data found at", INPUT_FILE);
  process.exit(1);
}

const lines = fs.readFileSync(INPUT_FILE, "utf8").trim().split("\n").filter(Boolean);
let exported = 0;
let skipped = 0;

const output = fs.createWriteStream(OUTPUT_FILE);

for (const line of lines) {
  try {
    const record = JSON.parse(line);
    const assistantMsg = record.messages.find((m) => m.role === "assistant");

    if (!assistantMsg || assistantMsg.content.length < MIN_RESPONSE_LENGTH) {
      skipped++;
      continue;
    }

    // Write in OpenAI fine-tuning format
    output.write(JSON.stringify({ messages: record.messages }) + "\n");
    exported++;
  } catch {
    skipped++;
  }
}

output.end();

console.log(`\n✅ Export complete`);
console.log(`   Exported: ${exported} examples`);
console.log(`   Skipped:  ${skipped} (too short or malformed)`);
console.log(`   Output:   ${OUTPUT_FILE}`);
console.log(``);

if (exported < 10) {
  console.log("⚠️  Need more data. Keep using Zuno to collect examples.");
} else if (exported < 50) {
  console.log("📈 Getting there! 50+ examples recommended for fine-tuning.");
} else {
  console.log("🚀 Ready for fine-tuning! Run:");
  console.log(`   openai api fine_tunes.create -t ${OUTPUT_FILE} -m gpt-3.5-turbo`);
}
