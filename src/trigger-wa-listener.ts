/**
 * trigger-wa-listener.ts — Entry point for the Metro Tennis WhatsApp interactive agent.
 *
 * Starts a persistent wacli webhook listener that:
 *  1. Receives messages from [Metro Tennis] Analytics WA group (120363428176735366@g.us)
 *     and DMs from the owner/KC allowlist.
 *  2. Routes each message to the Haiku NL→SQL→DB→format query handler.
 *  3. Sends the answer back to the originating chat via wacli.
 *
 * Run command (document here per AC-4):
 *   tsx src/trigger-wa-listener.ts
 *
 * For persistent operation:
 *   PM2:  pm2 start src/trigger-wa-listener.ts --interpreter tsx --name metro-wa-listener
 *   Or simply keep it running in a tmux pane.
 *
 * Env vars:
 *   WA_GROUP_JID          — Metro Analytics group (default: 120363428176735366@g.us)
 *   WA_DM_ALLOWLIST       — Comma-separated phone numbers for DM allowlist
 *                           (default: 6285161367231,6281365161000)
 *   WACLI_ACCOUNT         — wacli account name (default: cs-inbound)
 *   WACLI_WEBHOOK_PORT    — Local port for webhook HTTP server (default: 9876)
 */

import "./lib/config.js";
import { pool } from "./db/client.js";
import { startListener } from "./wa/wacli-listener.js";
import { logger } from "./lib/logger.js";

logger.info("Metro Tennis WA Interactive Agent starting (polling mode)...");
logger.info({
  group: process.env["WA_GROUP_JID"] ?? "120363428176735366@g.us",
  dmAllowlist: process.env["WA_DM_ALLOWLIST"] ?? "6285161367231,6281365161000",
  account: process.env["WACLI_ACCOUNT"] ?? "cs-inbound",
}, "Listener config");

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received — shutting down");
  await pool.end();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received — shutting down");
  await pool.end();
  process.exit(0);
});

startListener();
