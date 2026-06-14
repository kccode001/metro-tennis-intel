import "./lib/config.js";
import { scrapeIgAccounts } from "./scrapers/ig-scraper.js";
import { pool } from "./db/client.js";

const mode = (process.argv[2] ?? "own") as "own" | "competitor";

async function main() {
  console.log(`Running IG scrape for ${mode} accounts...`);
  await scrapeIgAccounts(mode);
  console.log("Scrape complete.");
  await pool.end();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
