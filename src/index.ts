import "./lib/config.js"; // validates env and warns on startup
import { logger } from "./lib/logger.js";
import { pool } from "./db/client.js";
import { initQueue, stopQueue } from "./jobs/queue.js";

async function main() {
  logger.info("metro-tennis-intel starting…");

  // Verify DB connection
  try {
    await pool.query("SELECT 1");
    logger.info("Database connection OK");
  } catch (err) {
    logger.error(err, "Database connection failed");
    process.exit(1);
  }

  // Start job queue
  await initQueue();

  logger.info("metro-tennis-intel running. Listening for jobs…");

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down…");
    await stopQueue();
    await pool.end();
    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  logger.error(err, "Fatal startup error");
  process.exit(1);
});
