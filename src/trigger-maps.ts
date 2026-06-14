import "./lib/config.js";
import { pool } from "./db/client.js";
import { scrapeMapsReviews } from "./scrapers/maps-scraper.js";

async function main() {
  console.log("🗺️ Running Maps scraper...");
  await scrapeMapsReviews();
  console.log("✅ Done.");
  await pool.end();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
