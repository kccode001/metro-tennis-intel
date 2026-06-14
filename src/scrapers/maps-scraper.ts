import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { pool } from "../db/client.js";

const PLACES_API_BASE = "https://maps.googleapis.com/maps/api/place";

interface PlaceReview {
  author_name: string;
  rating: number;
  text: string;
  time: number; // unix timestamp
  relative_time_description: string;
}

interface PlaceDetails {
  rating: number;
  user_ratings_total: number;
  reviews?: PlaceReview[];
}

export async function scrapeMapsReviews(): Promise<void> {
  if (!config.GOOGLE_PLACES_API_KEY) {
    logger.warn("GOOGLE_PLACES_API_KEY not set — skipping Maps scrape");
    return;
  }

  const { rows: branches } = await pool.query<{
    id: string;
    name: string;
    place_id: string;
  }>(
    `SELECT id, name, place_id FROM maps_branches WHERE is_active = true AND place_id NOT LIKE 'PENDING%'`
  );

  if (branches.length === 0) {
    logger.warn("No Maps branches with confirmed place IDs");
    return;
  }

  const today = new Date().toISOString().split("T")[0]!;

  for (const branch of branches) {
    try {
      logger.info({ branch: branch.name, placeId: branch.place_id }, "Fetching Maps reviews");

      const url = `${PLACES_API_BASE}/details/json?place_id=${branch.place_id}&fields=rating,user_ratings_total,reviews&language=id&key=${config.GOOGLE_PLACES_API_KEY}`;
      const res = await fetch(url);
      const data = (await res.json()) as { result?: PlaceDetails; status: string };

      if (data.status !== "OK" || !data.result) {
        logger.warn({ branch: branch.name, status: data.status }, "Places API returned non-OK");
        continue;
      }

      const place = data.result;

      // Save daily snapshot
      await pool.query(
        `INSERT INTO maps_snapshots (branch_id, snapshot_date, avg_rating, total_reviews)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (branch_id, snapshot_date) DO UPDATE SET
           avg_rating = EXCLUDED.avg_rating,
           total_reviews = EXCLUDED.total_reviews,
           scraped_at = now()`,
        [branch.id, today, place.rating ?? null, place.user_ratings_total ?? null]
      );

      // Upsert reviews (Places API returns up to 5 most recent)
      let reviewsUpserted = 0;
      for (const review of place.reviews ?? []) {
        const reviewId = `${branch.place_id}_${review.time}_${review.author_name.replace(/\s/g, "_")}`;
        await pool.query(
          `INSERT INTO maps_reviews (branch_id, google_review_id, author_name, rating, body, published_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (google_review_id) DO UPDATE SET
             rating = EXCLUDED.rating,
             body = EXCLUDED.body,
             scraped_at = now()`,
          [
            branch.id,
            reviewId,
            review.author_name,
            review.rating,
            review.text || null,
            new Date(review.time * 1000),
          ]
        );
        reviewsUpserted++;
      }

      logger.info(
        { branch: branch.name, rating: place.rating, totalReviews: place.user_ratings_total, reviewsUpserted },
        "Maps branch scraped"
      );
    } catch (err) {
      logger.error({ err, branch: branch.name }, "Maps scrape failed for branch");
    }
  }
}
