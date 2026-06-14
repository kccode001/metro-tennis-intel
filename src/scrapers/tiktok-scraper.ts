import { ApifyClient } from "apify-client";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { pool } from "../db/client.js";

const TIKTOK_HANDLE = "metro.tennis";

export async function scrapeTikTok(): Promise<void> {
  if (!config.APIFY_API_TOKEN) {
    logger.warn("APIFY_API_TOKEN not set — skipping TikTok scrape");
    return;
  }

  const client = new ApifyClient({ token: config.APIFY_API_TOKEN });
  const today = new Date().toISOString().split("T")[0]!;

  try {
    logger.info({ handle: TIKTOK_HANDLE }, "Scraping TikTok @%s", TIKTOK_HANDLE);

    const run = await client.actor("clockworks/tiktok-scraper").call({
      profiles: [`https://www.tiktok.com/@${TIKTOK_HANDLE}`],
      resultsPerPage: 30,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false,
    });

    const dataset = await client.dataset(run.defaultDatasetId).listItems();

    let videosUpserted = 0;
    let profileSaved = false;

    for (const item of dataset.items as any[]) {
      // Profile-level data (first item may have authorMeta)
      if (!profileSaved && item.authorMeta) {
        const meta = item.authorMeta;
        await pool.query(
          `INSERT INTO tiktok_snapshots (snapshot_date, follower_count, following_count, heart_count, video_count)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (snapshot_date) DO UPDATE SET
             follower_count = EXCLUDED.follower_count,
             following_count = EXCLUDED.following_count,
             heart_count = EXCLUDED.heart_count,
             video_count = EXCLUDED.video_count,
             scraped_at = now()`,
          [today, meta.fans ?? null, meta.following ?? null, meta.heart ?? null, meta.video ?? null]
        );
        profileSaved = true;
      }

      // Video data
      if (item.id) {
        await pool.query(
          `INSERT INTO tiktok_videos (tiktok_video_id, description, published_at, play_count, like_count, comment_count, share_count)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (tiktok_video_id) DO UPDATE SET
             play_count = EXCLUDED.play_count,
             like_count = EXCLUDED.like_count,
             comment_count = EXCLUDED.comment_count,
             share_count = EXCLUDED.share_count,
             last_scraped_at = now()`,
          [
            item.id,
            item.text ?? null,
            item.createTime ? new Date(item.createTime * 1000) : null,
            item.playCount ?? null,
            item.diggCount ?? null,
            item.commentCount ?? null,
            item.shareCount ?? null,
          ]
        );
        videosUpserted++;
      }
    }

    logger.info({ videosUpserted, profileSaved }, "TikTok scrape complete");
  } catch (err) {
    logger.error({ err }, "TikTok scrape failed — graceful skip");
  }
}
