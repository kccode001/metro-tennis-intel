import { pool } from "../db/client.js";

interface ReportData {
  ownPosts: number;
  totalLikes: number;
  totalComments: number;
  mapsAvgRating: number | null;
  newReviews: number;
  competitors: Array<{ handle: string; followers: number | null }>;
  unansweredConcerns: Array<{ handle: string; post: string; question: string }>;
  negativeComments: Array<{ handle: string; body: string; postCaption: string }>;
}

export async function buildDailyReport(): Promise<string> {
  const today = new Date().toISOString().split("T")[0]!;
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().split("T")[0]!;

  // Own IG summary (last 7 days)
  const { rows: igSummary } = await pool.query<{
    posts: string; total_likes: string; total_comments: string;
  }>(`
    SELECT
      COUNT(DISTINCT p.id) as posts,
      COALESCE(SUM(m.like_count), 0) as total_likes,
      COALESCE(SUM(m.comment_count), 0) as total_comments
    FROM ig_posts p
    JOIN ig_post_metrics m ON m.post_id = p.id
    JOIN ig_accounts a ON a.id = p.account_id AND a.account_type = 'own'
    WHERE p.posted_at >= $1::date
  `, [weekAgo]);

  // Maps avg rating
  const { rows: mapsRating } = await pool.query<{ avg_rating: string | null; new_reviews: string }>(`
    SELECT
      ROUND(AVG(r.rating)::numeric, 1)::text as avg_rating,
      COUNT(r.id) FILTER (WHERE r.scraped_at >= NOW() - INTERVAL '7 days') as new_reviews
    FROM maps_reviews r
  `);

  // Competitor follower counts (latest snapshot)
  const { rows: competitors } = await pool.query<{ handle: string; follower_count: number | null }>(`
    SELECT a.handle, s.follower_count
    FROM ig_accounts a
    LEFT JOIN LATERAL (
      SELECT follower_count FROM ig_account_snapshots
      WHERE account_id = a.id
      ORDER BY snapshot_date DESC LIMIT 1
    ) s ON true
    WHERE a.account_type = 'competitor'
    ORDER BY a.handle
  `);

  // Own follower counts
  const { rows: ownFollowers } = await pool.query<{ handle: string; follower_count: number | null }>(`
    SELECT a.handle, s.follower_count
    FROM ig_accounts a
    LEFT JOIN LATERAL (
      SELECT follower_count FROM ig_account_snapshots
      WHERE account_id = a.id
      ORDER BY snapshot_date DESC LIMIT 1
    ) s ON true
    WHERE a.account_type = 'own'
    ORDER BY a.handle
  `);

  // Unanswered concerns: negative/question comments not replied to by account
  // Since we lack per-comment sentiment, use keyword detection on comment body
  const { rows: unanswered } = await pool.query<{
    author_handle: string; body: string; caption: string;
  }>(`
    SELECT c.author_handle, c.body, LEFT(p.caption, 60) as caption
    FROM ig_comments c
    JOIN ig_posts p ON p.id = c.post_id
    JOIN ig_accounts a ON a.id = p.account_id AND a.account_type = 'own'
    WHERE c.is_reply = false
      AND (
        c.body ILIKE '%harga%' OR c.body ILIKE '%brp%' OR c.body ILIKE '%berapa%'
        OR c.body ILIKE '%beli%' OR c.body ILIKE '%order%' OR c.body ILIKE '%pesan%'
        OR c.body ILIKE '%restok%' OR c.body ILIKE '%stok%' OR c.body ILIKE '%ada gak%'
        OR c.body ILIKE '%gimana%' OR c.body ILIKE '%bagaimana%' OR c.body ILIKE '?%'
        OR c.body LIKE '%?'
      )
    ORDER BY c.posted_at DESC
    LIMIT 10
  `);

  // Sentiment summary (from processed posts)
  const { rows: sentimentSummary } = await pool.query<{
    positive: string; neutral: string; negative: string; total: string;
  }>(`
    SELECT
      COALESCE(SUM(positive_count), 0) as positive,
      COALESCE(SUM(neutral_count), 0) as neutral,
      COALESCE(SUM(negative_count), 0) as negative,
      COALESCE(SUM(comment_count), 0) as total
    FROM sentiment_results
    WHERE run_at >= NOW() - INTERVAL '7 days'
  `);

  const ig = igSummary[0] ?? { posts: "0", total_likes: "0", total_comments: "0" };
  const maps = mapsRating[0] ?? { avg_rating: null, new_reviews: "0" };
  const sent = sentimentSummary[0] ?? { positive: "0", neutral: "0", negative: "0", total: "0" };

  // Build message
  const lines: string[] = [];
  lines.push(`*METRO TENNIS — Daily Report ${today}*`);
  lines.push("");

  // Own IG
  lines.push("*📱 OWN ACCOUNTS*");
  for (const f of ownFollowers) {
    lines.push(`• @${f.handle}: ${f.follower_count?.toLocaleString() ?? "—"} followers`);
  }
  lines.push(`• Posts this week: ${ig.posts}`);
  lines.push(`• Likes: ${parseInt(ig.total_likes).toLocaleString()} | Comments: ${parseInt(ig.total_comments).toLocaleString()}`);
  lines.push("");

  // Sentiment
  if (parseInt(sent.total) > 0) {
    lines.push("*💬 COMMENT SENTIMENT (7 days)*");
    lines.push(`• Positive: ${sent.positive} | Neutral: ${sent.neutral} | Negative: ${sent.negative}`);
    lines.push("");
  }

  // Maps
  lines.push("*🗺️ GOOGLE MAPS*");
  lines.push(`• Avg rating: ${maps.avg_rating ?? "—"} ⭐ | New reviews: ${maps.new_reviews}`);
  lines.push("");

  // Competitors
  if (competitors.length > 0) {
    lines.push("*🏆 COMPETITORS*");
    for (const c of competitors) {
      lines.push(`• @${c.handle}: ${c.follower_count?.toLocaleString() ?? "no data"} followers`);
    }
    lines.push("");
  }

  // Unanswered concerns
  if (unanswered.length > 0) {
    lines.push("*❓ UNANSWERED CONCERNS — needs response*");
    lines.push("Commenter | Post | Question");
    for (const u of unanswered) {
      const handle = u.author_handle ? `@${u.author_handle}` : "unknown";
      const post = u.caption ? `${u.caption.substring(0, 40)}…` : "post";
      const q = u.body.substring(0, 80);
      lines.push(`${handle} | ${post} | "${q}"`);
    }
    lines.push("");
  } else {
    lines.push("*✅ No unanswered concerns flagged*");
    lines.push("");
  }

  lines.push(`_Data from metro_tennis_intel DB. Reply with a question for instant lookup._`);

  return lines.join("\n");
}
