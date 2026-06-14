import Anthropic from "@anthropic-ai/sdk";
import { config } from "./lib/config.js";
import { logger } from "./lib/logger.js";
import { pool } from "./db/client.js";

const client = config.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })
  : null;

const MODEL = "claude-haiku-4-5-20251001";

interface CommentRow {
  id: string;
  post_id: string;
  body: string;
  author_handle: string | null;
}

interface SentimentResult {
  comment_id: string;
  sentiment: "positive" | "neutral" | "negative";
  score: number;
  complaint_type: string | null;
  confidence: number;
}

const SYSTEM_PROMPT = `You are a sentiment classifier for Metro Tennis, a Jakarta tennis retailer (founded 1977, 6 branches).
Classify Instagram comments from Indonesian/English-speaking customers.
Indonesian slang context: "mantap" = great, "jelek" = bad, "kok gitu sih" = why is it like that (dissatisfied), "kapan restok" = when restock.
Return a JSON array. For each comment:
- sentiment: "positive" | "neutral" | "negative"
- score: -1.0 (very negative) to 1.0 (very positive)
- complaint_type: "price" | "stock" | "service" | "product_quality" | "shipping" | "other" | null (null unless negative)
- confidence: 0.0 to 1.0`;

async function classifyBatch(comments: CommentRow[]): Promise<SentimentResult[]> {
  if (!client) return [];

  const inputText = comments
    .map((c, i) => `[${i}] ${c.author_handle ?? "user"}: ${c.body}`)
    .join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Classify these ${comments.length} comments. Return a JSON array with objects: {comment_id, sentiment, score, complaint_type, confidence}. Use comment_id values: ${comments.map(c => c.id).join(", ")}\n\nComments:\n${inputText}`,
      },
    ],
  });

  const text = response.content[0]?.type === "text" ? response.content[0].text : "";
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    logger.warn({ text }, "Haiku returned no JSON array");
    return [];
  }

  const parsed = JSON.parse(jsonMatch[0]) as SentimentResult[];
  return parsed;
}

export async function runSentimentPipeline(): Promise<void> {
  if (!client) {
    logger.warn("ANTHROPIC_API_KEY not set — skipping sentiment");
    return;
  }

  // Find own-account posts not yet processed: prefer those with comments, fall back to caption
  const { rows: posts } = await pool.query<{
    post_id: string; caption: string | null; has_comments: boolean;
  }>(`
    SELECT p.id as post_id, p.caption,
      EXISTS(SELECT 1 FROM ig_comments c WHERE c.post_id = p.id) as has_comments
    FROM ig_posts p
    JOIN ig_accounts a ON a.id = p.account_id AND a.account_type = 'own'
    WHERE NOT EXISTS (SELECT 1 FROM sentiment_results sr WHERE sr.post_id = p.id)
    ORDER BY p.posted_at DESC NULLS LAST
    LIMIT 50
  `);

  if (posts.length === 0) {
    logger.info("No new posts to sentiment-process");
    return;
  }

  logger.info({ postCount: posts.length }, "Running sentiment on posts");

  for (const { post_id, caption, has_comments } of posts) {
    try {
      let comments: CommentRow[] = [];

      if (has_comments) {
        const { rows } = await pool.query<CommentRow>(
          `SELECT id, post_id, body, author_handle FROM ig_comments WHERE post_id = $1 LIMIT 200`,
          [post_id]
        );
        comments = rows;
      }

      // Fall back to caption if no comments
      if (comments.length === 0 && caption) {
        comments = [{
          id: `caption_${post_id}`,
          post_id,
          body: caption,
          author_handle: "caption",
        }];
      }

      if (comments.length === 0) continue;

      const results = await classifyBatch(comments);

      let pos = 0, neu = 0, neg = 0, totalScore = 0;
      for (const r of results) {
        if (r.sentiment === "positive") pos++;
        else if (r.sentiment === "negative") neg++;
        else neu++;
        totalScore += r.score;
      }

      const avg = results.length > 0 ? totalScore / results.length : 0;

      await pool.query(
        `INSERT INTO sentiment_results (post_id, model, comment_count, positive_count, neutral_count, negative_count, avg_sentiment_score, raw_response)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [post_id, MODEL, comments.length, pos, neu, neg, avg.toFixed(3), JSON.stringify(results)]
      );

      logger.info({ post_id, pos, neu, neg, avg: avg.toFixed(2), source: has_comments ? "comments" : "caption" }, "Sentiment saved");
    } catch (err) {
      logger.error({ err, post_id }, "Sentiment batch failed");
    }
  }
}

// Standalone runner
if (process.argv[1]?.endsWith("sentiment.ts") || process.argv[1]?.endsWith("sentiment.js")) {
  import("./lib/config.js").then(async () => {
    await runSentimentPipeline();
    await pool.end();
    process.exit(0);
  });
}
