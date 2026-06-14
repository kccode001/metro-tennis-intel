/**
 * Dedicated comments scraper.
 * apify/instagram-scraper with resultsType:"posts" does NOT embed comments.
 * This scraper runs a separate resultsType:"comments" pass on own-account posts.
 */
import { ApifyClient } from "apify-client";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { pool } from "../db/client.js";
import { z } from "zod";

const ApifyCommentSchema = z.object({
  id: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
  ownerUsername: z.string().optional().nullable(),
  timestamp: z.string().optional().nullable(),
  repliesCount: z.number().optional().nullable(),
  likesCount: z.number().optional().nullable(),
}).passthrough();

export async function scrapeCommentsForOwnPosts(limit = 20): Promise<void> {
  if (!config.APIFY_API_TOKEN) {
    logger.warn("APIFY_API_TOKEN not set — skipping comments scrape");
    return;
  }

  // Get own-account posts that have no comments yet, most recent first
  const { rows: posts } = await pool.query<{
    id: string;
    shortcode: string | null;
    ig_post_id: string;
    handle: string;
  }>(`
    SELECT p.id, p.shortcode, p.ig_post_id, a.handle
    FROM ig_posts p
    JOIN ig_accounts a ON a.id = p.account_id AND a.account_type = 'own'
    WHERE NOT EXISTS (SELECT 1 FROM ig_comments c WHERE c.post_id = p.id)
      AND p.shortcode IS NOT NULL
    ORDER BY p.posted_at DESC NULLS LAST
    LIMIT $1
  `, [limit]);

  if (posts.length === 0) {
    logger.info("No own posts without comments found");
    return;
  }

  logger.info({ count: posts.length }, "Scraping comments for own posts");

  const client = new ApifyClient({ token: config.APIFY_API_TOKEN });

  // Process one post at a time to avoid shortcode matching ambiguity
  for (const post of posts) {
    if (!post.shortcode) continue;

    const postUrl = `https://www.instagram.com/p/${post.shortcode}/`;

    try {
      logger.info({ handle: post.handle, shortcode: post.shortcode }, "Fetching comments");

      const run = await client.actor("apify/instagram-scraper").call({
        directUrls: [postUrl],
        resultsType: "comments",
        resultsLimit: 100,
        addParentData: false,
        proxy: { useApifyProxy: true, apifyProxyGroups: ["RESIDENTIAL"] },
      });

      const dataset = await client.dataset(run.defaultDatasetId).listItems();
      logger.info({ itemCount: dataset.items.length, shortcode: post.shortcode }, "Comments returned");

      let inserted = 0;
      for (const rawItem of dataset.items as any[]) {
        const cp = ApifyCommentSchema.safeParse(rawItem);
        if (!cp.success) continue;

        const c = cp.data;
        if (!c.text) continue;

        const commentId = c.id
          ?? `${post.ig_post_id}_${c.ownerUsername ?? "anon"}_${c.timestamp ?? String(inserted)}`;

        await pool.query(
          `INSERT INTO ig_comments (post_id, ig_comment_id, author_handle, body, posted_at, is_reply)
           VALUES ($1, $2, $3, $4, $5, false)
           ON CONFLICT (ig_comment_id) DO UPDATE SET
             body = EXCLUDED.body,
             scraped_at = now()`,
          [
            post.id,
            commentId,
            c.ownerUsername ?? null,
            c.text,
            c.timestamp ? new Date(c.timestamp) : null,
          ]
        );
        inserted++;
      }

      logger.info({ shortcode: post.shortcode, inserted }, "Post comments saved");
    } catch (err) {
      logger.error({ err, shortcode: post.shortcode }, "Comment scrape failed for post — skipping");
    }
  }

  const { rows: countRow } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM ig_comments`
  );
  logger.info({ totalComments: countRow[0]?.count }, "Comments scrape complete");
}
