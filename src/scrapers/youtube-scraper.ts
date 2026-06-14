import { google } from "googleapis";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { pool } from "../db/client.js";

const CHANNEL_ID = "UC3ZaJ__WBicpDb_atvxARfg"; // @Metro.TennisTV

export async function scrapeYouTube(): Promise<void> {
  if (!config.YOUTUBE_API_KEY) {
    logger.warn("YOUTUBE_API_KEY not set — skipping YouTube scrape");
    return;
  }

  const youtube = google.youtube({ version: "v3", auth: config.YOUTUBE_API_KEY });
  const today = new Date().toISOString().split("T")[0]!;

  try {
    // Channel stats snapshot
    const channelRes = await youtube.channels.list({
      part: ["statistics", "snippet"],
      id: [CHANNEL_ID],
    });

    const channel = channelRes.data.items?.[0];
    if (channel?.statistics) {
      const stats = channel.statistics;
      await pool.query(
        `INSERT INTO yt_channel_snapshots (snapshot_date, subscriber_count, video_count, view_count)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (snapshot_date) DO UPDATE SET
           subscriber_count = EXCLUDED.subscriber_count,
           video_count = EXCLUDED.video_count,
           view_count = EXCLUDED.view_count,
           scraped_at = now()`,
        [
          today,
          parseInt(stats.subscriberCount ?? "0"),
          parseInt(stats.videoCount ?? "0"),
          parseInt(stats.viewCount ?? "0"),
        ]
      );
      logger.info(
        { subscribers: stats.subscriberCount, videos: stats.videoCount },
        "YouTube channel snapshot saved"
      );
    }

    // Latest 20 videos
    const searchRes = await youtube.search.list({
      part: ["id", "snippet"],
      channelId: CHANNEL_ID,
      order: "date",
      maxResults: 20,
      type: ["video"],
    });

    const videoIds = (searchRes.data.items ?? [])
      .map((i) => i.id?.videoId)
      .filter(Boolean) as string[];

    if (videoIds.length === 0) {
      logger.info("No videos found on channel");
      return;
    }

    // Get video stats
    const statsRes = await youtube.videos.list({
      part: ["statistics", "snippet"],
      id: videoIds,
    });

    let videosUpserted = 0;
    for (const video of statsRes.data.items ?? []) {
      const s = video.statistics;
      const sn = video.snippet;
      await pool.query(
        `INSERT INTO yt_videos (yt_video_id, title, published_at, view_count, like_count, comment_count)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (yt_video_id) DO UPDATE SET
           view_count = EXCLUDED.view_count,
           like_count = EXCLUDED.like_count,
           comment_count = EXCLUDED.comment_count,
           last_scraped_at = now()`,
        [
          video.id,
          sn?.title ?? null,
          sn?.publishedAt ? new Date(sn.publishedAt) : null,
          parseInt(s?.viewCount ?? "0"),
          parseInt(s?.likeCount ?? "0"),
          parseInt(s?.commentCount ?? "0"),
        ]
      );
      videosUpserted++;
    }

    logger.info({ videosUpserted }, "YouTube videos scraped");
  } catch (err) {
    logger.error({ err }, "YouTube scrape failed");
  }
}
