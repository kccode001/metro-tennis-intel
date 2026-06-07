import PgBoss from "pg-boss";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { scrapeIgAccounts } from "../scrapers/ig-scraper.js";

let boss: PgBoss | null = null;

export async function initQueue(): Promise<PgBoss> {
  boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    // Retain job history for 90 days
    archiveCompletedAfterSeconds: 60 * 60 * 24 * 90,
  });

  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));

  await boss.start();
  logger.info("pg-boss started");

  // ─── Job: ig.scrape-own ──────────────────────────────────────────────────
  await boss.createQueue("ig.scrape-own", {
    retryLimit: 3,
    retryDelay: 3600, // 1h
    retryBackoff: true,
  });

  await boss.work("ig.scrape-own", async () => {
    logger.info("Running ig.scrape-own job");
    await scrapeIgAccounts("own");
    logger.info("ig.scrape-own complete");
  });

  // Schedule at 06:00 WIB = 23:00 UTC previous day
  await boss.schedule("ig.scrape-own", "0 23 * * *", {}, { tz: "UTC" });

  logger.info("Jobs registered. ig.scrape-own scheduled at 06:00 WIB (23:00 UTC)");

  return boss;
}

export async function stopQueue(): Promise<void> {
  if (boss) {
    await boss.stop();
    boss = null;
  }
}

export function getQueue(): PgBoss {
  if (!boss) throw new Error("pg-boss not initialized");
  return boss;
}
