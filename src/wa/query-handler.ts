import Anthropic from "@anthropic-ai/sdk";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { pool } from "../db/client.js";

const client = config.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
  : null;

const SYSTEM_PROMPT = `You are a data assistant for Metro Tennis, a Jakarta tennis retailer.
You answer questions about the business's social media performance using only data from a PostgreSQL database.

Available tables and what they contain:
- ig_accounts: Instagram accounts (handle, account_type: own/competitor)
- ig_account_snapshots: daily follower/post counts per account (snapshot_date, follower_count)
- ig_posts: posts (account_id, caption, posted_at, shortcode)
- ig_post_metrics: daily post metrics (like_count, comment_count, play_count, snapshot_date)
- ig_comments: comments on own posts (body, author_handle, posted_at)
- sentiment_results: sentiment analysis per post (positive_count, neutral_count, negative_count, avg_sentiment_score, run_at)
- maps_branches: 6 Metro Tennis branch locations (name, place_id)
- maps_reviews: Google Maps reviews (rating, body, author_name, published_at)
- maps_snapshots: daily Maps ratings per branch (avg_rating, total_reviews, snapshot_date)
- tiktok_snapshots: TikTok follower/video counts
- tiktok_videos: TikTok video metrics (play_count, like_count)
- yt_channel_snapshots: YouTube subscriber counts
- yt_videos: YouTube video metrics
- fb_snapshots: Facebook page followers
- fb_posts: Facebook post metrics

When a question is about data you can retrieve:
1. Write a PostgreSQL SELECT query to get the answer
2. Return ONLY a JSON object: {"sql": "<your query>", "description": "<what this query returns in plain English>"}

When a question is outside your data scope (stock levels, orders, prices, etc.):
Return: {"sql": null, "description": "I don't have that data. I can only answer questions about social media performance, Maps reviews, and follower counts."}

Rules:
- Only SELECT queries. Never INSERT/UPDATE/DELETE.
- Always LIMIT results (max 20 rows unless asked for more).
- Prefer human-readable column aliases.
- For "this week" use: WHERE x >= NOW() - INTERVAL '7 days'
- For "today" use: WHERE date_trunc('day', x) = CURRENT_DATE`;

export async function handleQuery(question: string): Promise<string> {
  if (!client) return "Sorry, AI query not available (no API key).";

  try {
    const response = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 512,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: question }],
    });

    const text = response.content[0]?.type === "text" ? response.content[0].text : "";

    // Extract the first valid JSON object (non-greedy to avoid swallowing trailing text)
    let parsed: { sql: string | null; description: string } | null = null;
    const jsonCandidates = text.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)?\}/g) ?? [];
    // Also try full greedy match as fallback for nested objects
    const greedyMatch = text.match(/\{[\s\S]*?\}/);
    const candidates = [...jsonCandidates, greedyMatch?.[0] ?? ""].filter(Boolean);
    for (const candidate of candidates) {
      try {
        const p = JSON.parse(candidate) as { sql?: string | null; description?: string };
        if ("description" in p) { parsed = { sql: p.sql ?? null, description: p.description ?? "" }; break; }
      } catch { /* try next */ }
    }
    // Last resort: try stripping markdown code fences
    if (!parsed) {
      const stripped = text.replace(/```(?:json)?/g, "").trim();
      const m = stripped.match(/\{[\s\S]*\}/);
      if (m) try { parsed = JSON.parse(m[0]); } catch { /* ignore */ }
    }
    if (!parsed) return "Couldn't parse the query — please try again.";
    const { sql, description } = parsed;

    if (!sql) return description;

    // Execute the query
    const { rows } = await pool.query(sql);

    if (rows.length === 0) return `${description}\n\nResult: No data found.`;

    // Format rows as a simple text table
    const cols = Object.keys(rows[0]!);
    const header = cols.join(" | ");
    const divider = cols.map(() => "---").join(" | ");
    const body = rows.map(r => cols.map(c => String(r[c] ?? "—")).join(" | ")).join("\n");

    return `*${description}*\n\n${header}\n${divider}\n${body}`;
  } catch (err) {
    logger.error({ err }, "Query handler error");
    return "Sorry, something went wrong. Please try again.";
  }
}
