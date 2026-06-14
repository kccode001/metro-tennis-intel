/**
 * wacli-listener.ts — Inbound WhatsApp handler for Metro Tennis.
 *
 * Architecture (v2 — polling):
 *  - Runs `wacli sync --follow` as a child process to keep the local store fresh.
 *  - Every POLL_INTERVAL_MS, reads new messages from the wacli store via
 *    `wacli messages list --after <lastPollTime>` for the Metro group and DM allowlist.
 *  - Webhook delivery (`wacli sync --webhook`) proved unreliable for live-tail events;
 *    polling the local DB is the correct pattern for wacli 0.9.2.
 *  - Route to handleQuery (Haiku NL→SQL→DB→format).
 *  - Reply via `wacli send text`.
 */

import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { handleQuery } from "./query-handler.js";
import { logger } from "../lib/logger.js";

const execFileAsync = promisify(execFile);

// --- Config ---
const POLL_INTERVAL_MS = 15_000; // poll every 15 seconds
const WACLI_ACCOUNT = process.env["WACLI_ACCOUNT"] ?? "cs-inbound";

// The Metro Tennis Analytics group JID
const METRO_GROUP_JID = process.env["WA_GROUP_JID"] ?? "120363428176735366@g.us";

// DM allowlist: KC + owner (base numbers; wacli uses @s.whatsapp.net suffix)
const DM_ALLOWLIST_RAW: string[] = (
  process.env["WA_DM_ALLOWLIST"] ?? "6285161367231,6281365161000"
).split(",").map(n => n.trim()).filter(Boolean);

const DM_ALLOWLIST_JIDS = DM_ALLOWLIST_RAW.map(n => `${n}@s.whatsapp.net`);

// Chats to monitor
const MONITORED_CHATS = [METRO_GROUP_JID, ...DM_ALLOWLIST_JIDS];

// --- Persistent state files ---
const DEDUP_FILE = join(process.cwd(), ".wa-dedup.json");
const POLL_STATE_FILE = join(process.cwd(), ".wa-poll-state.json");
const MAX_DEDUP_SIZE = 1000;

function loadProcessedIds(): Set<string> {
  try {
    if (existsSync(DEDUP_FILE)) {
      const arr = JSON.parse(readFileSync(DEDUP_FILE, "utf8")) as string[];
      return new Set(arr);
    }
  } catch { /* start fresh on parse error */ }
  return new Set<string>();
}

function saveProcessedId(id: string, set: Set<string>): void {
  set.add(id);
  try {
    let arr = Array.from(set);
    if (arr.length > MAX_DEDUP_SIZE) arr = arr.slice(arr.length - MAX_DEDUP_SIZE);
    writeFileSync(DEDUP_FILE, JSON.stringify(arr), "utf8");
  } catch { /* non-fatal */ }
}

function loadPollState(): { lastPollTime: string } {
  try {
    if (existsSync(POLL_STATE_FILE)) {
      return JSON.parse(readFileSync(POLL_STATE_FILE, "utf8")) as { lastPollTime: string };
    }
  } catch { /* start fresh */ }
  // Default: look back 5 minutes on first run to catch any missed messages
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  return { lastPollTime: fiveMinAgo };
}

function savePollState(state: { lastPollTime: string }): void {
  try {
    writeFileSync(POLL_STATE_FILE, JSON.stringify(state), "utf8");
  } catch { /* non-fatal */ }
}

const processedMsgIds = loadProcessedIds();

// --- wacli message shape ---
interface WacliMessage {
  ChatJID: string;
  ChatName: string;
  MsgID: string;
  SenderJID: string;
  SenderName: string;
  Timestamp: string;
  FromMe: boolean;
  Text: string;
  MediaType?: string;
}

interface WacliListResponse {
  success: boolean;
  data: { messages: WacliMessage[] };
  error: string | null;
}

// --- Fetch new messages from wacli store ---
async function fetchNewMessages(chatJid: string, after: string): Promise<WacliMessage[]> {
  const args = [
    "messages", "list",
    "--account", WACLI_ACCOUNT,
    "--chat", chatJid,
    "--from-them",
    "--after", after,
    "--asc",          // oldest first — process in chronological order
    "--json",
    "--limit", "50",
    "--read-only",    // avoid write lock conflicts with sync subprocess
  ];

  try {
    const { stdout } = await execFileAsync("wacli", args, { timeout: 15_000 });
    const result = JSON.parse(stdout) as WacliListResponse;
    return result.data?.messages ?? [];
  } catch (err) {
    logger.warn({ err, chatJid }, "wacli messages list failed (non-fatal)");
    return [];
  }
}

// --- Reply via wacli ---
async function sendReply(
  chatJid: string,
  text: string,
  quoteMsgId?: string,
  quoteSenderJid?: string,
): Promise<string> {
  const args = [
    "send", "text",
    "--account", WACLI_ACCOUNT,
    "--to", chatJid,
    "--message", text,
  ];

  // Group reply: wacli requires --reply-to + --reply-to-sender for unsynced group msgs
  if (quoteMsgId) {
    args.push("--reply-to", quoteMsgId);
    if (quoteSenderJid && chatJid.endsWith("@g.us") && quoteSenderJid !== "") {
      args.push("--reply-to-sender", quoteSenderJid);
    }
  }

  // --lock-wait: wacli sync holds the store lock; wait up to 30s for it to release
  args.push("--lock-wait", "30s");

  logger.info({ chatJid, textLen: text.length }, "Sending reply via wacli");
  const { stdout } = await execFileAsync("wacli", args, { timeout: 60_000 });
  logger.info({ stdout }, "wacli send result");
  const idMatch = stdout.match(/([A-F0-9]{20,})/i);
  return idMatch?.[1] ?? stdout.trim();
}

// --- Process a single inbound message ---
async function processMessage(msg: WacliMessage): Promise<void> {
  // Skip non-text
  if (!msg.Text || msg.Text.trim() === "") return;

  // Dedup
  if (processedMsgIds.has(msg.MsgID)) {
    logger.debug({ msgId: msg.MsgID }, "Already processed — skipping duplicate");
    return;
  }

  const question = msg.Text.trim();
  logger.info({ chatJid: msg.ChatJID, sender: msg.SenderName, question }, "Inbound question");

  try {
    const answer = await handleQuery(question);
    const deliveryId = await sendReply(msg.ChatJID, answer, msg.MsgID, msg.SenderJID);
    // Mark processed only after successful reply
    saveProcessedId(msg.MsgID, processedMsgIds);
    logger.info({ chatJid: msg.ChatJID, deliveryId }, "Reply sent");

    await appendProof({
      timestamp: new Date().toISOString(),
      chatJid: msg.ChatJID,
      sender: msg.SenderName || msg.SenderJID,
      inboundText: question,
      botReply: answer,
      deliveryId,
    });
  } catch (err) {
    logger.error({ err, chatJid: msg.ChatJID }, "Failed to handle inbound message");
  }
}

// --- Proof log ---
interface ProofEntry {
  timestamp: string;
  chatJid: string;
  sender: string;
  inboundText: string;
  botReply: string;
  deliveryId: string;
}

async function appendProof(entry: ProofEntry): Promise<void> {
  const { appendFile, mkdir } = await import("fs/promises");
  const date = entry.timestamp.split("T")[0]!;
  const dir = join(process.cwd(), "proof");
  await mkdir(dir, { recursive: true });
  const file = join(dir, `wa-roundtrip-${date}.txt`);
  const block = [
    `=== ${entry.timestamp} ===`,
    `Chat: ${entry.chatJid}`,
    `Sender: ${entry.sender}`,
    `Inbound: ${entry.inboundText}`,
    `Bot reply: ${entry.botReply}`,
    `Delivery ID: ${entry.deliveryId}`,
    ``,
  ].join("\n");
  await appendFile(file, block, "utf8");
  logger.info({ file }, "Proof appended");
}

// --- Polling loop ---
let pollRunning = false;

async function pollOnce(): Promise<void> {
  if (pollRunning) return; // don't overlap polls
  pollRunning = true;

  const state = loadPollState();
  const pollTime = state.lastPollTime;
  const newPollTime = new Date().toISOString();

  try {
    for (const chatJid of MONITORED_CHATS) {
      const messages = await fetchNewMessages(chatJid, pollTime);
      if (messages.length > 0) {
        logger.info({ chatJid, count: messages.length }, "Poll: found new messages");
      }
      for (const msg of messages) {
        await processMessage(msg);
      }
    }
    // Only advance the poll cursor after a successful round
    savePollState({ lastPollTime: newPollTime });
  } catch (err) {
    logger.error({ err }, "Poll cycle error");
  } finally {
    pollRunning = false;
  }
}

function startPollingLoop(): void {
  logger.info({ intervalMs: POLL_INTERVAL_MS, monitored: MONITORED_CHATS }, "Starting poll loop");
  // Run immediately on start (catches any messages since last run)
  pollOnce().catch(err => logger.error({ err }, "Initial poll error"));
  // Then on interval
  setInterval(() => {
    pollOnce().catch(err => logger.error({ err }, "Poll interval error"));
  }, POLL_INTERVAL_MS);
}

// --- wacli sync subprocess (keeps the store fresh) ---
function startWacliSync(): void {
  const args = [
    "sync",
    "--account", WACLI_ACCOUNT,
    "--follow",
  ];

  logger.info({ args: args.join(" ") }, "Starting wacli sync subprocess");

  const proc = spawn("wacli", args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  proc.stdout?.on("data", (data: Buffer) => {
    logger.debug({ wacliStdout: data.toString().trim() }, "wacli sync stdout");
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text) logger.info({ wacliStderr: text }, "wacli sync event");
  });

  proc.on("exit", (code, signal) => {
    logger.warn({ code, signal }, "wacli sync exited — restarting in 5s");
    setTimeout(() => startWacliSync(), 5_000);
  });

  proc.on("error", (err) => {
    logger.error({ err }, "wacli sync spawn error — restarting in 5s");
    setTimeout(() => startWacliSync(), 5_000);
  });
}

// --- Main export: start listener ---
export function startListener(): void {
  logger.info({
    account: WACLI_ACCOUNT,
    group: METRO_GROUP_JID,
    dmAllowlist: DM_ALLOWLIST_JIDS,
    pollIntervalS: POLL_INTERVAL_MS / 1000,
  }, "Metro Tennis WA listener starting (polling mode)");

  // Start wacli sync to keep the store fresh
  startWacliSync();

  // Start the polling loop
  startPollingLoop();
}
