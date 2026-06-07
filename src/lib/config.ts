import "dotenv/config";
import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  APIFY_API_TOKEN: z.string().optional(),
  GOOGLE_PLACES_API_KEY: z.string().optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  DISCORD_WEBHOOK_URL: z.string().optional(),
  WA_GROUP_JID: z.string().optional(),
  INTERNAL_API_SECRET: z.string().optional(),
  NEGATIVE_COMMENT_THRESHOLD: z.coerce.number().default(3),
  NEGATIVE_COMMENT_WINDOW_HOURS: z.coerce.number().default(4),
  CRITICAL_SENTIMENT_SCORE: z.coerce.number().default(-0.7),
});

const parsed = configSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;

// Warn about missing optional keys that are required for full functionality
const warnings: string[] = [];
if (!config.APIFY_API_TOKEN)
  warnings.push("APIFY_API_TOKEN not set — IG scraping will be skipped");
if (!config.ANTHROPIC_API_KEY)
  warnings.push("ANTHROPIC_API_KEY not set — sentiment analysis disabled");
if (!config.DISCORD_WEBHOOK_URL)
  warnings.push("DISCORD_WEBHOOK_URL not set — Discord delivery disabled");
if (!config.WA_GROUP_JID)
  warnings.push("WA_GROUP_JID not set — WhatsApp delivery disabled (will use Discord only)");

if (warnings.length > 0) {
  for (const w of warnings) {
    console.warn(`⚠️  ${w}`);
  }
}
