import "./lib/config.js";
import { handleQuery } from "./wa/query-handler.js";
import { pool } from "./db/client.js";

async function main() {
  const question = "how many negative comments did we get this week?";
  const answer = await handleQuery(question);

  console.log("\n=== QUERY HANDLER LIVE TEST ===");
  console.log(`Q: "${question}"`);
  console.log(`A:\n${answer}`);
  console.log("=== END ===\n");

  await pool.end();
}

main().catch(console.error);
