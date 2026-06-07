CREATE TABLE "ig_account_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"follower_count" integer,
	"following_count" integer,
	"post_count" integer,
	"avg_engagement_rate" numeric(6, 4),
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ig_account_snapshots_account_id_snapshot_date_unique" UNIQUE("account_id","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "ig_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"account_type" text NOT NULL,
	"display_name" text,
	"apify_actor" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ig_accounts_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "ig_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"ig_comment_id" text NOT NULL,
	"author_handle" text,
	"body" text NOT NULL,
	"posted_at" timestamp with time zone,
	"is_reply" boolean DEFAULT false NOT NULL,
	"parent_comment_id" uuid,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ig_comments_ig_comment_id_unique" UNIQUE("ig_comment_id")
);
--> statement-breakpoint
CREATE TABLE "ig_post_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"like_count" integer,
	"comment_count" integer,
	"share_count" integer,
	"play_count" integer,
	"scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ig_post_metrics_post_id_snapshot_date_unique" UNIQUE("post_id","snapshot_date")
);
--> statement-breakpoint
CREATE TABLE "ig_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"ig_post_id" text NOT NULL,
	"shortcode" text,
	"post_type" text,
	"caption" text,
	"posted_at" timestamp with time zone,
	"first_scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_scraped_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ig_posts_ig_post_id_unique" UNIQUE("ig_post_id")
);
--> statement-breakpoint
CREATE TABLE "scrape_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_type" text NOT NULL,
	"account_id" uuid,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error_message" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"posts_scraped" integer,
	"reviews_scraped" integer
);
--> statement-breakpoint
CREATE TABLE "sentiment_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"model" text DEFAULT 'claude-haiku-4-5' NOT NULL,
	"comment_count" integer,
	"positive_count" integer,
	"neutral_count" integer,
	"negative_count" integer,
	"avg_sentiment_score" numeric(4, 3),
	"alert_triggered" boolean DEFAULT false NOT NULL,
	"raw_response" jsonb
);
--> statement-breakpoint
ALTER TABLE "ig_account_snapshots" ADD CONSTRAINT "ig_account_snapshots_account_id_ig_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ig_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_comments" ADD CONSTRAINT "ig_comments_post_id_ig_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ig_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_post_metrics" ADD CONSTRAINT "ig_post_metrics_post_id_ig_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ig_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ig_posts" ADD CONSTRAINT "ig_posts_account_id_ig_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ig_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scrape_runs" ADD CONSTRAINT "scrape_runs_account_id_ig_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ig_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sentiment_results" ADD CONSTRAINT "sentiment_results_post_id_ig_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."ig_posts"("id") ON DELETE no action ON UPDATE no action;