import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  type WASocket,
} from "@whiskeysockets/baileys";
import path from "path";
import { logger } from "../lib/logger.js";
import { config } from "../lib/config.js";
import { buildDailyReport } from "./report.js";
import { handleQuery } from "./query-handler.js";

const AUTH_DIR = path.join(process.cwd(), ".wa-auth");
const WA_PHONE = "6281368682000";

let sock: WASocket | null = null;
let pairingCodeLogged = false;

export async function startWaBot(
  onPairingCode?: (code: string) => void
): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);

  sock = makeWASocket({
    auth: state,
    browser: Browsers.macOS("Desktop"),
    printQRInTerminal: false,
    logger: logger.child({ module: "baileys" }) as any,
    getMessage: async () => undefined,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    // Request pairing code when QR would normally be shown (WS handshake done, awaiting auth)
    if (qr && !sock!.authState.creds.registered && !pairingCodeLogged) {
      pairingCodeLogged = true;
      try {
        const code = await sock!.requestPairingCode(WA_PHONE);
        const formatted = code.match(/.{1,4}/g)?.join("-") ?? code;
        logger.warn({ code: formatted }, `📱 PAIRING CODE for ${WA_PHONE}: ${formatted}`);
        console.log(`\n========================================`);
        console.log(`BAILEYS PAIRING CODE for ${WA_PHONE}:`);
        console.log(`  ${formatted}`);
        console.log(`Enter on phone: WhatsApp > Linked Devices > Link a Device > Link with phone number`);
        console.log(`========================================\n`);
        if (onPairingCode) onPairingCode(formatted);
      } catch (err) {
        logger.error({ err }, "Failed to request pairing code");
      }
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error as any)?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      logger.info({ code, loggedOut }, "WA connection closed");
      if (!loggedOut) {
        logger.info("Reconnecting in 5s...");
        setTimeout(() => startWaBot(onPairingCode), 5000);
      }
    }

    if (connection === "open") {
      pairingCodeLogged = false;
      logger.info({ phone: WA_PHONE }, "WhatsApp connected ✅");
    }
  });

  // Listen for group messages
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid !== config.WA_GROUP_JID) continue;

      const text =
        msg.message?.conversation ??
        msg.message?.extendedTextMessage?.text ??
        "";

      if (!text.trim()) continue;

      logger.info({ text, from: msg.key.participant }, "Group message received");

      const lower = text.toLowerCase();
      const isQuery =
        lower.includes("comment") || lower.includes("sentimen") ||
        lower.includes("follower") || lower.includes("rating") ||
        lower.includes("review") || lower.includes("competitor") ||
        lower.includes("maps") || lower.includes("berapa") ||
        lower.includes("gimana") || lower.includes("bagaimana") ||
        lower.includes("how") || lower.includes("what") ||
        lower.includes("show") || lower.includes("unanswered") ||
        lower.includes("negatif") || lower.includes("negative") ||
        lower.includes("tiktok") || lower.includes("youtube") ||
        lower.includes("week") || lower.includes("minggu") ||
        lower.includes("today") || lower.includes("hari ini") ||
        text.includes("?");

      if (!isQuery) continue;

      try {
        const reply = await handleQuery(text);
        await sock!.sendMessage(config.WA_GROUP_JID!, {
          text: reply,
        }, { quoted: msg });
      } catch (err) {
        logger.error({ err }, "Failed to send query reply");
      }
    }
  });

  return sock;
}

export async function sendToGroup(message: string): Promise<void> {
  if (!sock) throw new Error("WA bot not started");
  if (!config.WA_GROUP_JID) throw new Error("WA_GROUP_JID not configured");
  await sock.sendMessage(config.WA_GROUP_JID, { text: message });
}

export async function sendDailyReport(): Promise<void> {
  const report = await buildDailyReport();
  await sendToGroup(report);
  logger.info("Daily report sent to WA group");
}
