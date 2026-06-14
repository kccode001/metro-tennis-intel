/**
 * Fallback: build daily report + send via wacli (bypasses Baileys).
 * Usage: tsx src/send-report-wacli.ts
 */
import "./lib/config.js";
import { execSync } from "child_process";
import { pool } from "./db/client.js";
import { buildDailyReport } from "./wa/report.js";
import { handleQuery } from "./wa/query-handler.js";
import { logger } from "./lib/logger.js";

const GROUP_JID = process.env["WA_GROUP_JID"] ?? "120363428176735366@g.us";

async function main() {
  logger.info("Building daily report...");
  const report = await buildDailyReport();

  logger.info({ length: report.length }, "Report built — sending via wacli");
  console.log("\n=== REPORT TEXT ===\n");
  console.log(report);
  console.log("\n=== END REPORT ===\n");

  // Send via wacli (correct subcommand: send text)
  const escapedMsg = report.replace(/'/g, "'\\''");
  const cmd = `wacli send text --to '${GROUP_JID}' --message '${escapedMsg}'`;
  logger.info({ cmd: cmd.substring(0, 80) }, "Sending via wacli...");
  const result = execSync(cmd, { encoding: "utf8" });
  logger.info({ result }, "wacli send result");
  console.log("wacli result:", result);

  // AC-4 simulation: test query handler against live DB
  logger.info("Testing query handler...");
  const question = "any unanswered comments?";
  const answer = await handleQuery(question);
  console.log("\n=== QUERY HANDLER TEST ===");
  console.log(`Q: "${question}"`);
  console.log(`A:\n${answer}`);
  console.log("=== END QUERY TEST ===\n");

  await pool.end();
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, "Failed");
  process.exit(1);
});
