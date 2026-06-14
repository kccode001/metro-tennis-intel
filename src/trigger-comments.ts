import "./lib/config.js";
import { pool } from "./db/client.js";
import { scrapeCommentsForOwnPosts } from "./scrapers/comments-scraper.js";

const limit = parseInt(process.argv[2] ?? "10");

async function main() {
  console.log(`Scraping comments for up to ${limit} own-account posts...`);
  await scrapeCommentsForOwnPosts(limit);
  console.log("Done.");
  await pool.end();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
