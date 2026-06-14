import { ApifyClient } from "apify-client";
import { config } from "../lib/config.js";
import { logger } from "../lib/logger.js";
import { db } from "../db/client.js";
import {
  igAccounts,
  igPosts,
  igPostMetrics,
  igComments,
  igAccountSnapshots,
  scrapeRuns,
} from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";

// ─── Apify result shapes ──────────────────────────────────────────────────────

const ApifyPostSchema = z.object({
  id: z.string(),
  shortCode: z.string().optional(),
  type: z.string().optional(),
  caption: z.string().optional().nullable(),
  timestamp: z.string().optional().nullable(),
  likesCount: z.number().optional().nullable(),
  commentsCount: z.number().optional().nullable(),
  videoViewCount: z.number().optional().nullable(),
  videoPlayCount: z.number().optional().nullable(),
  ownerId: z.string().optional(),
  ownerUsername: z.string().optional(),
});

const ApifyCommentSchema = z.object({
  id: z.string(),
  text: z.string(),
  timestamp: z.string().optional().nullable(),
  ownerUsername: z.string().optional().nullable(),
  isOwnerComment: z.boolean().optional(),
  replies: z.array(z.any()).optional(),
});

const ApifyProfileSchema = z.object({
  username: z.string(),
  fullName: z.string().optional().nullable(),
  followersCount: z.number().optional().nullable(),
  followsCount: z.number().optional().nullable(),
  postsCount: z.number().optional().nullable(),
});

// ─── Scraper ─────────────────────────────────────────────────────────────────

export async function scrapeIgAccounts(
  accountType: "own" | "competitor"
): Promise<void> {
  if (!config.APIFY_API_TOKEN) {
    logger.warn("APIFY_API_TOKEN not set — skipping IG scrape");
    return;
  }

  const client = new ApifyClient({ token: config.APIFY_API_TOKEN });

  const accounts = await db
    .select()
    .from(igAccounts)
    .where(eq(igAccounts.accountType, accountType));

  if (accounts.length === 0) {
    logger.warn({ accountType }, "No accounts found for type");
    return;
  }

  logger.info({ accountType, count: accounts.length }, "Starting IG scrape");

  for (const account of accounts) {
    const runRecord = await db
      .insert(scrapeRuns)
      .values({
        jobType:
          accountType === "own" ? "ig.scrape-own" : "ig.scrape-competitors",
        accountId: account.id,
        status: "running",
      })
      .returning();

    const run = runRecord[0];
    if (!run) continue;

    try {
      logger.info({ handle: account.handle }, "Scraping @%s", account.handle);

      const actorRun = await client.actor("apify/instagram-scraper").call({
        directUrls: [`https://www.instagram.com/${account.handle}/`],
        resultsType: "posts",
        resultsLimit: 100,
        addParentData: false,
        scrapeComments: accountType === "own",
        commentsSortOrder: "recent",
        commentsLimit: 100,
        extendOutputFunction: undefined,
        proxy: {
          useApifyProxy: true,
          apifyProxyGroups: ["RESIDENTIAL"],
        },
      });

      const dataset = await client
        .dataset(actorRun.defaultDatasetId)
        .listItems();

      let postsUpserted = 0;
      const today = new Date().toISOString().split("T")[0];

      for (const rawItem of dataset.items) {
        const parseResult = ApifyPostSchema.safeParse(rawItem);
        if (!parseResult.success) {
          logger.warn({ err: parseResult.error }, "Unexpected post shape");
          continue;
        }
        const item = parseResult.data;

        // Upsert post
        const postRows = await db
          .insert(igPosts)
          .values({
            accountId: account.id,
            igPostId: item.id,
            shortcode: item.shortCode ?? null,
            postType: item.type ?? null,
            caption: item.caption ?? null,
            postedAt: item.timestamp ? new Date(item.timestamp) : null,
            lastScrapedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: igPosts.igPostId,
            set: {
              caption: sql`EXCLUDED.caption`,
              lastScrapedAt: sql`now()`,
            },
          })
          .returning();

        const post = postRows[0];
        if (!post) continue;

        // Upsert daily metrics
        await db
          .insert(igPostMetrics)
          .values({
            postId: post.id,
            snapshotDate: today as string,
            likeCount: item.likesCount ?? null,
            commentCount: item.commentsCount ?? null,
            shareCount: null,
            playCount: item.videoPlayCount ?? item.videoViewCount ?? null,
          })
          .onConflictDoUpdate({
            target: [igPostMetrics.postId, igPostMetrics.snapshotDate],
            set: {
              likeCount: sql`EXCLUDED.like_count`,
              commentCount: sql`EXCLUDED.comment_count`,
              playCount: sql`EXCLUDED.play_count`,
              scrapedAt: sql`now()`,
            },
          });

        postsUpserted++;

        // Upsert comments for own accounts
        if (accountType === "own" && Array.isArray((rawItem as any).comments)) {
          for (const rawComment of (rawItem as any).comments) {
            const cp = ApifyCommentSchema.safeParse(rawComment);
            if (!cp.success) continue;
            const c = cp.data;

            await db
              .insert(igComments)
              .values({
                postId: post.id,
                igCommentId: c.id,
                authorHandle: c.ownerUsername ?? null,
                body: c.text,
                postedAt: c.timestamp ? new Date(c.timestamp) : null,
                isReply: false,
                parentCommentId: null,
              })
              .onConflictDoUpdate({
                target: igComments.igCommentId,
                set: {
                  body: sql`EXCLUDED.body`,
                  scrapedAt: sql`now()`,
                },
              });
          }
        }
      }

      // Attempt to get profile-level snapshot from dataset metadata
      // The instagram-scraper actor also returns profile data
      const profileItem = dataset.items.find(
        (i: any) => i.username && i.followersCount !== undefined
      );
      if (profileItem) {
        const pp = ApifyProfileSchema.safeParse(profileItem);
        if (pp.success) {
          const p = pp.data;
          await db
            .insert(igAccountSnapshots)
            .values({
              accountId: account.id,
              snapshotDate: today as string,
              followerCount: p.followersCount ?? null,
              followingCount: p.followsCount ?? null,
              postCount: p.postsCount ?? null,
            })
            .onConflictDoUpdate({
              target: [
                igAccountSnapshots.accountId,
                igAccountSnapshots.snapshotDate,
              ],
              set: {
                followerCount: sql`EXCLUDED.follower_count`,
                followingCount: sql`EXCLUDED.following_count`,
                postCount: sql`EXCLUDED.post_count`,
                scrapedAt: sql`now()`,
              },
            });
        }
      }

      // Mark run success
      await db
        .update(scrapeRuns)
        .set({
          status: "success",
          completedAt: new Date(),
          postsScraped: postsUpserted,
        })
        .where(eq(scrapeRuns.id, run.id));

      logger.info(
        { handle: account.handle, postsUpserted },
        "Scrape complete for @%s",
        account.handle
      );
    } catch (err) {
      logger.error({ err, handle: account.handle }, "Scrape failed");
      await db
        .update(scrapeRuns)
        .set({
          status: "failed",
          completedAt: new Date(),
          errorMessage: err instanceof Error ? err.message : String(err),
        })
        .where(eq(scrapeRuns.id, run.id));
    }
  }
}
