const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-BestDia-Secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") return new Response("", { status: 204, headers: JSON_HEADERS });

  const routePath = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  const route = routePath.replace(/^\/+|\/+$/g, "");

  try {
    if (route === "admin-auth") return adminAuth(request, env);
    if (route === "mlbb-lookup") return mlbbLookup(request, env);
    if (route === "mxshop-diagnostic") return mxshopDiagnostic(request, env);
    if (route === "mxshop-topup") return mxshopTopup(request, env);
    if (route === "payment-webhook") return paymentWebhook(request, env);
    if (route === "telegram-diagnostic") return telegramDiagnostic(request, env);
    if (route === "telegram-notify") return telegramNotify(request, env);
    return jsonResponse(404, { ok: false, error: "API route not found" });
  } catch (error) {
    if (error.status) return jsonResponse(error.status, { ok: false, error: error.message });
    return jsonResponse(500, { ok: false, error: error.message || "Unexpected API error" });
  }
}

async function adminAuth(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  const payload = await readJson(request);
  if (!env.ADMIN_PASSWORD) return jsonResponse(500, { ok: false, error: "ADMIN_PASSWORD is not configured" });
  if (String(payload.adminPassword || "") !== env.ADMIN_PASSWORD) {
    return jsonResponse(401, { ok: false, error: "Wrong admin password" });
  }
  return jsonResponse(200, { ok: true });
}

async function mlbbLookup(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  const payload = await readJson(request);
  const userId = onlyDigits(payload.userId);
  const zoneId = onlyDigits(payload.zoneId);
  if (!userId || !zoneId) return jsonResponse(400, { error: "Missing User ID or Zone ID" });

  const candidates = [
    {
      source: "xpreloads",
      url: `https://xpreloads.com/api/api/mlbb?user_id=${encodeURIComponent(userId)}&server_id=${encodeURIComponent(zoneId)}`,
      method: "GET",
      headers: { "Content-Type": "application/json", "X-Custom-Token": "narbu-frontend" },
    },
    { source: "namdevel", url: "https://public-api.namdevel.rest/v1/init/username", method: "POST_FORM" },
    env.MLBB_LOOKUP_URL,
    { source: "codashop-api", url: "https://api.codashop.com/v1/init/username", method: "POST_FORM" },
    { source: "codashop-sg", url: "https://order-sg.codashop.com/v1/init/username", method: "POST_FORM" },
  ].filter(Boolean);

  for (const candidate of candidates) {
    const result = await tryLookup(candidate, userId, zoneId);
    if (result.nickname) return jsonResponse(200, { ok: true, nickname: result.nickname, source: result.source });
  }

  return jsonResponse(502, { ok: false, error: "Nickname lookup is unavailable. Please verify the ID manually." });
}

async function telegramNotify(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  const payload = await readJson(request);
  const text = String(payload.text || "").trim();
  if (!text) return jsonResponse(400, { error: "Missing notification text" });

  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return jsonResponse(500, {
      error: "Telegram is not configured",
      details: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Cloudflare Pages environment variables.",
    });
  }

  const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  const body = await telegramRes.json().catch(() => ({}));
  if (!telegramRes.ok || body.ok === false) {
    const isUnauthorized = telegramRes.status === 401 || body.error_code === 401;
    return jsonResponse(502, {
      error: isUnauthorized ? "Telegram bot token is invalid" : "Telegram send failed",
      details: isUnauthorized
        ? "Generate a new token in BotFather, save it as TELEGRAM_BOT_TOKEN in Cloudflare, then redeploy."
        : body.description || telegramRes.statusText,
    });
  }

  const slipDataUrl = String(payload.slipDataUrl || "");
  if (slipDataUrl.startsWith("data:image/")) {
    const sentPhoto = await sendSlipPhoto(botToken, chatId, slipDataUrl, String(payload.slipFileName || "payment-slip.jpg"));
    if (!sentPhoto.ok) {
      return jsonResponse(200, {
        ok: true,
        warning: "Order notification sent, but payment slip photo failed.",
        details: sentPhoto.description || sentPhoto.error || null,
      });
    }
  }

  return jsonResponse(200, { ok: true });
}

async function telegramDiagnostic(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  const payload = await readJson(request);
  if (!env.ADMIN_PASSWORD) return jsonResponse(500, { error: "ADMIN_PASSWORD is not configured" });
  if (payload.adminPassword !== env.ADMIN_PASSWORD) return jsonResponse(401, { error: "Wrong admin password" });

  const botToken = env.TELEGRAM_BOT_TOKEN;
  const configuredChatId = env.TELEGRAM_CHAT_ID;
  const result = { hasBotToken: Boolean(botToken), hasChatId: Boolean(configuredChatId), configuredChatId: configuredChatId || null };

  if (!botToken) return jsonResponse(200, { ...result, ok: false, error: "Missing TELEGRAM_BOT_TOKEN in Cloudflare environment variables." });

  const me = await telegram(botToken, "getMe");
  result.bot = me.ok ? me.result : null;
  result.getMe = summarizeTelegram(me);
  if (!me.ok) return jsonResponse(200, { ...result, ok: false, error: "Bot token is not valid." });

  const updates = await telegram(botToken, "getUpdates", { limit: 20 });
  result.getUpdates = summarizeTelegram(updates);
  if (updates.ok) {
    result.recentChats = updates.result
      .map((update) => update.message || update.edited_message || update.channel_post)
      .filter(Boolean)
      .map((message) => ({
        chatId: message.chat?.id,
        type: message.chat?.type,
        name: [message.chat?.first_name, message.chat?.last_name].filter(Boolean).join(" ") || message.chat?.title || "",
        username: message.chat?.username || "",
        text: message.text || "",
        date: message.date || null,
      }));
  }

  if (!configuredChatId) return jsonResponse(200, { ...result, ok: false, error: "Missing TELEGRAM_CHAT_ID in Cloudflare environment variables." });

  const sent = await telegram(botToken, "sendMessage", {
    chat_id: configuredChatId,
    text: "BestDia Telegram test: notifications are connected.",
  });
  result.sendMessage = summarizeTelegram(sent);

  return jsonResponse(200, { ...result, ok: sent.ok, error: sent.ok ? null : sent.description || "Telegram test message failed." });
}

async function mxshopDiagnostic(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  if (!env.ADMIN_PASSWORD) return jsonResponse(500, { ok: false, error: "ADMIN_PASSWORD is not configured" });
  if (String(payload.adminPassword || "") !== env.ADMIN_PASSWORD) return jsonResponse(401, { ok: false, error: "Wrong admin password" });
  if (!env.MXSHOP_MX_KEY || !env.MXSHOP_PASSKEY) return jsonResponse(500, { ok: false, error: "MXSHOP_MX_KEY and MXSHOP_PASSKEY are required" });

  const stockIDX = payload.StockIDX || env.MXSHOP_STOCK_IDX || "17";
  const hello = await mxPost(env, "/api/v1/hello");
  const balance = await mxPost(env, "/api/v1/get_balance");
  const releases = await mxPost(env, "/api/v1/get_stockreleaselist", { StockIDX: stockIDX, type: payload.type || 4 });

  return jsonResponse(200, {
    ok: Boolean(hello.success && balance.success && !releases.error),
    stockIDX,
    hello: summarizeMx(hello),
    balance: summarizeMx(balance),
    releases: summarizeMx(releases),
  });
}

async function mxshopTopup(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  if (!env.ADMIN_PASSWORD) return jsonResponse(500, { ok: false, error: "ADMIN_PASSWORD is not configured" });
  if (String(payload.adminPassword || "") !== env.ADMIN_PASSWORD) return jsonResponse(401, { ok: false, error: "Wrong admin password" });
  if (env.MXSHOP_AUTO_TOPUP_ENABLED !== "true") {
    return jsonResponse(200, { ok: true, skipped: true, reason: "MXSHOP_AUTO_TOPUP_ENABLED is not true" });
  }

  const order = payload.order || {};
  const pkgId = String(order.pkg?.id || "");
  const uid = buildMxUid(order, env);
  const stockReleaseId = getMappedStockReleaseId(pkgId, env);
  if (!stockReleaseId) return jsonResponse(400, { ok: false, error: `No MXShop stockreleaselist_id mapped for package id ${pkgId}` });
  if (!uid) return jsonResponse(400, { ok: false, error: "Missing MLBB user id / zone id" });
  if (!env.MXSHOP_MX_KEY || !env.MXSHOP_PASSKEY) {
    return jsonResponse(500, { ok: false, error: "MXShop credentials are not configured. Set MXSHOP_MX_KEY and MXSHOP_PASSKEY." });
  }

  const requestBody = { stockreleaselist_id: stockReleaseId, uid };
  const response = await fetch(env.MXSHOP_PURCHASE_URL || `${env.MXSHOP_API_BASE || "https://service.mxshop.in.th"}/api/v1/buy`, {
    method: "POST",
    headers: buildMxHeaders(env),
    body: JSON.stringify(requestBody),
  });
  const text = await response.text();
  const data = safeJson(text);

  if (!response.ok || !data || data?.success === false || data?.ok === false || (data?.error_code !== undefined && Number(data.error_code) !== 0)) {
    return jsonResponse(502, {
      ok: false,
      error: data?.msg || data?.message || data?.error || response.statusText || "MXShop purchase failed",
      status: response.status,
      mxshop: data || text,
      request: requestBody,
    });
  }

  return jsonResponse(200, { ok: true, skipped: false, mxshop: data || text, request: requestBody });
}

async function paymentWebhook(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  if (env.PAYMENT_AUTOMATION_ENABLED !== "true") {
    return jsonResponse(200, { ok: true, skipped: true, reason: "PAYMENT_AUTOMATION_ENABLED is not true" });
  }
  if (!verifyWebhookSecret(request.headers, env.PAYMENT_WEBHOOK_SECRET || "")) {
    return jsonResponse(401, { ok: false, error: "Invalid webhook secret" });
  }

  const payload = await readJson(request);
  const payment = normalizePayment(payload);
  if (!payment.orderId) {
    return jsonResponse(400, { ok: false, error: "Missing order reference. Send orderId, order_id, reference, or client_reference." });
  }

  if (!payment.paid) {
    await notifyTelegram(env, `<b>Payment event not paid</b>\nOrder: <code>${escapeHtml(payment.orderId)}</code>\nProvider: ${escapeHtml(payment.provider)}\nStatus: ${escapeHtml(payment.status || "unknown")}`);
    return jsonResponse(200, { ok: true, paid: false, payment });
  }

  const firestore = await markOrderPaid(env, payment, payload);
  await notifyTelegram(
    env,
    `<b>Payment verified</b>\nOrder: <code>${escapeHtml(payment.orderId)}</code>\nProvider: ${escapeHtml(payment.provider)}\nAmount: ${escapeHtml(String(payment.amount || "unknown"))} ${escapeHtml(payment.currency || "MMK")}\nTxID: <code>${escapeHtml(payment.txid || "none")}</code>\nFirestore: ${firestore.updated ? "updated" : escapeHtml(firestore.reason || "not updated")}`
  );

  return jsonResponse(200, { ok: true, paid: true, payment, firestore });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "Content-Type": "application/json" },
  });
}

async function tryLookup(candidate, userId, zoneId) {
  try {
    const config = typeof candidate === "string" ? { source: candidate, url: candidate, method: "POST_FORM" } : candidate;
    const body = new URLSearchParams({ game_code: "MOBILE_LEGENDS", user_id: userId, zone_id: zoneId });
    const options = config.method === "GET"
      ? { method: "GET", headers: { "User-Agent": "BestDia/1.0", ...(config.headers || {}) } }
      : { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "BestDia/1.0", ...(config.headers || {}) }, body };
    const response = await fetch(config.url, options);
    const raw = await response.text();
    const data = parseLookupBody(raw);
    return { nickname: findNickname(data), source: config.source || config.url };
  } catch {
    return {};
  }
}

function parseLookupBody(raw) {
  const text = String(raw || "").trim();
  if (!text || /^not found$/i.test(text)) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { nickname: text };
  }
}

function findNickname(value) {
  if (!value || typeof value !== "object") return "";
  for (const key of ["nickname", "username", "userName", "name", "ign"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  for (const nested of Object.values(value)) {
    const found = findNickname(nested);
    if (found) return found;
  }
  return "";
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

async function sendSlipPhoto(botToken, chatId, dataUrl, fileName) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return { ok: false, error: "Invalid slip image" };
  const bytes = base64ToBytes(match[2]);
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", "Payment slip");
  form.append("photo", new Blob([bytes], { type: match[1] }), fileName || "payment-slip.jpg");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok && body.ok !== false, status: response.status, ...body };
}

async function telegram(botToken, method, payload) {
  const options = payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : undefined;
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, options);
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok && body.ok !== false, status: response.status, ...body };
  } catch (error) {
    return { ok: false, status: 0, description: error.message };
  }
}

function summarizeTelegram(response) {
  return { ok: response.ok, status: response.status, errorCode: response.error_code || null, description: response.description || null };
}

async function mxPost(env, path, body = {}) {
  try {
    const response = await fetch(`${env.MXSHOP_API_BASE || "https://service.mxshop.in.th"}${path}`, {
      method: "POST",
      headers: buildMxHeaders(env),
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const data = safeJson(text);
    return { httpStatus: response.status, ok: response.ok, ...(data || { raw: text }) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function buildMxHeaders(env) {
  const headers = { "Content-Type": "application/json" };
  if (env.MXSHOP_MX_KEY) headers["mx-key"] = env.MXSHOP_MX_KEY;
  if (env.MXSHOP_PASSKEY) headers.passkey = env.MXSHOP_PASSKEY;
  return headers;
}

function summarizeMx(response) {
  const result = response.result;
  const releaseList = Array.isArray(result) ? result : null;
  return {
    httpStatus: response.httpStatus || null,
    success: response.success ?? response.ok ?? false,
    error_code: response.error_code || null,
    msg: response.msg || response.message || response.error || "",
    result: releaseList
      ? releaseList.slice(0, 40).map((item) => ({
          stockreleaselist_id: item.stockreleaselist_id,
          product_stockname: item.product_stockname,
          price: item.price,
          not_available: item.not_available,
        }))
      : result || null,
  };
}

function buildMxUid(order, env) {
  const userId = String(order.userId || "").trim();
  const zoneId = String(order.zoneId || "").trim();
  if (!userId || !zoneId) return "";
  if (env.MXSHOP_UID_FORMAT === "space") return `${userId} ${zoneId}`;
  if (env.MXSHOP_UID_FORMAT === "slash") return `${userId}/${zoneId}`;
  return `${userId}(${zoneId})`;
}

function getMappedStockReleaseId(pkgId, env) {
  const defaultMap = {
    1: "169991",
    2: "169992",
    3: "169993",
    4: "169994",
    11: "170014",
    12: "170015",
    13: "170016",
    14: "170017",
    15: "170018",
    16: "170019",
    17: "170020",
    18: "170021",
    19: "170022",
  };
  try {
    return String({ ...defaultMap, ...JSON.parse(env.MXSHOP_PACKAGE_MAP || "{}") }[pkgId] || "").trim();
  } catch {
    return String(defaultMap[pkgId] || "").trim();
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function verifyWebhookSecret(headers, secret) {
  if (!secret) return false;
  const headerSecret = headers.get("x-bestdia-secret") || "";
  const auth = headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  return safeEqual(headerSecret, secret) || safeEqual(bearer, secret);
}

function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ""));
  const right = new TextEncoder().encode(String(b || ""));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function normalizePayment(payload) {
  const data = payload.data || payload.result || payload.payment || payload;
  const status = String(data.payment_status || data.checkout_status || data.status || payload.status || payload.type || "").toLowerCase();
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
  const paidStatuses = new Set(["paid", "success", "succeeded", "complete", "completed", "payment_success", "merchant.payment_received", "checkout.session.completed"]);
  return {
    paid: paidStatuses.has(status) || payload.type === "merchant.payment_received",
    status,
    orderId: String(orderId || "").trim().toUpperCase(),
    provider: String(payload.provider || payload.source || data.provider || payload.type || "payment"),
    amount: data.amount || data.total || data.paid_amount || payload.amount || null,
    currency: data.currency || payload.currency || "MMK",
    txid: data.txid || data.transaction_id || data.id || payload.txid || payload.id || "",
    rawEventId: payload.id || data.event_id || "",
  };
}

async function markOrderPaid(env, payment, rawPayload) {
  const serviceAccount = parseServiceAccount(env);
  if (!serviceAccount) return { updated: false, reason: "FIREBASE_SERVICE_ACCOUNT_JSON is not configured" };
  const token = await getAccessToken(serviceAccount);
  const docName = await findOrderDocName(serviceAccount.project_id, token, payment.orderId);
  if (!docName) return { updated: false, reason: "order not found" };

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
  if (payment.amount !== null && payment.amount !== undefined && payment.amount !== "") fields.paymentAmount = { doubleValue: Number(payment.amount) || 0 };

  const mask = Object.keys(fields).map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join("&");
  const response = await fetch(`https://firestore.googleapis.com/v1/${docName}?${mask}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { updated: false, reason: body.error?.message || response.statusText };
  return { updated: true, docName };
}

function parseServiceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return null;
  try {
    const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    return parsed;
  } catch {
    return null;
  }
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const jwtClaim = base64url(new TextEncoder().encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })));
  const input = `${jwtHeader}.${jwtClaim}`;
  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const assertion = `${input}.${base64url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "Could not get Firebase access token");
  return data.access_token;
}

async function importPrivateKey(pem) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(base64),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function findOrderDocName(projectId, token, orderId) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "orders" }],
        where: { fieldFilter: { field: { fieldPath: "id" }, op: "EQUAL", value: { stringValue: orderId } } },
        limit: 1,
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Could not query Firestore order");
  const hit = Array.isArray(data) ? data.find((item) => item.document) : null;
  return hit?.document?.name || "";
}

async function notifyTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
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

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
