import { db, pool } from "./client.js";
import { igAccounts } from "./schema.js";
import { logger } from "../lib/logger.js";
import { sql } from "drizzle-orm";

const IG_ACCOUNTS = [
  // Own accounts
  {
    handle: "metro.tennis",
    accountType: "own",
    displayName: "Metro Tennis",
    apifyActor: "apify/instagram-scraper",
    isActive: true,
  },
  {
    handle: "metro.tennisdeals",
    accountType: "own",
    displayName: "Metro Tennis Deals",
    apifyActor: "apify/instagram-scraper",
    isActive: true,
  },
  {
    handle: "metro.padel",
    accountType: "own",
    displayName: "Metro Padel",
    apifyActor: "apify/instagram-scraper",
    isActive: true,
  },
  // Competitor accounts
  {
    handle: "dealer.tennis",
    accountType: "competitor",
    displayName: "Dealer Tennis",
    apifyActor: "apify/instagram-scraper",
    isActive: true,
  },
  {
    handle: "footprints.tennis",
    accountType: "competitor",
    displayName: "Footprints Tennis",
    apifyActor: "apify/instagram-scraper",
    isActive: true,
  },
  {
    handle: "tirtonic",
    accountType: "competitor",
    displayName: "Tirtonic",
    apifyActor: "apify/instagram-scraper",
    isActive: true,
  },
  {
    handle: "tirtonic.id",
    accountType: "competitor",
    displayName: "Tirtonic ID",
    apifyActor: "apify/instagram-scraper",
    isActive: true,
  },
];

async function seed() {
  logger.info("Seeding ig_accounts…");

  for (const account of IG_ACCOUNTS) {
    await db
      .insert(igAccounts)
      .values(account)
      .onConflictDoUpdate({
        target: igAccounts.handle,
        set: {
          displayName: sql`EXCLUDED.display_name`,
          accountType: sql`EXCLUDED.account_type`,
          apifyActor: sql`EXCLUDED.apify_actor`,
          isActive: sql`EXCLUDED.is_active`,
        },
      });
  }

  logger.info({ count: IG_ACCOUNTS.length }, "ig_accounts seeded");
  await pool.end();
}

seed().catch((err) => {
  logger.error(err, "Seed failed");
  process.exit(1);
});
