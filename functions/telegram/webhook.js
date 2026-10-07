const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const TELEGRAM_API = "https://api.telegram.org";
const FLOW_PREFIX = "bdml2";

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const configError = validateBaseConfig(env);
    if (configError) return json({ ok: false, error: configError }, 503);
    if (!verifyWebhookSecret(request, env.TELEGRAM_WEBHOOK_SECRET)) return json({ ok: false, error: "Invalid webhook secret" }, 401);

    const update = await request.json().catch(() => null);
    if (!update || typeof update !== "object") return json({ ok: true, ignored: true });
    if (update.callback_query) {
      await handleCallback(update.callback_query, request, env);
      return json({ ok: true });
    }
    if (update.message?.text) {
      await handleMessage(update.message, request, env);
      return json({ ok: true });
    }
    return json({ ok: true, ignored: true });
  } catch (error) {
    console.error("telegram webhook error", error);
    return json({ ok: false, error: error?.message || "Unexpected Telegram webhook error" }, 500);
  }
}

export async function onRequestGet() {
  return json({ ok: true, service: "BestDia Telegram Top-up Bot", version: 2, checkout: "bestdia-website" });
}

function validateBaseConfig(env) {
  if (!botToken(env)) return "TELEGRAM_CUSTOMER_BOT_TOKEN is not configured";
  if (!env.TELEGRAM_WEBHOOK_SECRET) return "TELEGRAM_WEBHOOK_SECRET is not configured";
  return "";
}

function botToken(env) {
  return String(env.TELEGRAM_CUSTOMER_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || "").trim();
}

function verifyWebhookSecret(request, expected) {
  const actual = request.headers.get("x-telegram-bot-api-secret-token") || "";
  return Boolean(expected) && safeEqual(String(actual), String(expected));
}

async function handleMessage(message, request, env) {
  const chatId = message.chat?.id;
  if (!chatId) return;
  const text = String(message.text || "").trim();

  const startMatch = text.match(/^\/start(?:@\w+)?(?:\s+([^\s]+))?/i);
  if (startMatch) {
    await configureBotUx(env).catch(() => {});
    const payload = String(startMatch[1] || "").trim().toLowerCase();
    if (payload === "mlbb" || payload === "topup" || payload === "mlbb-global") {
      return sendMlbbPrompt(chatId, env, true);
    }
    return sendWelcome(chatId, env);
  }

  if (/^\/topup(?:@\w+)?(?:\s|$)/i.test(text)) return sendMlbbPrompt(chatId, env, true);
  if (/^\/menu(?:@\w+)?(?:\s|$)/i.test(text)) return sendWelcome(chatId, env);
  if (/^\/help(?:@\w+)?(?:\s|$)/i.test(text)) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "BestDia Auto Top-up Bot\n\n1) MLBB ကိုရွေးပါ\n2) Player ID + Zone ID ပို့ပါ\n3) Account verify လုပ်ပါ\n4) Package ရွေးပါ\n5) BestDia website checkout ကိုဖွင့်ပါ\n6) KBZPay / Wave Money / TrueMoney / PromptPay / BestDia Balance နဲ့ပေးချေပါ\n7) BestDia backend က order နဲ့ supplier top-up ကိုဆက်လုပ်ပါမယ်။",
      reply_markup: { inline_keyboard: [[{ text: "🎮 MLBB Top-up", callback_data: "game:mlbb" }]] },
    });
    return;
  }
  const pair = parseMlbbIds(text);
  if (pair) return handleMlbbLookupMessage(chatId, pair, request, env);

  // A new customer should never hit a dead end. Any unrecognized first message
  // falls back to the normal welcome screen with a clear Top-up action.
  return sendWelcome(chatId, env);
}

async function sendWelcome(chatId, env) {
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: "💎 BestDia Auto Top-up\n\nTelegram ထဲကနေ MLBB account verify → package ရွေးပြီး BestDia website checkout မှာ KBZPay / Wave / TrueMoney / PromptPay / BestDia Balance နဲ့ပေးချေနိုင်ပါတယ်။\n\nMVP မှာ MLBB Global ကိုအရင်ဖွင့်ထားပါတယ်။",
    reply_markup: { inline_keyboard: [[{ text: "🎮 MLBB Global", callback_data: "game:mlbb" }],[{ text: "ℹ️ Help", callback_data: "help" }]] },
  });
}

async function handleCallback(callback, request, env) {
  const chatId = callback.message?.chat?.id || callback.from?.id;
  const data = String(callback.data || "");
  if (callback.id) await tg(env, "answerCallbackQuery", { callback_query_id: callback.id }).catch(() => {});
  if (!chatId) return;
  if (data === "home") return sendWelcome(chatId, env);
  if (data === "help") {
    return tg(env, "sendMessage", { chat_id: chatId, text: "MLBB Global အတွက် Player ID နဲ့ Zone ID ကို space ခြားပြီးပို့ပါ။ ဥပမာ — 123456789 1234" });
  }
  if (data === "game:mlbb") return sendMlbbPrompt(chatId, env);
  if (data.startsWith(`${FLOW_PREFIX}:pkg:`)) {
    const selection = decodeSelection(data.slice(`${FLOW_PREFIX}:pkg:`.length));
    if (!selection) return sendFlowExpired(chatId, env);
    return showPackageConfirmation(chatId, callback.from, selection, request, env);
  }
}

async function handleMlbbLookupMessage(chatId, ids, request, env) {
  await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  const origin = new URL(request.url).origin;
  const lookup = await bestDiaApi(origin, "/api/mlbb-lookup", { userId: ids.userId, zoneId: ids.zoneId });
  if (!lookup.ok) {
    return tg(env, "sendMessage", { chat_id: chatId, text: `❌ Account verify မဖြစ်ပါ။\n${lookup.error || "Player ID / Zone ID ကိုပြန်စစ်ပါ။"}`, reply_markup: { inline_keyboard: [[{ text: "🔁 Try again", callback_data: "game:mlbb" }]] } });
  }
  if (lookup.unsupported || lookup.validOrder === false) {
    return tg(env, "sendMessage", { chat_id: chatId, text: `⚠️ ${lookup.region || "ဒီ"} server account ကို MLBB Global auto top-up မှာ support မလုပ်သေးပါ။` });
  }
  const catalog = await getMlbbCatalog(origin);
  if (!catalog.packages.length) return tg(env, "sendMessage", { chat_id: chatId, text: "⚠️ MLBB package list ကို အခုချိန်မှာမရနိုင်သေးပါ။" });
  const buttons = catalog.packages.filter(pkg => Number.isFinite(Number(pkg.id))).slice(0,24).map(pkg => [{ text: `${packageTitle(pkg)} — ${formatKs(pkg.price)} Ks`, callback_data: `${FLOW_PREFIX}:pkg:${encodeSelection({ userId: ids.userId, zoneId: ids.zoneId, pkgId: pkg.id })}` }]);
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: `✅ Account verified\n\nIGN: ${lookup.nickname || "Verified"}\nRegion: ${lookup.region || "Global"}\nPlayer ID: ${ids.userId}\nZone ID: ${ids.zoneId}\n\nDiamond package ရွေးပါ။`,
    reply_markup: { inline_keyboard: buttons },
  });
}

async function showPackageConfirmation(chatId, from, selection, request, env) {
  const origin = new URL(request.url).origin;
  const pkg = await findPackage(origin, selection.pkgId);
  if (!pkg) return sendFlowExpired(chatId, env);
  const checkoutUrl = await buildCheckoutUrl(origin, selection, from, env);
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: `Order confirm\n\n🎮 MLBB Global\n💎 ${packageTitle(pkg)}\n💵 ${formatKs(pkg.price)} Ks / ฿${formatThb(pkg.priceThb)}\n🆔 ${selection.userId} (${selection.zoneId})\n\nPayment ကို BestDia website checkout မှာဆက်လုပ်ပါ။`,
    reply_markup: { inline_keyboard: [[{ text: "💳 Continue to BestDia Checkout", url: checkoutUrl }],[{ text: "⬅️ Change account", callback_data: "game:mlbb" }]] },
  });
}

async function buildCheckoutUrl(origin, selection, from, env) {
  const url = new URL("/telegram-checkout.html", origin);
  url.searchParams.set("userId", selection.userId);
  url.searchParams.set("zoneId", selection.zoneId);
  url.searchParams.set("pkgId", selection.pkgId);
  const telegramChatId = String(from?.id || "").trim();
  if (/^-?\d{1,20}$/.test(telegramChatId)) {
    url.searchParams.set("tgChatId", telegramChatId);
    const signature = await signTelegramCheckout(env.TELEGRAM_WEBHOOK_SECRET, `${selection.userId}.${selection.zoneId}.${selection.pkgId}.${telegramChatId}`);
    if (signature) url.searchParams.set("tgSig", signature);
  }
  const username = String(from?.username || "").trim();
  const contact = username ? `@${username}` : telegramChatId ? `telegram:${telegramChatId}` : "";
  if (contact) url.searchParams.set("contact", contact);
  return url.toString();
}

async function signTelegramCheckout(secret, value) {
  if (!secret) return "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(String(secret)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function getMlbbCatalog(origin) {
  const data = await bestDiaApi(origin, "/api/catalog", {});
  const products = Array.isArray(data.products) ? data.products : [];
  const mlbb = products.find(item => item?.key === "mlbb");
  return { packages: Array.isArray(mlbb?.packages) ? mlbb.packages : [] };
}

async function findPackage(origin, pkgId) {
  const catalog = await getMlbbCatalog(origin);
  return catalog.packages.find(pkg => String(pkg.id) === String(pkgId)) || null;
}

async function bestDiaApi(origin, path, body) {
  const response = await fetch(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const data = await response.json().catch(() => ({}));
  return { httpOk: response.ok, ...data, ok: response.ok && data.ok !== false };
}

async function tg(env, method, body) {
  const response = await fetch(`${TELEGRAM_API}/bot${botToken(env)}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

function parseMlbbIds(text) {
  const matches = String(text || "").match(/^(\d{5,20})\s*[,|/\-]?\s*(\d{3,10})$/);
  return matches ? { userId: matches[1], zoneId: matches[2] } : null;
}
function packageTitle(pkg) { return String(pkg?.title || pkg?.name || `${pkg?.diamonds || ""} Diamonds`).trim() || "MLBB Package"; }
function formatKs(value) { const amount = Math.round(Number(value || 0)); return Number.isFinite(amount) ? amount.toLocaleString("en-US") : "-"; }
function formatThb(value) { const amount = Number(value || 0); return Number.isFinite(amount) ? Math.ceil(amount).toLocaleString("en-US") : "-"; }
function encodeSelection({ userId, zoneId, pkgId }) { return `${userId}.${zoneId}.${pkgId}`; }
function decodeSelection(value) {
  const [userId, zoneId, pkgId, ...rest] = String(value || "").split(".");
  if (rest.length || !/^\d{5,20}$/.test(userId) || !/^\d{3,10}$/.test(zoneId) || !/^\d{1,8}$/.test(String(pkgId))) return null;
  return { userId, zoneId, pkgId };
}
function sendFlowExpired(chatId, env) {
  return tg(env, "sendMessage", { chat_id: chatId, text: "ဒီ package selection က expire ဖြစ်သွားပါတယ်။ Account ကိုပြန်စပြီး verify လုပ်ပါ။", reply_markup: { inline_keyboard: [[{ text: "🎮 Start MLBB", callback_data: "game:mlbb" }]] } });
}
function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS }); }
