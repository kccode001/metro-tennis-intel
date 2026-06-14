import "./lib/config.js";
import { pool } from "./db/client.js";
import { scrapeMapsReviews } from "./scrapers/maps-scraper.js";
import { scrapeYouTube } from "./scrapers/youtube-scraper.js";
import { scrapeTikTok } from "./scrapers/tiktok-scraper.js";
import { scrapeFacebook } from "./scrapers/facebook-scraper.js";
import { logger } from "./lib/logger.js";

async function main() {
  logger.info("Running all platform scrapers...");

  await Promise.allSettled([
    scrapeYouTube().then(() => logger.info("✅ YouTube done")),
    scrapeMapsReviews().then(() => logger.info("✅ Maps done")),
  ]);

  // TikTok and FB sequentially to avoid Apify concurrency issues
  try { await scrapeTikTok(); logger.info("✅ TikTok done"); }
  catch (e) { logger.error({ e }, "TikTok failed"); }

  try { await scrapeFacebook(); logger.info("✅ Facebook done"); }
  catch (e) { logger.error({ e }, "Facebook failed"); }

  logger.info("All platform scrapers complete.");
  await pool.end();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
