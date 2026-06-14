/**
 * Standalone WA bot runner.
 * Connects with Baileys, sends daily report, listens for group queries.
 * On first run (no saved creds), prints a pairing code.
 *
 * Usage:
 *   tsx src/trigger-wa-bot.ts           # start bot (listens forever)
 *   tsx src/trigger-wa-bot.ts report    # connect, send daily report, exit
 */
import "./lib/config.js";
import fs from "fs";
import { pool } from "./db/client.js";
import { startWaBot, sendDailyReport } from "./wa/bot.js";
import { logger } from "./lib/logger.js";

const mode = process.argv[2] ?? "listen";

async function main() {
  logger.info({ mode }, "Starting WA bot");

  const sock = await startWaBot((pairingCode) => {
    // Write pairing code to a marker file so the orchestrator can escalate it
    fs.writeFileSync(".wa-pairing-code", pairingCode);
    // Also emit a structured line that can be grep'd from stdout
    process.stdout.write(`PAIRING_CODE_NEEDED:${pairingCode}\n`);
  });

  if (mode === "report") {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Connection timeout after 60s")), 60_000);
      sock.ev.on("connection.update", async ({ connection }) => {
        if (connection === "open") {
          clearTimeout(timeout);
          await sendDailyReport();
          await pool.end();
          process.exit(0);
        }
      });
    });
  }

  // listen mode — keep running
  process.on("SIGINT", async () => {
    logger.info("Shutting down WA bot");
    await pool.end();
    process.exit(0);
  });
}

main().catch((err) => {
  logger.error({ err }, "WA bot crashed");
  process.exit(1);
});
