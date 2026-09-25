import express from "express";
import QRCode from "qrcode";
import pino from "pino";
import { rm } from "node:fs/promises";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const port = Number(process.env.PORT || 3100);
const token = process.env.GATEWAY_TOKEN || "";
const sessions = new Map();
const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const CONNECTION_TIMEOUT_MS = 45_000;
const KEEP_ALIVE_INTERVAL_MS = 25_000;
const MAX_RECONNECT_DELAY_MS = 60_000;
const GROUP_CACHE_TTL_MS = 60_000;

const safe = (id) => String(id).replace(/[^a-zA-Z0-9_-]/g, "");
const digits = (value) => String(value || "").replace(/\D/g, "");
const sessionPath = (id) => `/data/${safe(id)}`;

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false },
      })
    : null;

const worker = {
  running: false,
  lastCycleAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastProcessed: 0,
  totalSent: 0,
};

app.use((req, res, next) => {
  if (!token || req.headers.authorization !== `Bearer ${token}`) {
    return res.status(401).json({ error: "unauthorized" });
  }
  next();
});

function phoneCandidates(phone) {
  const raw = digits(phone);
  const values = new Set([raw]);

  if (raw.startsWith("55")) {
    if (raw.length === 13 && raw[4] === "9") {
      values.add(raw.slice(0, 4) + raw.slice(5));
    }
    if (raw.length === 12) {
      values.add(raw.slice(0, 4) + "9" + raw.slice(4));
    }
  }

  return [...values].filter(Boolean);
}

function phonesEquivalent(a, b) {
  const left = new Set(phoneCandidates(a));
  return phoneCandidates(b).some((value) => left.has(value));
}

function unwrapMessage(message) {
  let current = message;

  for (let depth = 0; depth < 5 && current; depth += 1) {
    const wrapped =
      current.ephemeralMessage?.message ||
      current.viewOnceMessage?.message ||
      current.viewOnceMessageV2?.message ||
      current.viewOnceMessageV2Extension?.message ||
      current.documentWithCaptionMessage?.message;

    if (!wrapped) break;
    current = wrapped;
  }

  return current || {};
}

function inboundText(message) {
  const content = unwrapMessage(message);

  return (
    content.conversation ||
    content.extendedTextMessage?.text ||
    content.buttonsResponseMessage?.selectedDisplayText ||
    content.buttonsResponseMessage?.selectedButtonId ||
    content.listResponseMessage?.singleSelectReply?.selectedRowId ||
    content.listResponseMessage?.title ||
    content.templateButtonReplyMessage?.selectedDisplayText ||
    content.templateButtonReplyMessage?.selectedId ||
    content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson ||
    ""
  );
}

function inboundPhoneJid(message) {
  const candidates = [
    message?.key?.remoteJidAlt,
    message?.key?.participantAlt,
    message?.key?.remoteJid,
    message?.key?.participant,
  ];

  return (
    candidates.find((jid) => String(jid || "").endsWith("@s.whatsapp.net")) || ""
  );
}

function disconnectCode(update) {
  return (
    update?.lastDisconnect?.error?.output?.statusCode ||
    update?.lastDisconnect?.error?.statusCode ||
    null
  );
}

function reconnectDelay(attempt) {
  const exponential = 2_000 * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(exponential, MAX_RECONNECT_DELAY_MS);
}

function shouldReconnect(code) {
  return ![
    DisconnectReason.loggedOut,
    DisconnectReason.connectionReplaced,
    DisconnectReason.badSession,
    DisconnectReason.multideviceMismatch,
  ].includes(code);
}

function clearReconnectTimer(state) {
  if (state?.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

function scheduleReconnect(id, state, code) {
  if (sessions.get(id) !== state || state.intentionalClose || !shouldReconnect(code)) {
    return;
  }

  clearReconnectTimer(state);
  state.reconnectAttempts += 1;

  const delay =
    code === DisconnectReason.restartRequired
      ? 1_000
      : reconnectDelay(state.reconnectAttempts);

  logger.warn(
    { organization: id, code, attempt: state.reconnectAttempts, delay },
    "Scheduling WhatsApp reconnect",
  );

  state.reconnectTimer = setTimeout(() => {
    if (sessions.get(id) === state) {
      sessions.delete(id);
    }

    connect(id, { reconnectAttempt: state.reconnectAttempts }).catch((error) => {
      logger.error(
        { organization: id, error: error?.message },
        "WhatsApp reconnect failed",
      );
    });
  }, delay);
}

async function resolveDirectJid(org, phone) {
  const session = sessions.get(safe(org));

  if (!session?.sock || session.status !== "connected") {
    throw new Error("WhatsApp desconectado");
  }

  const candidates = phoneCandidates(phone);

  for (const candidate of candidates) {
    try {
      const found = await session.sock.onWhatsApp(candidate);
      const item = Array.isArray(found)
        ? found.find((entry) => entry?.exists)
        : null;

      if (item?.jid) return item.jid;
    } catch (error) {
      logger.warn(
        { organization: org, candidate, error: error?.message },
        "onWhatsApp lookup failed",
      );
    }
  }

  if (!candidates[0]) {
    throw new Error("Telefone do vencedor inválido");
  }

  return `${candidates[0]}@s.whatsapp.net`;
}

async function sendMessage(org, jid, text, mediaUrl) {
  const session = sessions.get(safe(org));

  if (!session?.sock || session.status !== "connected") {
    throw new Error("WhatsApp desconectado");
  }

  const payload = mediaUrl
    ? { video: { url: mediaUrl }, caption: text }
    : { text };

  return session.sock.sendMessage(jid, payload);
}

async function sendDirectMessage(org, phone, text) {
  const jid = await resolveDirectJid(org, phone);
  return sendMessage(org, jid, text);
}

async function productMenu(flow) {
  const { data, error } = await supabase
    .from("promotion_products")
    .select("product_id,display_order,products(name)")
    .eq("promotion_id", flow.promotion_id)
    .order("display_order");

  if (error) throw error;

  const rows = data || [];
  const items = rows
    .map((row, index) => {
      const product = Array.isArray(row.products)
        ? row.products[0]
        : row.products;
      return `${index + 1}. ${product?.name || "Produto"}`;
    })
    .join("\n");

  return {
    rows,
    text: `🏆 Parabéns! Você foi o vencedor.\n\nDigite o número do produto que você quer:\n${items}`,
  };
}

async function startPostPurchase(flow) {
  const menu = await productMenu(flow);

  if (!menu.rows.length) {
    throw new Error("Promoção sem produtos");
  }

  const result = await sendDirectMessage(
    flow.organization_id,
    flow.phone_e164,
    menu.text,
  );

  const { error } = await supabase
    .from("post_purchase_flows")
    .update({
      stage: "awaiting_product",
      started_at: new Date().toISOString(),
      last_message_id: result?.key?.id,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", flow.id);

  if (error) throw error;
}

async function findActiveWinnerFlow(org, phone) {
  const { data, error } = await supabase
    .from("post_purchase_flows")
    .select(
      "id,organization_id,promotion_id,phone_e164,stage,selected_product_id,promotions(post_draw_pix_amount)",
    )
    .eq("organization_id", org)
    .in("stage", [
      "awaiting_product",
      "awaiting_reward_type",
      "awaiting_address",
    ])
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) throw error;

  return (
    (data || []).find((flow) => phonesEquivalent(flow.phone_e164, phone)) ||
    null
  );
}

async function handleWinnerReply(org, phone, text) {
  if (!supabase) return false;

  const flow = await findActiveWinnerFlow(org, phone);
  if (!flow) return false;

  const answer = String(text || "").trim();

  if (flow.stage === "awaiting_product") {
    const menu = await productMenu(flow);
    const numericMatch = answer.match(/\d+/);
    let index = numericMatch ? Number(numericMatch[0]) - 1 : -1;

    if (!menu.rows[index]) {
      const normalized = answer
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

      index = menu.rows.findIndex((row) => {
        const product = Array.isArray(row.products)
          ? row.products[0]
          : row.products;
        const name = String(product?.name || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();

        return name && (normalized === name || normalized.includes(name));
      });
    }

    if (!Number.isInteger(index) || !menu.rows[index]) {
      await sendDirectMessage(
        org,
        flow.phone_e164,
        `Opção inválida.\n\n${menu.text}`,
      );
      return true;
    }

    const selected = Array.isArray(menu.rows[index].products)
      ? menu.rows[index].products[0]
      : menu.rows[index].products;

    const { error: updateError } = await supabase
      .from("post_purchase_flows")
      .update({
        selected_product_id: menu.rows[index].product_id,
        stage: "awaiting_reward_type",
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", flow.id);

    if (updateError) throw updateError;

    const promotion = Array.isArray(flow.promotions)
      ? flow.promotions[0]
      : flow.promotions;

    const amount = Number(
      promotion?.post_draw_pix_amount || 0,
    ).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });

    await sendDirectMessage(
      org,
      flow.phone_e164,
      `✅ Produto escolhido: *${selected?.name || "Produto"}*\n\nVocê prefere receber esse produto ou um PIX no valor de *${amount}*?\n\n1. PIX\n2. Produto`,
    );

    return true;
  }

  if (flow.stage === "awaiting_reward_type") {
    if (answer === "1") {
      const { error: updateError } = await supabase
        .from("post_purchase_flows")
        .update({
          reward_type: "pix",
          stage: "completed",
          operator_status: "awaiting_pix_contact",
          completed_at: null,
        })
        .eq("id", flow.id);

      if (updateError) throw updateError;

      await sendDirectMessage(
        org,
        flow.phone_e164,
        "Obrigado! Registramos sua escolha pelo PIX. Um operador entrará em contato para combinar os dados e realizar o pagamento.",
      );

      return true;
    }

    if (answer === "2") {
      const { error: updateError } = await supabase
        .from("post_purchase_flows")
        .update({
          reward_type: "product",
          stage: "awaiting_address",
        })
        .eq("id", flow.id);

      if (updateError) throw updateError;

      await sendDirectMessage(
        org,
        flow.phone_e164,
        "Perfeito. Envie seu endereço completo para entrega, incluindo rua, número, complemento (se houver), bairro, cidade, estado e CEP.",
      );

      return true;
    }

    await sendDirectMessage(
      org,
      flow.phone_e164,
      "Digite 1 para PIX ou 2 para Produto.",
    );
    return true;
  }

  if (flow.stage === "awaiting_address") {
    if (answer.length < 10) {
      await sendDirectMessage(
        org,
        flow.phone_e164,
        "Por favor, envie o endereço completo para conseguirmos organizar a entrega.",
      );
      return true;
    }

    const { error: updateError } = await supabase
      .from("post_purchase_flows")
      .update({
        delivery_address: answer,
        stage: "completed",
        operator_status: "awaiting_shipping",
        completed_at: null,
      })
      .eq("id", flow.id);

    if (updateError) throw updateError;

    await sendDirectMessage(
      org,
      flow.phone_e164,
      "Obrigado! Recebemos seu endereço. Agora nossa equipe vai organizar o envio do seu prêmio.",
    );

    return true;
  }

  return false;
}

async function connect(org, options = {}) {
  const id = safe(org);
  const existing = sessions.get(id);

  if (existing?.status === "connected" || existing?.status === "qr") {
    return existing;
  }

  if (
    existing?.status === "connecting" &&
    Date.now() - existing.startedAt < CONNECTION_TIMEOUT_MS
  ) {
    return existing;
  }

  if (existing) {
    clearReconnectTimer(existing);
    try {
      existing.sock?.end?.(new Error("Replacing stale WhatsApp socket"));
    } catch {}
    sessions.delete(id);
  }

  const state = {
    status: "connecting",
    qr: null,
    phone: null,
    sock: null,
    startedAt: Date.now(),
    lastConnectedAt: null,
    lastDisconnectAt: null,
    lastError: null,
    lastDisconnectCode: null,
    reconnectAttempts: Number(options.reconnectAttempt || 0),
    reconnectTimer: null,
    intentionalClose: false,
    groupCache: new Map(),
    groupList: null,
    groupListFetchedAt: 0,
  };

  sessions.set(id, state);

  try {
    const { state: auth, saveCreds } = await useMultiFileAuthState(
      sessionPath(id),
    );
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth,
      logger,
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      connectTimeoutMs: CONNECTION_TIMEOUT_MS,
      defaultQueryTimeoutMs: 60_000,
      keepAliveIntervalMs: KEEP_ALIVE_INTERVAL_MS,
      retryRequestDelayMs: 500,
      shouldSyncHistoryMessage: () => false,
      cachedGroupMetadata: async (jid) => state.groupCache.get(jid),
    });

    state.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async ({ messages }) => {
      for (const message of messages || []) {
        if (message.key.fromMe) continue;

        const remote = inboundPhoneJid(message);
        const text = inboundText(message.message);

        if (!remote || !text) {
          logger.debug(
            {
              organization: id,
              remoteJid: message.key.remoteJid,
              remoteJidAlt: message.key.remoteJidAlt,
              messageTypes: Object.keys(unwrapMessage(message.message)),
            },
            "Ignored inbound message",
          );
          continue;
        }

        const phone = `+${remote.split("@")[0].split(":")[0]}`;

        try {
          await handleWinnerReply(id, phone, text);
        } catch (error) {
          logger.error(
            { organization: id, phone, error: error?.message },
            "Post-purchase reply failed",
          );
        }
      }
    });

    sock.ev.on("connection.update", async (update) => {
      if (sessions.get(id) !== state) return;

      if (update.qr) {
        state.qr = await QRCode.toDataURL(update.qr, {
          margin: 1,
          width: 320,
        });
        state.status = "qr";
        state.lastError = null;
      }

      if (update.connection === "open") {
        clearReconnectTimer(state);
        state.status = "connected";
        state.qr = null;
        state.phone = sock.user?.id?.split(":")[0] || null;
        state.lastConnectedAt = new Date().toISOString();
        state.lastError = null;
        state.lastDisconnectCode = null;
        state.reconnectAttempts = 0;
        state.groupList = null;
        state.groupListFetchedAt = 0;

        logger.info(
          { organization: id, phone: state.phone },
          "WhatsApp connected",
        );
      }

      if (update.connection === "close") {
        const code = disconnectCode(update);

        state.status = "disconnected";
        state.sock = null;
        state.qr = null;
        state.groupList = null;
        state.groupListFetchedAt = 0;
        state.lastDisconnectAt = new Date().toISOString();
        state.lastDisconnectCode = code;
        state.lastError = `Conexão encerrada${code ? ` (${code})` : ""}`;

        logger.warn(
          {
            organization: id,
            code,
            intentional: state.intentionalClose,
            error: update?.lastDisconnect?.error?.message,
          },
          "WhatsApp disconnected",
        );

        if (state.intentionalClose) {
          return;
        }

        if (
          code === DisconnectReason.loggedOut ||
          code === DisconnectReason.badSession ||
          code === DisconnectReason.multideviceMismatch
        ) {
          try {
            await rm(sessionPath(id), { recursive: true, force: true });
          } catch (error) {
            logger.warn(
              { organization: id, error: error?.message },
              "Could not clear invalid WhatsApp session",
            );
          }
          sessions.delete(id);
          return;
        }

        if (code === DisconnectReason.connectionReplaced) {
          state.lastError =
            "Sessão substituída por outra conexão do WhatsApp.";
          return;
        }

        scheduleReconnect(id, state, code);
      }
    });

    return state;
  } catch (error) {
    if (sessions.get(id) === state) {
      sessions.delete(id);
    }

    try {
      state.sock?.end?.(error);
    } catch {}

    throw error;
  }
}

app.get("/health", (_, res) => {
  const connectedSessions = [...sessions.values()].filter(
    (session) => session.status === "connected",
  ).length;

  res.json({
    ok: true,
    supabaseConfigured: Boolean(supabase),
    connectedSessions,
    totalSessions: sessions.size,
    worker,
  });
});

app.post("/sessions/:org/connect", async (req, res) => {
  try {
    const session = await connect(req.params.org);
    res.json({
      status: session.status,
      qr: session.qr,
      phone: session.phone,
      error: session.lastError,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/sessions/:org/status", (req, res) => {
  const session = sessions.get(safe(req.params.org));

  res.json({
    status: session?.status || "disconnected",
    qr: session?.qr || null,
    phone: session?.phone || null,
    error: session?.lastError || null,
    lastConnectedAt: session?.lastConnectedAt || null,
    lastDisconnectAt: session?.lastDisconnectAt || null,
    lastDisconnectCode: session?.lastDisconnectCode || null,
    reconnectAttempts: session?.reconnectAttempts || 0,
  });
});

app.get("/sessions/:org/worker", (req, res) => {
  const session = sessions.get(safe(req.params.org));

  res.json({
    configured: Boolean(supabase),
    worker,
    sessionStatus: session?.status || "disconnected",
    phone: session?.phone || null,
  });
});

app.post("/sessions/:org/process", async (req, res) => {
  try {
    await processQueue(req.params.org);
    res.json({ ok: true, worker });
  } catch (error) {
    res.status(500).json({ error: error.message, worker });
  }
});

app.delete("/sessions/:org", async (req, res) => {
  const id = safe(req.params.org);
  const session = sessions.get(id);

  if (session) {
    session.intentionalClose = true;
    clearReconnectTimer(session);
  }

  sessions.delete(id);

  try {
    await session?.sock?.logout();
  } catch {}

  try {
    await rm(sessionPath(id), { recursive: true, force: true });
  } catch {}

  res.json({ ok: true });
});

app.get("/sessions/:org/groups", async (req, res) => {
  const session = sessions.get(safe(req.params.org));

  if (!session?.sock || session.status !== "connected") {
    return res.status(409).json({ error: "WhatsApp desconectado" });
  }

  try {
    const now = Date.now();

    if (
      session.groupList &&
      now - session.groupListFetchedAt < GROUP_CACHE_TTL_MS
    ) {
      return res.json(session.groupList);
    }

    const groups = await session.sock.groupFetchAllParticipating();
    const list = Object.values(groups)
      .map((group) => ({
        id: group.id,
        subject: group.subject,
        participants: group.participants?.length || 0,
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject));

    session.groupList = list;
    session.groupListFetchedAt = now;

    return res.json(list);
  } catch (error) {
    if (
      String(error?.message || error).includes("rate-overlimit") &&
      session.groupList
    ) {
      return res.json(session.groupList);
    }

    return res.status(500).json({ error: error.message });
  }
});

app.post("/sessions/:org/send", async (req, res) => {
  try {
    const result = req.body.phone
      ? await sendDirectMessage(req.params.org, req.body.phone, req.body.text)
      : await sendMessage(
          req.params.org,
          req.body.jid,
          req.body.text,
          req.body.mediaUrl,
        );

    res.json({ ok: true, messageId: result?.key?.id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

let working = false;

async function processQueue(onlyOrg = null) {
  if (!supabase) {
    worker.lastError =
      "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes no gateway";
    return;
  }

  if (working) return;

  working = true;
  worker.running = true;
  worker.lastCycleAt = new Date().toISOString();
  worker.lastProcessed = 0;

  try {
    let query = supabase
      .from("communication_events")
      .select(
        "id,organization_id,promotion_id,stage,rendered_message,media_url,attempts,status",
      )
      .in("status", ["pending", "manual_required"])
      .lt("attempts", 3)
      .lte("scheduled_at", new Date().toISOString())
      .order("scheduled_at")
      .limit(20);

    if (onlyOrg) {
      query = query.eq("organization_id", onlyOrg);
    }

    const { data: events, error: eventsError } = await query;

    if (eventsError) {
      throw new Error(`Fila de comunicação: ${eventsError.message}`);
    }

    for (const event of events || []) {
      const { data: settings, error: settingsError } = await supabase
        .from("promotion_communication_settings")
        .select("mode,active,group_jid")
        .eq("promotion_id", event.promotion_id)
        .maybeSingle();

      if (settingsError) {
        logger.error(settingsError, "Communication settings failed");
        continue;
      }

      if (!settings?.active) continue;

      if (!settings.group_jid || settings.mode === "manual") {
        await supabase
          .from("communication_events")
          .update({
            status: "manual_required",
            last_error: !settings.group_jid
              ? "Sem grupo de WhatsApp vinculado. Envie manualmente pelo fluxo da campanha."
              : "Campanha em modo manual / contingência.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", event.id);
        continue;
      }

      if (
        settings.mode !== "automatic" &&
        event.stage !== "launch" &&
        event.stage !== "result" &&
        event.stage !== "sold_out"
      ) {
        await supabase
          .from("communication_events")
          .update({
            status: "manual_required",
            last_error: "Aguardando envio assistido pelo operador.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", event.id);
        continue;
      }

      let session = sessions.get(safe(event.organization_id));

      if (!session || session.status === "disconnected") {
        try {
          session = await connect(event.organization_id);
        } catch (error) {
          logger.error(
            { organization: event.organization_id, error: error?.message },
            "Session restore failed",
          );
          await supabase
            .from("communication_events")
            .update({
              status: "manual_required",
              last_error: "WhatsApp indisponível. Envie manualmente pelo fluxo da campanha.",
              updated_at: new Date().toISOString(),
            })
            .eq("id", event.id);
          continue;
        }
      }

      if (!session?.sock || session.status !== "connected") {
        await supabase
          .from("communication_events")
          .update({
            status: "manual_required",
            last_error: "WhatsApp desconectado. Envie manualmente pelo fluxo da campanha.",
            updated_at: new Date().toISOString(),
          })
          .eq("id", event.id);
        continue;
      }

      try {
        await sendMessage(
          event.organization_id,
          settings.group_jid,
          event.rendered_message,
          event.media_url,
        );

        const { error: updateError } = await supabase
          .from("communication_events")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            attempts: event.attempts + 1,
            last_error: null,
          })
          .eq("id", event.id);

        if (updateError) throw updateError;

        worker.lastProcessed += 1;
        worker.totalSent += 1;
      } catch (error) {
        logger.error(
          { event: event.id, message: error.message },
          "Communication send failed",
        );

        await supabase
          .from("communication_events")
          .update({
            status: "manual_required",
            attempts: event.attempts + 1,
            last_error: error.message,
          })
          .eq("id", event.id);
      }
    }

    let flowQuery = supabase
      .from("post_purchase_flows")
      .select("id,organization_id,promotion_id,phone_e164,stage")
      .in("stage", ["pending_send", "failed"])
      .order("updated_at")
      .limit(10);

    if (onlyOrg) {
      flowQuery = flowQuery.eq("organization_id", onlyOrg);
    }

    const { data: flows, error: flowsError } = await flowQuery;

    if (flowsError) {
      throw new Error(`Fila pós-venda: ${flowsError.message}`);
    }

    for (const flow of flows || []) {
      let session = sessions.get(safe(flow.organization_id));

      if (!session || session.status === "disconnected") {
        try {
          session = await connect(flow.organization_id);
        } catch (error) {
          logger.error(
            { organization: flow.organization_id, error: error?.message },
            "Post-sale session restore failed",
          );
          continue;
        }
      }

      if (!session?.sock || session.status !== "connected") continue;

      try {
        await startPostPurchase(flow);
        worker.lastProcessed += 1;
        worker.totalSent += 1;
      } catch (error) {
        logger.error(
          { flow: flow.id, message: error.message },
          "Post-sale send failed",
        );

        await supabase
          .from("post_purchase_flows")
          .update({
            stage: "failed",
            last_error: error.message,
            updated_at: new Date().toISOString(),
          })
          .eq("id", flow.id);
      }
    }

    worker.lastSuccessAt = new Date().toISOString();
    worker.lastError = null;
  } catch (error) {
    worker.lastError = error.message;
    logger.error(error, "Queue processing failed");
  } finally {
    working = false;
    worker.running = false;
  }
}

async function restoreSessions() {
  if (!supabase) return;

  const { data: settings, error: settingsError } = await supabase
    .from("promotion_communication_settings")
    .select("promotions(organization_id)")
    .not("group_jid", "is", null);

  const { data: flows, error: flowsError } = await supabase
    .from("post_purchase_flows")
    .select("organization_id")
    .in("stage", [
      "pending_send",
      "failed",
      "awaiting_product",
      "awaiting_reward_type",
      "awaiting_address",
    ]);

  if (settingsError || flowsError) {
    logger.error(
      { settingsError, flowsError },
      "Restore sessions query failed",
    );
    return;
  }

  const organizations = new Set(
    [
      ...(settings || []).map((item) =>
        Array.isArray(item.promotions)
          ? item.promotions[0]?.organization_id
          : item.promotions?.organization_id,
      ),
      ...(flows || []).map((flow) => flow.organization_id),
    ].filter(Boolean),
  );

  for (const organization of organizations) {
    connect(organization).catch((error) => {
      logger.error(
        { organization, error: error?.message },
        "Initial WhatsApp session restore failed",
      );
    });
  }
}

function shutdown(signal) {
  logger.info({ signal }, "Shutting down WhatsApp gateway");

  for (const session of sessions.values()) {
    session.intentionalClose = true;
    clearReconnectTimer(session);
    try {
      session.sock?.end?.(new Error(`shutdown: ${signal}`));
    } catch {}
  }

  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

setInterval(() => processQueue(), 5_000);

app.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "WhatsApp gateway started");
  restoreSessions();
  setTimeout(() => processQueue(), 1_500);
});
