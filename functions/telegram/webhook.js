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
  const caption = [
    "💎 <b>BestDia Auto Top-up</b>",
    "",
    "🎮 <b>MLBB Global</b>",
    "⚡ Account verification",
    "💳 KBZPay • Wave • TrueMoney • PromptPay",
    "🪙 BestDia Balance",
    "",
    "Fast • Secure • Simple",
    "",
    "အောက်က button ကနေ Top-up စတင်ပါ။",
  ].join("\n");
  const body = {
    chat_id: chatId,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "💎 Top-up MLBB", callback_data: "game:mlbb" }],
        [{ text: "📦 How it works", callback_data: "help" }, { text: "🏠 Menu", callback_data: "home" }],
      ],
    },
  };
  const imageUrl = String(env.TELEGRAM_WELCOME_IMAGE_URL || "").trim();
  if (imageUrl) {
    try {
      await tg(env, "sendPhoto", { ...body, photo: imageUrl, caption });
      return;
    } catch (error) {
      console.warn("Telegram welcome image failed; falling back to text", error);
    }
  }
  await tg(env, "sendMessage", { ...body, text: caption });
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
  if (data.startsWith(`${FLOW_PREFIX}:cat:`)) {
    const parsed = decodeCategorySelection(data.slice(`${FLOW_PREFIX}:cat:`.length));
    if (!parsed) return sendFlowExpired(chatId, env);
    return showPackageCategory(chatId, parsed, request, env);
  }
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
  const categories = packageCategories(catalog.packages);
  const categoryButtons = [
    categories.popular.length ? [{ text: "🔥 Popular", callback_data: `${FLOW_PREFIX}:cat:popular:${encodeAccount(ids)}` }] : [],
    [
      categories.normal.length ? { text: `💎 Diamonds (${categories.normal.length})`, callback_data: `${FLOW_PREFIX}:cat:normal:${encodeAccount(ids)}` } : null,
      categories.passes.length ? { text: `🎫 Passes (${categories.passes.length})`, callback_data: `${FLOW_PREFIX}:cat:passes:${encodeAccount(ids)}` } : null,
    ].filter(Boolean),
    categories.double.length ? [{ text: `✨ Double Diamond (${categories.double.length})`, callback_data: `${FLOW_PREFIX}:cat:double:${encodeAccount(ids)}` }] : [],
    [{ text: "🔄 Change account", callback_data: "game:mlbb" }],
  ].filter(row => row.length);
  await tg(env, "sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: [
      "✅ <b>Account Verified</b>",
      "",
      `👤 <b>${escapeHtmlText(lookup.nickname || "Verified")}</b>`,
      `🌏 ${escapeHtmlText(lookup.region || "Global")}`,
      `🆔 ${ids.userId} (${ids.zoneId})`,
      "",
      "Package category ရွေးပါ 👇",
    ].join("\n"),
    reply_markup: { inline_keyboard: categoryButtons },
  });
}


async function showPackageCategory(chatId, selection, request, env) {
  const origin = new URL(request.url).origin;
  const catalog = await getMlbbCatalog(origin);
  const categories = packageCategories(catalog.packages);
  const packages = (categories[selection.category] || []).slice(0, 24);
  if (!packages.length) return sendFlowExpired(chatId, env);
  const labels = { popular: "🔥 Popular", normal: "💎 Normal Diamonds", passes: "🎫 Passes & Bundles", double: "✨ Double Diamond" };
  const buttons = packages.map(pkg => [{
    text: `${packageTitle(pkg)}  •  ${formatKs(pkg.price)} Ks`,
    callback_data: `${FLOW_PREFIX}:pkg:${encodeSelection({ userId: selection.userId, zoneId: selection.zoneId, pkgId: pkg.id })}`,
  }]);
  buttons.push([{ text: "⬅️ Categories", callback_data: `${FLOW_PREFIX}:cat:popular:${encodeAccount(selection)}` }, { text: "🏠 Menu", callback_data: "home" }]);
  return tg(env, "sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: `<b>${labels[selection.category] || "MLBB Packages"}</b>\n\nPackage တစ်ခုရွေးပါ 👇`,
    reply_markup: { inline_keyboard: buttons },
  });
}

function packageCategories(packages) {
  const valid = (Array.isArray(packages) ? packages : []).filter(pkg => Number.isFinite(Number(pkg?.id)));
  const passes = valid.filter(pkg => /(weekly|pass|bundle|monthly|twilight|super\s*value|starlight)/i.test(packageTitle(pkg)));
  const double = valid.filter(pkg => /(double|\d+\s*\+\s*\d+)/i.test(packageTitle(pkg)));
  const special = new Set([...passes, ...double]);
  const normal = valid.filter(pkg => !special.has(pkg));
  const popular = normal.slice(0, 6);
  return { popular, normal, passes, double };
}

function encodeAccount({ userId, zoneId }) { return `${userId}.${zoneId}`; }
function decodeCategorySelection(value) {
  const [category, userId, zoneId, ...rest] = String(value || "").split(":").flatMap((part, index) => index === 1 ? part.split(".") : [part]);
  if (rest.length || !["popular","normal","passes","double"].includes(category) || !/^\d{5,20}$/.test(userId) || !/^\d{3,10}$/.test(zoneId)) return null;
  return { category, userId, zoneId };
}
function escapeHtmlText(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[char]));
}

async function showPackageConfirmation(chatId, from, selection, request, env) {
  const origin = new URL(request.url).origin;
  const pkg = await findPackage(origin, selection.pkgId);
  if (!pkg) return sendFlowExpired(chatId, env);
  const checkoutUrl = await buildCheckoutUrl(origin, selection, from, env);
  await tg(env, "sendMessage", {
    chat_id: chatId,
    parse_mode: "HTML",
    text: [
      "🧾 <b>Order Summary</b>",
      "",
      "🎮 MLBB Global",
      `💎 <b>${escapeHtmlText(packageTitle(pkg))}</b>`,
      `💵 <b>${formatKs(pkg.price)} Ks</b>  •  ฿${formatThb(pkg.priceThb)}`,
      `🆔 ${selection.userId} (${selection.zoneId})`,
      "",
      "Payment ကို BestDia secure checkout မှာဆက်လုပ်ပါ။",
    ].join("\n"),
    reply_markup: { inline_keyboard: [[{ text: "💳 Secure Checkout", url: checkoutUrl }],[{ text: "🔄 Change account", callback_data: "game:mlbb" }, { text: "🏠 Menu", callback_data: "home" }]] },
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
