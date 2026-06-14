import "./lib/config.js";
import { pool } from "./db/client.js";
import { runSentimentPipeline } from "./sentiment.js";

async function main() {
  console.log("Running sentiment pipeline...");
  await runSentimentPipeline();
  console.log("Done.");
  await pool.end();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
