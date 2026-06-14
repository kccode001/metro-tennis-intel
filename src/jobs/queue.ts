import PgBoss from "pg-boss";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { scrapeIgAccounts } from "../scrapers/ig-scraper.js";
import { scrapeMapsReviews } from "../scrapers/maps-scraper.js";
import { scrapeYouTube } from "../scrapers/youtube-scraper.js";
import { scrapeTikTok } from "../scrapers/tiktok-scraper.js";
import { scrapeFacebook } from "../scrapers/facebook-scraper.js";
import { runSentimentPipeline } from "../sentiment.js";

let boss: PgBoss | null = null;

export async function initQueue(): Promise<PgBoss> {
  boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    archiveCompletedAfterSeconds: 60 * 60 * 24 * 90,
  });

  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  await boss.start();
  logger.info("pg-boss started");

  // ─── ig.scrape-own — 06:00 WIB (23:00 UTC) ──────────────────────────────
  await boss.work("ig.scrape-own", async () => {
    logger.info("Running ig.scrape-own");
    await scrapeIgAccounts("own");
    await boss!.send("sentiment.process", {});
  });
  await boss.schedule("ig.scrape-own", "0 23 * * *", {}, { tz: "UTC" });

  // ─── ig.scrape-competitors — 07:00 WIB (00:00 UTC) ──────────────────────
  await boss.work("ig.scrape-competitors", async () => {
    logger.info("Running ig.scrape-competitors");
    await scrapeIgAccounts("competitor");
  });
  await boss.schedule("ig.scrape-competitors", "0 0 * * *", {}, { tz: "UTC" });

  // ─── maps.fetch-reviews — hourly ─────────────────────────────────────────
  await boss.work("maps.fetch-reviews", async () => {
    logger.info("Running maps.fetch-reviews");
    await scrapeMapsReviews();
  });
  await boss.schedule("maps.fetch-reviews", "0 * * * *", {}, { tz: "UTC" });

  // ─── yt.scrape — 06:30 WIB (23:30 UTC) ──────────────────────────────────
  await boss.work("yt.scrape", async () => {
    logger.info("Running yt.scrape");
    await scrapeYouTube();
  });
  await boss.schedule("yt.scrape", "30 23 * * *", {}, { tz: "UTC" });

  // ─── tiktok.scrape — 06:45 WIB (23:45 UTC) ──────────────────────────────
  await boss.work("tiktok.scrape", async () => {
    logger.info("Running tiktok.scrape");
    await scrapeTikTok();
  });
  await boss.schedule("tiktok.scrape", "45 23 * * *", {}, { tz: "UTC" });

  // ─── fb.scrape — 07:15 WIB (00:15 UTC) ──────────────────────────────────
  await boss.work("fb.scrape", async () => {
    logger.info("Running fb.scrape");
    await scrapeFacebook();
  });
  await boss.schedule("fb.scrape", "15 0 * * *", {}, { tz: "UTC" });

  // ─── sentiment.process — triggered post-scrape ───────────────────────────
  await boss.work("sentiment.process", async () => {
    logger.info("Running sentiment.process");
    await runSentimentPipeline();
  });

  logger.info("All jobs registered");
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
