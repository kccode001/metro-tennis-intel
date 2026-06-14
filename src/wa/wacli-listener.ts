/**
 * wacli-listener.ts — Inbound WhatsApp handler for Metro Tennis.
 *
 * Architecture:
 *  - Runs `wacli sync --webhook http://localhost:<PORT> --follow` as a child process.
 *  - wacli POSTs each live message as JSON to our local HTTP server.
 *  - We filter: only Metro Analytics group OR DMs from owner allowlist.
 *  - Route to handleQuery (Haiku NL→SQL→DB→format).
 *  - Reply via `wacli send text`.
 */

import http from "http";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { handleQuery } from "./query-handler.js";
import { logger } from "../lib/logger.js";

const execFileAsync = promisify(execFile);

// --- Config ---
export const WEBHOOK_PORT = parseInt(process.env["WACLI_WEBHOOK_PORT"] ?? "9876", 10);
const WACLI_ACCOUNT = process.env["WACLI_ACCOUNT"] ?? "cs-inbound";

// The Metro Tennis Analytics group JID
const METRO_GROUP_JID = process.env["WA_GROUP_JID"] ?? "120363428176735366@g.us";

// DM allowlist: KC + owner (base numbers; wacli uses @s.whatsapp.net suffix)
const DM_ALLOWLIST_RAW: string[] = (
  process.env["WA_DM_ALLOWLIST"] ?? "6285161367231,6281365161000"
).split(",").map(n => n.trim()).filter(Boolean);

const DM_ALLOWLIST_JIDS = new Set(DM_ALLOWLIST_RAW.map(n => `${n}@s.whatsapp.net`));

// Track processed message IDs to prevent duplicate replies — persisted to disk for restart safety

const DEDUP_FILE = join(process.cwd(), ".wa-dedup.json");
const MAX_DEDUP_SIZE = 1000; // trim oldest entries to keep file small

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

const processedMsgIds = loadProcessedIds();

// --- Message shape from wacli webhook ---
interface WacliWebhookMessage {
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

interface WacliWebhookPayload {
  event?: string;
  message?: WacliWebhookMessage;
  // Some wacli versions wrap differently
  [key: string]: unknown;
}

// --- Filter logic ---
function shouldRespond(msg: WacliWebhookMessage): boolean {
  // Never respond to our own outbound messages
  if (msg.FromMe) return false;

  // Only text messages
  if (!msg.Text || msg.Text.trim() === "") return false;

  // Check: is this the Metro group?
  if (msg.ChatJID === METRO_GROUP_JID) return true;

  // Check: is this a DM from an allowlisted number?
  if (msg.ChatJID.endsWith("@s.whatsapp.net")) {
    // For DMs, ChatJID == the other person's JID
    if (DM_ALLOWLIST_JIDS.has(msg.ChatJID)) return true;
    // Also check SenderJID (for group DMs / some accounts, sender is different)
    if (msg.SenderJID && DM_ALLOWLIST_JIDS.has(msg.SenderJID)) return true;
  }

  return false;
}

// --- Reply via wacli ---
async function sendReply(
  chatJid: string,
  text: string,
  quoteMsgId?: string,
  quoteSenderJid?: string,
): Promise<string> {
  // execFile handles escaping safely — no shell interpolation
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

  logger.info({ chatJid, textLen: text.length }, "Sending reply via wacli");
  const { stdout } = await execFileAsync("wacli", args, { timeout: 30_000 });
  logger.info({ stdout }, "wacli send result");
  const idMatch = stdout.match(/([A-F0-9]{20,})/i);
  return idMatch?.[1] ?? stdout.trim();
}

// --- Process inbound message ---
async function processMessage(msg: WacliWebhookMessage): Promise<void> {
  if (!shouldRespond(msg)) {
    logger.debug({ chatJid: msg.ChatJID, fromMe: msg.FromMe }, "Skipping message (out of scope)");
    return;
  }

  if (processedMsgIds.has(msg.MsgID)) {
    logger.debug({ msgId: msg.MsgID }, "Already processed — skipping duplicate");
    return;
  }
  saveProcessedId(msg.MsgID, processedMsgIds);

  const question = msg.Text.trim();
  logger.info({ chatJid: msg.ChatJID, sender: msg.SenderName, question }, "Inbound question");

  try {
    const answer = await handleQuery(question);
    const deliveryId = await sendReply(msg.ChatJID, answer, msg.MsgID, msg.SenderJID);
    logger.info({ chatJid: msg.ChatJID, deliveryId }, "Reply sent");

    // Append to proof log
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

// --- Webhook HTTP server ---
function createWebhookServer(): http.Server {
  const server = http.createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(405);
      res.end("Method Not Allowed");
      return;
    }

    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      res.writeHead(200);
      res.end("OK");

      const body = Buffer.concat(chunks).toString("utf8");
      let payload: WacliWebhookPayload;
      try {
        payload = JSON.parse(body) as WacliWebhookPayload;
      } catch {
        logger.warn({ body: body.slice(0, 200) }, "Could not parse webhook body");
        return;
      }

      // wacli can send the message directly or wrap it in {event, message}
      let msg: WacliWebhookMessage | undefined;
      if (payload.message && typeof payload.message === "object") {
        msg = payload.message as WacliWebhookMessage;
      } else if (typeof payload.ChatJID === "string") {
        msg = payload as unknown as WacliWebhookMessage;
      }

      if (!msg) {
        // Could be a status/connection event — log at debug and ignore
        logger.debug({ event: payload.event }, "Non-message webhook event");
        return;
      }

      // Fire-and-forget (webhook must return fast)
      processMessage(msg).catch(err =>
        logger.error({ err }, "processMessage threw unexpectedly")
      );
    });
  });

  return server;
}

// --- wacli sync subprocess ---
function startWacliSync(webhookUrl: string): void {
  const args = [
    "sync",
    "--account", WACLI_ACCOUNT,
    "--follow",
    "--webhook", webhookUrl,
    "--webhook-allow-private",
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
    // wacli logs lifecycle events to stderr — useful for debugging
    const text = data.toString().trim();
    if (text) logger.info({ wacliStderr: text }, "wacli sync event");
  });

  proc.on("exit", (code, signal) => {
    logger.warn({ code, signal }, "wacli sync exited — restarting in 5s");
    setTimeout(() => startWacliSync(webhookUrl), 5_000);
  });

  proc.on("error", (err) => {
    logger.error({ err }, "wacli sync spawn error — restarting in 5s");
    setTimeout(() => startWacliSync(webhookUrl), 5_000);
  });
}

// --- Main export: start listener ---
export function startListener(): void {
  const server = createWebhookServer();
  const webhookUrl = `http://localhost:${WEBHOOK_PORT}`;

  server.listen(WEBHOOK_PORT, "127.0.0.1", () => {
    logger.info({ webhookUrl }, "Metro Tennis WA listener webhook server started");
    // Start wacli sync pointed at our webhook
    startWacliSync(webhookUrl);
  });

  server.on("error", (err) => {
    logger.error({ err }, "Webhook server error");
    process.exit(1);
  });
}
