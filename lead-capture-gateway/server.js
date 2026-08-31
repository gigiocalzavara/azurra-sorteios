import express from "express";
import QRCode from "qrcode";
import pino from "pino";
import { rm } from "node:fs/promises";
import makeWASocket, { DisconnectReason, fetchLatestBaileysVersion, useMultiFileAuthState } from "@whiskeysockets/baileys";

const app = express();
app.use(express.json({ limit: "256kb" }));
const port = Number(process.env.PORT || 3200);
const token = process.env.GATEWAY_TOKEN || "";
const sessions = new Map();
const logger = pino({ level: process.env.LOG_LEVEL || "info" });
const safe = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "");
const sessionPath = (id) => `/data/${safe(id)}`;

app.use((req, res, next) => {
  if (!token || req.headers.authorization !== `Bearer ${token}`) return res.status(401).json({ error: "unauthorized" });
  next();
});

async function connect(org) {
  const id = safe(org);
  const existing = sessions.get(id);
  if (["connected", "connecting", "qr"].includes(existing?.status)) return existing;
  const current = { status: "connecting", qr: null, phone: null, sock: null };
  sessions.set(id, current);
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath(id));
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version, auth: state, logger, printQRInTerminal: false, syncFullHistory: false,
    markOnlineOnConnect: false, shouldSyncHistoryMessage: () => false
  });
  current.sock = sock;
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async (update) => {
    if (update.qr) {
      current.qr = await QRCode.toDataURL(update.qr, { margin: 1, width: 320 });
      current.status = "qr";
    }
    if (update.connection === "open") {
      current.status = "connected";
      current.qr = null;
      current.phone = sock.user?.id?.split(":")[0] || null;
      logger.info({ organization: id }, "Lead capture WhatsApp connected");
    }
    if (update.connection === "close") {
      const code = update.lastDisconnect?.error?.output?.statusCode;
      current.status = "disconnected";
      current.sock = null;
      if (code !== DisconnectReason.loggedOut) setTimeout(() => connect(id).catch((error) => logger.error(error)), 3000);
    }
  });
  return current;
}

function connected(req, res) {
  const current = sessions.get(safe(req.params.org));
  if (!current?.sock || current.status !== "connected") {
    res.status(409).json({ error: "WhatsApp de captura desconectado" });
    return null;
  }
  return current;
}

app.get("/health", (_, res) => res.json({ ok: true, mode: "read-only-lead-capture" }));
app.post("/sessions/:org/connect", async (req, res) => {
  try { const s = await connect(req.params.org); res.json({ status: s.status, qr: s.qr, phone: s.phone }); }
  catch (error) { res.status(500).json({ error: error.message }); }
});
app.get("/sessions/:org/status", (req, res) => {
  const s = sessions.get(safe(req.params.org));
  res.json({ status: s?.status || "disconnected", qr: s?.qr || null, phone: s?.phone || null });
});
app.delete("/sessions/:org", async (req, res) => {
  const id = safe(req.params.org), current = sessions.get(id);
  try { await current?.sock?.logout(); } catch {}
  try { await rm(sessionPath(id), { recursive: true, force: true }); } catch {}
  sessions.delete(id);
  res.json({ ok: true });
});
app.get("/sessions/:org/groups", async (req, res) => {
  const current = connected(req, res); if (!current) return;
  try {
    const groups = await current.sock.groupFetchAllParticipating();
    res.json(Object.values(groups).map((group) => ({ id: group.id, subject: group.subject, participants: group.participants?.length || 0 })).sort((a, b) => a.subject.localeCompare(b.subject)));
  } catch (error) { res.status(500).json({ error: error.message }); }
});
app.get("/sessions/:org/groups/:groupId/participants", async (req, res) => {
  const current = connected(req, res); if (!current) return;
  try {
    const metadata = await current.sock.groupMetadata(req.params.groupId);
    const contacts = [];
    for (const participant of metadata.participants || []) {
      const id = String(participant.id || "");
      const lid = id.endsWith("@lid") ? id : participant.lid || null;
      let phoneJid = participant.phoneNumber || (id.endsWith("@s.whatsapp.net") || id.endsWith("@c.us") ? id : null);
      if (!phoneJid && lid) {
        try { phoneJid = await current.sock.signalRepository.lidMapping.getPNForLID(lid); } catch {}
      }
      const digits = phoneJid ? String(phoneJid).split("@")[0].split(":")[0].replace(/\D/g, "") : "";
      if (digits && digits === current.phone) continue;
      contacts.push({
        jid: id,
        phone: digits ? `+${digits}` : null,
        username: participant.username || null,
        lid,
        name: participant.notify || participant.name || participant.verifiedName || null,
        admin: participant.admin || null,
        contactMode: digits ? "azurra_leads" : "manual"
      });
    }
    res.json({ group: { id: metadata.id, subject: metadata.subject }, contacts });
  } catch (error) { res.status(500).json({ error: error.message }); }
});

app.listen(port, "0.0.0.0", () => logger.info(`lead capture gateway on ${port}`));
