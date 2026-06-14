import { ApifyClient } from "apify-client";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { pool } from "../db/client.js";

const FB_PAGE_URL = "https://www.facebook.com/people/Metro-Tennis-Terminal/100064976603441/";

export async function scrapeFacebook(): Promise<void> {
  if (!config.APIFY_API_TOKEN) {
    logger.warn("APIFY_API_TOKEN not set — skipping Facebook scrape");
    return;
  }

  const client = new ApifyClient({ token: config.APIFY_API_TOKEN });
  const today = new Date().toISOString().split("T")[0]!;

  try {
    logger.info("Scraping Facebook Metro Tennis Terminal page");

    const run = await client.actor("apify/facebook-posts-scraper").call({
      startUrls: [{ url: FB_PAGE_URL }],
      maxPosts: 20,
      maxPostComments: 0,
      maxReviews: 0,
    });

    const dataset = await client.dataset(run.defaultDatasetId).listItems();

    if (dataset.items.length === 0) {
      logger.warn("Facebook returned 0 posts — may be blocked or page inactive");
      return;
    }

    let postsUpserted = 0;
    let followerCount: number | null = null;

    for (const item of dataset.items as any[]) {
      // Page-level follower count if available
      if (item.likesCount && !followerCount) {
        followerCount = item.likesCount;
      }

      if (item.postId || item.id) {
        const postId = item.postId ?? item.id;
        await pool.query(
          `INSERT INTO fb_posts (fb_post_id, body, published_at, like_count, comment_count, share_count)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (fb_post_id) DO UPDATE SET
             like_count = EXCLUDED.like_count,
             comment_count = EXCLUDED.comment_count,
             share_count = EXCLUDED.share_count,
             last_scraped_at = now()`,
          [
            postId,
            item.text ?? item.message ?? null,
            item.time ? new Date(item.time) : null,
            item.likes ?? item.reactionsCount ?? null,
            item.comments ?? item.commentsCount ?? null,
            item.shares ?? null,
          ]
        );
        postsUpserted++;
      }
    }

    // Save page snapshot if we got follower data
    if (followerCount) {
      await pool.query(
        `INSERT INTO fb_snapshots (snapshot_date, follower_count)
         VALUES ($1, $2)
         ON CONFLICT (snapshot_date) DO UPDATE SET
           follower_count = EXCLUDED.follower_count,
           scraped_at = now()`,
        [today, followerCount]
      );
    }

    logger.info({ postsUpserted, followerCount }, "Facebook scrape complete");
  } catch (err) {
    logger.error({ err }, "Facebook scrape failed — graceful skip");
  }
}
