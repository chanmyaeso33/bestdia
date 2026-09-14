const crypto = require("crypto");

const PAYMENT_AUTOMATION_ENABLED = process.env.PAYMENT_AUTOMATION_ENABLED === "true";
const PAYMENT_WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  if (!PAYMENT_AUTOMATION_ENABLED) {
    return jsonResponse(200, {
      ok: true,
      skipped: true,
      reason: "PAYMENT_AUTOMATION_ENABLED is not true",
    });
  }

  if (!verifyWebhookSecret(event.headers || {})) {
    return jsonResponse(401, { ok: false, error: "Invalid webhook secret" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
  }

  const payment = normalizePayment(payload);
  if (!payment.orderId) {
    return jsonResponse(400, {
      ok: false,
      error: "Missing order reference. Send orderId, order_id, reference, or client_reference.",
    });
  }

  if (!payment.paid) {
    await notifyTelegram(
      `⚠️ <b>Payment event not paid</b>\n` +
        `Order: <code>${escapeHtml(payment.orderId)}</code>\n` +
        `Provider: ${escapeHtml(payment.provider)}\n` +
        `Status: ${escapeHtml(payment.status || "unknown")}`
    );
    return jsonResponse(200, { ok: true, paid: false, payment });
  }

  const firestore = await markOrderPaid(payment, payload);
  await notifyTelegram(
    `✅ <b>Payment verified</b>\n` +
      `Order: <code>${escapeHtml(payment.orderId)}</code>\n` +
      `Provider: ${escapeHtml(payment.provider)}\n` +
      `Amount: ${escapeHtml(String(payment.amount || "unknown"))} ${escapeHtml(payment.currency || "MMK")}\n` +
      `TxID: <code>${escapeHtml(payment.txid || "none")}</code>\n` +
      `Firestore: ${firestore.updated ? "updated" : escapeHtml(firestore.reason || "not updated")}`
  );

  return jsonResponse(200, { ok: true, paid: true, payment, firestore });
};

function verifyWebhookSecret(headers) {
  if (!PAYMENT_WEBHOOK_SECRET) return false;
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), String(value || "")])
  );
  const headerSecret = normalized["x-bestdia-secret"] || "";
  const auth = normalized.authorization || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  return safeEqual(headerSecret, PAYMENT_WEBHOOK_SECRET) || safeEqual(bearer, PAYMENT_WEBHOOK_SECRET);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function normalizePayment(payload) {
  const data = payload.data || payload.result || payload.payment || payload;
  const status = String(
    data.payment_status ||
      data.checkout_status ||
      data.status ||
      payload.status ||
      payload.type ||
      ""
  ).toLowerCase();
  const orderId =
    data.orderId ||
    data.order_id ||
    data.reference ||
    data.client_reference ||
    data.merchant_reference ||
    data.custom_fields?.order_id ||
    data.custom_fields?.account_number ||
    payload.orderId ||
    payload.order_id ||
    payload.reference ||
    payload.client_reference ||
    "";
  const provider = payload.provider || payload.source || data.provider || payload.type || "payment";
  const paidStatuses = new Set([
    "paid",
    "success",
    "succeeded",
    "complete",
    "completed",
    "payment_success",
    "merchant.payment_received",
    "checkout.session.completed",
  ]);

  return {
    paid: paidStatuses.has(status) || payload.type === "merchant.payment_received",
    status,
    orderId: String(orderId || "").trim().toUpperCase(),
    provider: String(provider || "payment"),
    amount: data.amount || data.total || data.paid_amount || payload.amount || null,
    currency: data.currency || payload.currency || "MMK",
    txid: data.txid || data.transaction_id || data.id || payload.txid || payload.id || "",
    rawEventId: payload.id || data.event_id || "",
  };
}

async function markOrderPaid(payment, rawPayload) {
  const serviceAccount = parseServiceAccount();
  if (!serviceAccount) {
    return {
      updated: false,
      reason: "FIREBASE_SERVICE_ACCOUNT_JSON is not configured",
    };
  }

  const token = await getAccessToken(serviceAccount);
  const docName = await findOrderDocName(serviceAccount.project_id, token, payment.orderId);
  if (!docName) {
    return { updated: false, reason: "order not found" };
  }

  const fields = {
    paymentStatus: { stringValue: "verified" },
    paymentReference: { stringValue: payment.orderId },
    paymentProvider: { stringValue: payment.provider },
    paymentTxid: { stringValue: payment.txid || "" },
    paymentCurrency: { stringValue: payment.currency || "MMK" },
    paymentVerifiedAt: { timestampValue: new Date().toISOString() },
    paymentWebhookEventId: { stringValue: payment.rawEventId || "" },
    paymentWebhookRaw: { stringValue: JSON.stringify(rawPayload).slice(0, 9000) },
  };
  if (payment.amount !== null && payment.amount !== undefined && payment.amount !== "") {
    fields.paymentAmount = { doubleValue: Number(payment.amount) || 0 };
  }

  const mask = Object.keys(fields)
    .map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`)
    .join("&");
  const response = await fetch(`https://firestore.googleapis.com/v1/${docName}?${mask}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { updated: false, reason: body.error?.message || response.statusText };
  }
  return { updated: true, docName };
}

function parseServiceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    return parsed;
  } catch {
    return null;
  }
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const jwtClaim = base64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    })
  );
  const input = `${jwtHeader}.${jwtClaim}`;
  const signature = crypto.createSign("RSA-SHA256").update(input).sign(serviceAccount.private_key);
  const assertion = `${input}.${base64url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) {
    throw new Error(data.error_description || data.error || "Could not get Firebase access token");
  }
  return data.access_token;
}

async function findOrderDocName(projectId, token, orderId) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "orders" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "id" },
              op: "EQUAL",
              value: { stringValue: orderId },
            },
          },
          limit: 1,
        },
      }),
    }
  );
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || "Could not query Firestore order");
  }
  const hit = Array.isArray(data) ? data.find((item) => item.document) : null;
  return hit?.document?.name || "";
}

function base64url(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function notifyTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch {}
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-BestDia-Secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
