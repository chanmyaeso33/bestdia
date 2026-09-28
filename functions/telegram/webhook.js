const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const TELEGRAM_API = "https://api.telegram.org";
const FLOW_PREFIX = "bdml1";

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const configError = validateBaseConfig(env);
    if (configError) return json({ ok: false, error: configError }, 503);

    if (!verifyWebhookSecret(request, env.TELEGRAM_WEBHOOK_SECRET)) {
      return json({ ok: false, error: "Invalid webhook secret" }, 401);
    }

    const update = await request.json().catch(() => null);
    if (!update || typeof update !== "object") return json({ ok: true, ignored: true });

    if (update.pre_checkout_query) {
      await handlePreCheckout(update.pre_checkout_query, request, env);
      return json({ ok: true });
    }

    const message = update.message;
    if (message?.successful_payment) {
      await handleSuccessfulPayment(message, request, env);
      return json({ ok: true });
    }

    if (update.callback_query) {
      await handleCallback(update.callback_query, request, env);
      return json({ ok: true });
    }

    if (message?.text) {
      await handleMessage(message, request, env);
      return json({ ok: true });
    }

    return json({ ok: true, ignored: true });
  } catch (error) {
    console.error("telegram webhook error", error);
    return json({ ok: false, error: error?.message || "Unexpected Telegram webhook error" }, 500);
  }
}

export async function onRequestGet() {
  return json({ ok: true, service: "BestDia Telegram Top-up Bot", version: 1 });
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

  if (/^\/start(?:\s|$)/i.test(text) || /^\/menu(?:\s|$)/i.test(text)) {
    await sendWelcome(chatId, env);
    return;
  }

  if (/^\/help(?:\s|$)/i.test(text)) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "BestDia Auto Top-up Bot\n\n1) MLBB ကိုရွေးပါ\n2) Player ID + Zone ID ပို့ပါ\n3) Account ကို verify လုပ်ပါ\n4) Diamond package ရွေးပါ\n5) Telegram Stars နဲ့ checkout လုပ်ပါ\n6) Payment success ဖြစ်တာနဲ့ auto top-up လုပ်ပေးပါမယ်။",
      reply_markup: { inline_keyboard: [[{ text: "🎮 MLBB Top-up", callback_data: "game:mlbb" }]] },
    });
    return;
  }

  const pair = parseMlbbIds(text);
  if (pair) {
    await handleMlbbLookupMessage(chatId, pair, request, env);
    return;
  }

  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: "MLBB top-up အတွက် Player ID နဲ့ Zone ID ကို ဒီပုံစံနဲ့ပို့ပါ။\n\n123456789 1234",
    reply_markup: { inline_keyboard: [[{ text: "🏠 Main menu", callback_data: "home" }]] },
  });
}

async function sendWelcome(chatId, env) {
  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: "💎 BestDia Auto Top-up\n\nTelegram ထဲကနေ MLBB account verify → package ရွေး → Telegram Stars နဲ့ပေးချေ → auto top-up လုပ်နိုင်ပါတယ်။\n\nMVP မှာ MLBB Global ကိုအရင်ဖွင့်ထားပါတယ်။",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🎮 MLBB Global", callback_data: "game:mlbb" }],
        [{ text: "ℹ️ Help", callback_data: "help" }],
      ],
    },
  });
}

async function handleCallback(callback, request, env) {
  const chatId = callback.message?.chat?.id || callback.from?.id;
  const callbackId = callback.id;
  const data = String(callback.data || "");
  if (callbackId) await answerCallback(callbackId, env).catch(() => {});
  if (!chatId) return;

  if (data === "home") return sendWelcome(chatId, env);
  if (data === "help") {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "MLBB Global အတွက် Player ID နဲ့ Zone ID ကို space ခြားပြီးပို့ပါ။ ဥပမာ — 123456789 1234",
      reply_markup: { inline_keyboard: [[{ text: "🎮 Start MLBB", callback_data: "game:mlbb" }]] },
    });
    return;
  }
  if (data === "game:mlbb") {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "🎮 MLBB Global\n\nPlayer ID နဲ့ Zone ID ကို space ခြားပြီးပို့ပါ။\nဥပမာ — 123456789 1234",
    });
    return;
  }

  if (data.startsWith(`${FLOW_PREFIX}:pkg:`)) {
    const selection = decodeSelection(data.slice(`${FLOW_PREFIX}:pkg:`.length));
    if (!selection) return sendFlowExpired(chatId, env);
    await showPackageConfirmation(chatId, selection, request, env);
    return;
  }

  if (data.startsWith(`${FLOW_PREFIX}:buy:`)) {
    const selection = decodeSelection(data.slice(`${FLOW_PREFIX}:buy:`.length));
    if (!selection) return sendFlowExpired(chatId, env);
    await sendStarsInvoice(chatId, selection, request, env);
  }
}

async function handleMlbbLookupMessage(chatId, ids, request, env) {
  await tg(env, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
  const origin = new URL(request.url).origin;
  const lookup = await bestDiaApi(origin, "/api/mlbb-lookup", { userId: ids.userId, zoneId: ids.zoneId });

  if (!lookup.ok) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: `❌ Account verify မဖြစ်ပါ။\n${lookup.error || "Player ID / Zone ID ကိုပြန်စစ်ပါ။"}`,
      reply_markup: { inline_keyboard: [[{ text: "🔁 Try again", callback_data: "game:mlbb" }]] },
    });
    return;
  }
  if (lookup.unsupported || lookup.validOrder === false) {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: `⚠️ ${lookup.region || "ဒီ"} server account ကို MLBB Global auto top-up မှာ support မလုပ်သေးပါ။`,
      reply_markup: { inline_keyboard: [[{ text: "🔁 Use another account", callback_data: "game:mlbb" }]] },
    });
    return;
  }

  const catalog = await getMlbbCatalog(origin);
  if (!catalog.packages.length) {
    await tg(env, "sendMessage", { chat_id: chatId, text: "⚠️ MLBB package list ကို အခုချိန်မှာမရနိုင်သေးပါ။" });
    return;
  }

  const buttons = catalog.packages
    .filter((pkg) => Number.isFinite(Number(pkg.id)))
    .slice(0, 24)
    .map((pkg) => [{
      text: `${packageTitle(pkg)} — ${formatKs(pkg.price)} Ks`,
      callback_data: `${FLOW_PREFIX}:pkg:${encodeSelection({ userId: ids.userId, zoneId: ids.zoneId, pkgId: pkg.id })}`,
    }]);

  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: `✅ Account verified\n\nIGN: ${lookup.nickname || lookup.ign || lookup.username || "Verified"}\nRegion: ${lookup.region || "Global"}\nPlayer ID: ${ids.userId}\nZone ID: ${ids.zoneId}\n\nDiamond package ရွေးပါ။`,
    reply_markup: { inline_keyboard: buttons },
  });
}

async function showPackageConfirmation(chatId, selection, request, env) {
  const origin = new URL(request.url).origin;
  const pkg = await findPackage(origin, selection.pkgId);
  if (!pkg) return sendFlowExpired(chatId, env);

  const stars = starsForPackage(pkg, env);
  const priceLine = stars > 0
    ? `⭐ Telegram Stars: ${stars}`
    : "⚠️ Telegram Stars pricing မသတ်မှတ်ရသေးပါ။";

  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: `Order confirm\n\n🎮 MLBB Global\n💎 ${packageTitle(pkg)}\n💵 ${formatKs(pkg.price)} Ks / ฿${formatThb(pkg.priceThb)}\n${priceLine}\n🆔 ${selection.userId} (${selection.zoneId})`,
    reply_markup: {
      inline_keyboard: [
        [{ text: stars > 0 ? `⭐ Pay ${stars} Stars` : "⭐ Stars not configured", callback_data: `${FLOW_PREFIX}:buy:${encodeSelection(selection)}` }],
        [{ text: "⬅️ Change account", callback_data: "game:mlbb" }],
      ],
    },
  });
}

async function sendStarsInvoice(chatId, selection, request, env) {
  if (!env.TELEGRAM_IDEMPOTENCY || typeof env.TELEGRAM_IDEMPOTENCY.get !== "function") {
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: "⚠️ Live checkout ကိုမဖွင့်သေးပါ။ Cloudflare KV binding TELEGRAM_IDEMPOTENCY ကိုအရင် configure လုပ်ရန်လိုပါတယ်။",
    });
    return;
  }

  const origin = new URL(request.url).origin;
  const pkg = await findPackage(origin, selection.pkgId);
  if (!pkg) return sendFlowExpired(chatId, env);
  const stars = starsForPackage(pkg, env);
  if (stars < 1) {
    await tg(env, "sendMessage", { chat_id: chatId, text: "⚠️ TELEGRAM_STARS_PER_THB ကို configure မလုပ်ရသေးပါ။" });
    return;
  }

  const payload = invoicePayload(selection);
  await tg(env, "sendInvoice", {
    chat_id: chatId,
    title: truncate(`BestDia ${packageTitle(pkg)}`, 32),
    description: truncate(`MLBB Global top-up for ${selection.userId} (${selection.zoneId})`, 255),
    payload,
    currency: "XTR",
    prices: [{ label: truncate(packageTitle(pkg), 32), amount: stars }],
  });
}

async function handlePreCheckout(query, request, env) {
  const parsed = parseInvoicePayload(query.invoice_payload);
  if (!parsed) {
    await tg(env, "answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok: false, error_message: "Invalid BestDia invoice." });
    return;
  }
  if (query.currency !== "XTR") {
    await tg(env, "answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok: false, error_message: "BestDia digital top-ups use Telegram Stars only." });
    return;
  }

  const origin = new URL(request.url).origin;
  const pkg = await findPackage(origin, parsed.pkgId);
  const expected = pkg ? starsForPackage(pkg, env) : 0;
  if (!pkg || expected < 1 || Number(query.total_amount) !== expected) {
    await tg(env, "answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok: false, error_message: "Package price changed. Please reopen the package and try again." });
    return;
  }

  if (!env.TELEGRAM_IDEMPOTENCY || typeof env.TELEGRAM_IDEMPOTENCY.get !== "function") {
    await tg(env, "answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok: false, error_message: "BestDia live checkout is temporarily unavailable." });
    return;
  }

  await tg(env, "answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok: true });
}

async function handleSuccessfulPayment(message, request, env) {
  const chatId = message.chat?.id;
  if (!chatId) return;
  const payment = message.successful_payment;
  const parsed = parseInvoicePayload(payment.invoice_payload);
  if (!parsed || payment.currency !== "XTR") {
    await notifyAdmin(env, `⚠️ Unexpected Telegram payment received. Charge: ${payment.telegram_payment_charge_id || "unknown"}`);
    return;
  }

  const kv = env.TELEGRAM_IDEMPOTENCY;
  if (!kv || typeof kv.get !== "function" || typeof kv.put !== "function") {
    await notifyAdmin(env, `🚨 Paid Telegram order blocked: TELEGRAM_IDEMPOTENCY KV missing. Charge: ${payment.telegram_payment_charge_id}`);
    await tg(env, "sendMessage", { chat_id: chatId, text: "Payment received, but automatic delivery is temporarily paused. BestDia support has been notified." });
    return;
  }

  const chargeId = String(payment.telegram_payment_charge_id || "").trim();
  if (!chargeId) return;
  const key = `charge:${chargeId}`;
  const existing = await kv.get(key, "json").catch(() => null);
  if (existing) {
    await tg(env, "sendMessage", { chat_id: chatId, text: existing.status === "success" ? "✅ ဒီ payment ကိုအရင်က deliver လုပ်ပြီးသားပါ။" : "⏳ ဒီ payment ကို processing လုပ်နေပြီးသားပါ။" }).catch(() => {});
    return;
  }

  const origin = new URL(request.url).origin;
  const pkg = await findPackage(origin, parsed.pkgId);
  const expectedStars = pkg ? starsForPackage(pkg, env) : 0;
  if (!pkg || expectedStars < 1 || Number(payment.total_amount) !== expectedStars) {
    await kv.put(key, JSON.stringify({ status: "manual_review", reason: "price_mismatch", at: new Date().toISOString() }));
    await notifyAdmin(env, `🚨 Telegram payment price mismatch. Charge: ${chargeId}; received=${payment.total_amount}; expected=${expectedStars || "unknown"}`);
    await tg(env, "sendMessage", { chat_id: chatId, text: "Payment received. This order needs manual review before delivery; BestDia support has been notified." });
    return;
  }

  await kv.put(key, JSON.stringify({
    status: "processing",
    chargeId,
    userId: parsed.userId,
    zoneId: parsed.zoneId,
    pkgId: parsed.pkgId,
    stars: payment.total_amount,
    at: new Date().toISOString(),
  }));

  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: `✅ Payment received — ${payment.total_amount} ⭐\n⚡ ${packageTitle(pkg)} ကို auto top-up လုပ်နေပါတယ်…`,
  });

  const order = {
    id: `TG${Date.now().toString().slice(-8)}`,
    gameKey: "mlbb",
    userId: parsed.userId,
    zoneId: parsed.zoneId,
    pkg,
    contact: `telegram:${message.from?.id || chatId}`,
    payment: "Telegram Stars",
    payKey: "telegram-stars",
    paymentStatus: "verified",
    telegramPaymentChargeId: chargeId,
  };

  let fulfillment;
  try {
    fulfillment = await fulfillViaExistingSupplierApi(origin, order, env);
  } catch (error) {
    fulfillment = { ok: false, status: "failed", error: error?.message || "Supplier request failed" };
  }

  if (fulfillment.ok && fulfillment.status === "success") {
    const record = {
      status: "success",
      deliveredAt: new Date().toISOString(),
      chargeId,
      userId: parsed.userId,
      zoneId: parsed.zoneId,
      pkgId: parsed.pkgId,
      stars: payment.total_amount,
      supplier: fulfillment,
    };
    await kv.put(key, JSON.stringify(record));
    await tg(env, "sendMessage", {
      chat_id: chatId,
      text: `✅ TOP-UP SUCCESSFUL\n\n💎 ${packageTitle(pkg)}\n🎮 MLBB Global\n🆔 ${parsed.userId} (${parsed.zoneId})\n⭐ ${payment.total_amount} Stars\n\nThank you for choosing BestDia 💙`,
      reply_markup: { inline_keyboard: [[{ text: "💎 Top-up again", callback_data: "game:mlbb" }]] },
    });
    await notifyAdmin(env, `✅ Telegram auto top-up success\n${packageTitle(pkg)}\nPlayer: ${parsed.userId} (${parsed.zoneId})\nStars: ${payment.total_amount}\nCharge: ${chargeId}`);
    return;
  }

  const nextStatus = fulfillment.ok && fulfillment.status === "submitted" ? "submitted" : "manual_review";
  await kv.put(key, JSON.stringify({
    status: nextStatus,
    chargeId,
    userId: parsed.userId,
    zoneId: parsed.zoneId,
    pkgId: parsed.pkgId,
    stars: payment.total_amount,
    supplier: fulfillment,
    updatedAt: new Date().toISOString(),
  }));

  await tg(env, "sendMessage", {
    chat_id: chatId,
    text: nextStatus === "submitted"
      ? "⏳ Payment success ဖြစ်ပြီး supplier ဆီကို order ပို့ပြီးပါပြီ။ Delivery confirmation ကို BestDia ကစောင့်ကြည့်နေပါတယ်။"
      : "⚠️ Payment success ဖြစ်ပေမယ့် automatic delivery မပြီးသေးပါ။ BestDia support ကို manual review အတွက် notify လုပ်ထားပါတယ်။",
  });
  await notifyAdmin(env, `🚨 Telegram top-up needs review\nPlayer: ${parsed.userId} (${parsed.zoneId})\nPackage: ${packageTitle(pkg)}\nStars: ${payment.total_amount}\nCharge: ${chargeId}\nSupplier: ${truncate(JSON.stringify(fulfillment), 1200)}`);
}

async function fulfillViaExistingSupplierApi(origin, order, env) {
  if (!env.ADMIN_PASSWORD) throw new Error("ADMIN_PASSWORD is not configured");
  const path = order.pkg?.supplier === "moogold" ? "/api/moogold-topup" : "/api/mxshop-topup";
  const result = await bestDiaApi(origin, path, { adminPassword: env.ADMIN_PASSWORD, order });
  if (!result.ok) return { ok: false, status: "failed", error: result.error || "Supplier top-up failed", raw: result };
  const status = String(result.status || result.moogold?.status || result.mxshop?.status || "submitted").toLowerCase();
  return { ok: true, status: ["success", "completed", "complete"].includes(status) ? "success" : status === "failed" ? "failed" : "submitted", raw: result };
}

async function getMlbbCatalog(origin) {
  const data = await bestDiaApi(origin, "/api/catalog", {});
  const products = Array.isArray(data.products) ? data.products : [];
  const mlbb = products.find((item) => item?.key === "mlbb");
  return { packages: Array.isArray(mlbb?.packages) ? mlbb.packages : [] };
}

async function findPackage(origin, pkgId) {
  const catalog = await getMlbbCatalog(origin);
  return catalog.packages.find((pkg) => String(pkg.id) === String(pkgId)) || null;
}

async function bestDiaApi(origin, path, body) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  return { httpOk: response.ok, ...data, ok: response.ok && data.ok !== false };
}

async function tg(env, method, body) {
  const response = await fetch(`${TELEGRAM_API}/bot${botToken(env)}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.description || `Telegram ${method} failed`);
  return data.result;
}

async function answerCallback(callbackQueryId, env) {
  return tg(env, "answerCallbackQuery", { callback_query_id: callbackQueryId });
}

async function notifyAdmin(env, text) {
  const chatId = String(env.TELEGRAM_CHAT_ID || "").trim();
  if (!chatId) return;
  try {
    await tg(env, "sendMessage", { chat_id: chatId, text: truncate(text, 3800) });
  } catch (error) {
    console.error("telegram admin notify failed", error);
  }
}

function parseMlbbIds(text) {
  const matches = String(text || "").match(/^(\d{5,20})\s*[,|/\-]?\s*(\d{3,10})$/);
  if (!matches) return null;
  return { userId: matches[1], zoneId: matches[2] };
}

function packageTitle(pkg) {
  return String(pkg?.title || pkg?.name || `${pkg?.diamonds || ""} Diamonds`).trim() || "MLBB Package";
}

function formatKs(value) {
  const amount = Math.round(Number(value || 0));
  return Number.isFinite(amount) ? amount.toLocaleString("en-US") : "-";
}

function formatThb(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.ceil(amount).toLocaleString("en-US") : "-";
}

function starsForPackage(pkg, env) {
  const rate = Number(env.TELEGRAM_STARS_PER_THB || 0);
  const thb = Number(pkg?.priceThb || 0);
  if (!(rate > 0) || !(thb > 0)) return 0;
  return Math.max(1, Math.ceil(thb * rate));
}

function encodeSelection({ userId, zoneId, pkgId }) {
  return `${userId}.${zoneId}.${pkgId}`;
}

function decodeSelection(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 3) return null;
  const [userId, zoneId, pkgId] = parts;
  if (!/^\d{5,20}$/.test(userId) || !/^\d{3,10}$/.test(zoneId) || !/^\d{1,8}$/.test(String(pkgId))) return null;
  return { userId, zoneId, pkgId };
}

function invoicePayload(selection) {
  return `${FLOW_PREFIX}|${selection.userId}|${selection.zoneId}|${selection.pkgId}`;
}

function parseInvoicePayload(payload) {
  const parts = String(payload || "").split("|");
  if (parts.length !== 4 || parts[0] !== FLOW_PREFIX) return null;
  const [, userId, zoneId, pkgId] = parts;
  return decodeSelection(`${userId}.${zoneId}.${pkgId}`);
}

function sendFlowExpired(chatId, env) {
  return tg(env, "sendMessage", {
    chat_id: chatId,
    text: "ဒီ package selection က expire ဖြစ်သွားပါတယ်။ Account ကိုပြန်စပြီး verify လုပ်ပါ။",
    reply_markup: { inline_keyboard: [[{ text: "🎮 Start MLBB", callback_data: "game:mlbb" }]] },
  });
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`;
}

function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a));
  const right = new TextEncoder().encode(String(b));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
