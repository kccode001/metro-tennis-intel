import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  numeric,
  date,
  timestamp,
  jsonb,
  unique,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ─── IG Accounts ─────────────────────────────────────────────────────────────

export const igAccounts = pgTable("ig_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  handle: text("handle").notNull().unique(),
  accountType: text("account_type").notNull(), // 'own' | 'competitor'
  displayName: text("display_name"),
  apifyActor: text("apify_actor"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── IG Account Snapshots ─────────────────────────────────────────────────────

export const igAccountSnapshots = pgTable(
  "ig_account_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => igAccounts.id),
    snapshotDate: date("snapshot_date").notNull(),
    followerCount: integer("follower_count"),
    followingCount: integer("following_count"),
    postCount: integer("post_count"),
    avgEngagementRate: numeric("avg_engagement_rate", { precision: 6, scale: 4 }),
    scrapedAt: timestamp("scraped_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique().on(t.accountId, t.snapshotDate)]
);

// ─── IG Posts ─────────────────────────────────────────────────────────────────

export const igPosts = pgTable("ig_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => igAccounts.id),
  igPostId: text("ig_post_id").notNull().unique(),
  shortcode: text("shortcode"),
  postType: text("post_type"), // 'photo' | 'video' | 'reel' | 'carousel'
  caption: text("caption"),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  firstScrapedAt: timestamp("first_scraped_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── IG Post Metrics ──────────────────────────────────────────────────────────

export const igPostMetrics = pgTable(
  "ig_post_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    postId: uuid("post_id")
      .notNull()
      .references(() => igPosts.id),
    snapshotDate: date("snapshot_date").notNull(),
    likeCount: integer("like_count"),
    commentCount: integer("comment_count"),
    shareCount: integer("share_count"),
    playCount: integer("play_count"),
    scrapedAt: timestamp("scraped_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [unique().on(t.postId, t.snapshotDate)]
);

// ─── IG Comments ─────────────────────────────────────────────────────────────

export const igComments = pgTable("ig_comments", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => igPosts.id),
  igCommentId: text("ig_comment_id").notNull().unique(),
  authorHandle: text("author_handle"),
  body: text("body").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  isReply: boolean("is_reply").default(false).notNull(),
  parentCommentId: uuid("parent_comment_id"),
  scrapedAt: timestamp("scraped_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

// ─── Sentiment Results ────────────────────────────────────────────────────────

export const sentimentResults = pgTable("sentiment_results", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .notNull()
    .references(() => igPosts.id),
  runAt: timestamp("run_at", { withTimezone: true }).defaultNow().notNull(),
  model: text("model").default("claude-haiku-4-5").notNull(),
  commentCount: integer("comment_count"),
  positiveCount: integer("positive_count"),
  neutralCount: integer("neutral_count"),
  negativeCount: integer("negative_count"),
  avgSentimentScore: numeric("avg_sentiment_score", { precision: 4, scale: 3 }),
  alertTriggered: boolean("alert_triggered").default(false).notNull(),
  rawResponse: jsonb("raw_response"),
});

// ─── Scrape Runs ──────────────────────────────────────────────────────────────

export const scrapeRuns = pgTable("scrape_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobType: text("job_type").notNull(), // 'ig.scrape-own' | 'ig.scrape-competitors'
  accountId: uuid("account_id").references(() => igAccounts.id),
  status: text("status").notNull(), // 'running' | 'success' | 'failed' | 'retrying'
  startedAt: timestamp("started_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  retryCount: integer("retry_count").default(0).notNull(),
  postsScraped: integer("posts_scraped"),
  reviewsScraped: integer("reviews_scraped"),
});
