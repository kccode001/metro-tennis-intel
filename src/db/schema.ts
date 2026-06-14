import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  real,
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

// ─── Google Maps ──────────────────────────────────────────────────────────────

export const mapsBranches = pgTable("maps_branches", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  placeId: text("place_id").notNull().unique(),
  address: text("address"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const mapsReviews = pgTable("maps_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  branchId: uuid("branch_id").references(() => mapsBranches.id).notNull(),
  googleReviewId: text("google_review_id").notNull().unique(),
  authorName: text("author_name"),
  rating: integer("rating"), // 1-5
  body: text("body"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  sentimentScore: real("sentiment_score"),
  sentimentLabel: text("sentiment_label"), // 'positive' | 'negative' | 'neutral'
  scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
});

export const mapsSnapshots = pgTable(
  "maps_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    branchId: uuid("branch_id").references(() => mapsBranches.id).notNull(),
    snapshotDate: text("snapshot_date").notNull(), // YYYY-MM-DD
    avgRating: real("avg_rating"),
    totalReviews: integer("total_reviews"),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.branchId, t.snapshotDate)]
);

// ─── YouTube ─────────────────────────────────────────────────────────────────

export const ytChannelSnapshots = pgTable(
  "yt_channel_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotDate: text("snapshot_date").notNull(), // YYYY-MM-DD
    subscriberCount: integer("subscriber_count"),
    videoCount: integer("video_count"),
    viewCount: integer("view_count"),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.snapshotDate)]
);

export const ytVideos = pgTable("yt_videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  ytVideoId: text("yt_video_id").notNull().unique(),
  title: text("title"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  viewCount: integer("view_count"),
  likeCount: integer("like_count"),
  commentCount: integer("comment_count"),
  lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── TikTok ──────────────────────────────────────────────────────────────────

export const tiktokSnapshots = pgTable(
  "tiktok_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotDate: text("snapshot_date").notNull(),
    followerCount: integer("follower_count"),
    followingCount: integer("following_count"),
    heartCount: integer("heart_count"),
    videoCount: integer("video_count"),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.snapshotDate)]
);

export const tiktokVideos = pgTable("tiktok_videos", {
  id: uuid("id").primaryKey().defaultRandom(),
  tiktokVideoId: text("tiktok_video_id").notNull().unique(),
  description: text("description"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  playCount: integer("play_count"),
  likeCount: integer("like_count"),
  commentCount: integer("comment_count"),
  shareCount: integer("share_count"),
  lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Facebook ────────────────────────────────────────────────────────────────

export const fbSnapshots = pgTable(
  "fb_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotDate: text("snapshot_date").notNull(),
    followerCount: integer("follower_count"),
    likeCount: integer("like_count"),
    scrapedAt: timestamp("scraped_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.snapshotDate)]
);

export const fbPosts = pgTable("fb_posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  fbPostId: text("fb_post_id").notNull().unique(),
  body: text("body"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  likeCount: integer("like_count"),
  commentCount: integer("comment_count"),
  shareCount: integer("share_count"),
  lastScrapedAt: timestamp("last_scraped_at", { withTimezone: true }).defaultNow().notNull(),
});
