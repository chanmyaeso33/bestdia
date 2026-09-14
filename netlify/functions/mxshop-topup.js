const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const AUTO_TOPUP_ENABLED = process.env.MXSHOP_AUTO_TOPUP_ENABLED === "true";
const MXSHOP_API_BASE = process.env.MXSHOP_API_BASE || "https://service.mxshop.in.th";
const MXSHOP_PURCHASE_URL =
  process.env.MXSHOP_PURCHASE_URL || `${MXSHOP_API_BASE}/api/v1/buy`;
const MXSHOP_MX_KEY = process.env.MXSHOP_MX_KEY || "";
const MXSHOP_PASSKEY = process.env.MXSHOP_PASSKEY || "";
const MXSHOP_UID_FORMAT = process.env.MXSHOP_UID_FORMAT || "parens";
const GAME_REQUIRES_ZONE = { mlbb: true, pubg: false };

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { ok: false, error: "Method not allowed" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
  }

  if (!ADMIN_PASSWORD) {
    return jsonResponse(500, { ok: false, error: "ADMIN_PASSWORD is not configured" });
  }

  if (String(payload.adminPassword || "") !== ADMIN_PASSWORD) {
    return jsonResponse(401, { ok: false, error: "Wrong admin password" });
  }

  const order = payload.order || {};
  try {
    const topup = await performMxshopTopup(order);
    return jsonResponse(200, {
      ok: true,
      status: topup.status || "submitted",
      skipped: Boolean(topup.skipped),
      reason: topup.reason || "",
      mxshop: topup.response || null,
      request: topup.request || null,
    });
  } catch (error) {
    return jsonResponse(error.statusCode || 502, { ok: false, error: error.message, mxshop: error.mxshop || null, request: error.request || null });
  }
};

async function tryAutoFulfillMxshopOrder(order) {
  const pkgId = String(order.pkg?.id || "");
  if (!getMappedStockReleaseId(pkgId, order)) return { status: "skipped", skipped: true, reason: "No MXShop package mapping for this package" };
  try {
    const topup = await performMxshopTopup(order);
    const now = new Date().toISOString();
    return { status: topup.status || (topup.skipped ? "skipped" : "submitted"), skipped: Boolean(topup.skipped), reason: topup.reason || "", transactionId: topup.transactionId || getSupplierTransactionId(topup.response) || "", request: topup.request || null, response: topup.response || null, completedAt: topup.status === "success" ? now : "", submittedAt: topup.status === "submitted" ? now : "" };
  } catch (error) {
    return { status: "failed", error: error.message || "MXShop purchase failed", request: error.request || null, response: error.mxshop || null, failedAt: new Date().toISOString() };
  }
}

async function performMxshopTopup(order) {
  if (!AUTO_TOPUP_ENABLED) return { skipped: true, reason: "MXSHOP_AUTO_TOPUP_ENABLED is not true" };

  if (String(order.gameKey || order.pkg?.gameKey || "") === "mlbb") {
    const account = await lookupMlbbAccount(order.userId, order.zoneId);
    if (!account.nickname || !account.region) {
      const error = new Error("MLBB nickname and region could not be verified; supplier top-up was not submitted.");
      error.statusCode = 503;
      throw error;
    }
    if (isUnsupportedMlbbRegion(account.region)) {
      const error = new Error(`Invalid order: ${account.region} server accounts are not supported by the Global supplier.`);
      error.statusCode = 422;
      throw error;
    }
  }

  const pkgId = String(order.pkg?.id || "");
  const uid = buildMxUid(order);
  const stockReleaseId = getMappedStockReleaseId(pkgId, order);
  if (!stockReleaseId) {
    const error = new Error(`No MXShop stockreleaselist_id mapped for package id ${pkgId}. Add the supplier stockreleaselist_id to MXSHOP_PACKAGE_MAP, for example {"7":"YOUR_WEEKLY_PASS_ID"}, or set mxshopStockReleaseId on the package.`);
    error.statusCode = 400;
    throw error;
  }
  if (!uid) {
    const error = new Error("Missing player user id or required zone/server id");
    error.statusCode = 400;
    throw error;
  }
  if (!MXSHOP_MX_KEY || !MXSHOP_PASSKEY) {
    const error = new Error("MXShop credentials are not configured. Set MXSHOP_MX_KEY and MXSHOP_PASSKEY.");
    error.statusCode = 500;
    throw error;
  }

  const requestBody = { stockreleaselist_id: stockReleaseId, uid };
  const response = await fetch(MXSHOP_PURCHASE_URL, {
    method: "POST",
    headers: buildMxHeaders(),
    body: JSON.stringify(requestBody),
  });
  const text = await response.text();
  const data = safeJson(text) ?? String(text || "").trim();
  const supplierSuccess = hasMxSuccessSignal(data);
  if (!supplierSuccess && (!response.ok || !data || data?.success === false || data?.ok === false || (data?.error_code !== undefined && Number(data.error_code) !== 0) || hasMxFailureSignal(data))) {
    const error = new Error(data?.msg || data?.message || data?.error || response.statusText || "MXShop purchase failed");
    error.statusCode = 502;
    error.mxshop = data || text;
    error.request = requestBody;
    throw error;
  }
  return { skipped: false, status: isMxDeliveryConfirmed(data) ? "success" : "submitted", transactionId: getSupplierTransactionId(data), response: data || text, request: requestBody };
}

function isMxDeliveryConfirmed(data) {
  if (hasMxFailureSignal(data)) return false;
  if (hasMxPendingSignal(data)) return false;
  if (hasMxSuccessSignal(data)) return true;
  const direct = [
    data?.delivery_status,
    data?.order_status,
    data?.status,
    data?.state,
    data?.result?.delivery_status,
    data?.result?.order_status,
    data?.result?.status,
    data?.data?.delivery_status,
    data?.data?.order_status,
    data?.data?.status,
  ].map((value) => String(value || "").toLowerCase());
  return direct.some((value) => ["delivered", "sent", "okay", "ok", "completed", "complete", "success", "successful", "finished", "done"].includes(value));
}

function hasMxSuccessSignal(data) {
  const values = getMxTextValues(data);
  return data?.success === true
    || data?.ok === true
    || data?.result?.success === true
    || data?.result?.ok === true
    || data?.data?.success === true
    || data?.data?.ok === true
    || values.some((value) => /\b(okay|ok|sent|success|successful|completed|complete|delivered|done|finished)\b/.test(value));
}

function hasMxFailureSignal(data) {
  const values = getMxTextValues(data).join(" ");
  return /\b(fail|failed|error|invalid|insufficient|not enough|not_found|not found|cancel|cancelled)\b/.test(values);
}

function hasMxPendingSignal(data) {
  const values = getMxTextValues(data).join(" ");
  return /\b(mx\s*not\s*sent|not\s*sent|not\s*send|pending|processing|queued|waiting)\b/.test(values);
}

function getMxTextValues(data) {
  if (data === undefined || data === null) return [];
  if (typeof data !== "object") return [String(data).trim().toLowerCase()].filter(Boolean);
  return [
    data?.msg,
    data?.message,
    data?.error,
    data?.description,
    data?.status,
    data?.state,
    data?.delivery_status,
    data?.order_status,
    data?.result?.msg,
    data?.result?.message,
    data?.result?.description,
    data?.result?.status,
    data?.result?.state,
    data?.result?.delivery_status,
    data?.result?.order_status,
    data?.data?.msg,
    data?.data?.message,
    data?.data?.description,
    data?.data?.status,
    data?.data?.state,
    data?.data?.delivery_status,
    data?.data?.order_status,
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
}

function getSupplierTransactionId(data) {
  const candidates = [
    data?.transactionId, data?.transaction_id, data?.txid, data?.tx_id, data?.orderId, data?.order_id, data?.ref, data?.reference,
    data?.result?.transactionId, data?.result?.transaction_id, data?.result?.txid, data?.result?.orderId, data?.result?.order_id, data?.result?.ref,
    data?.data?.transactionId, data?.data?.transaction_id, data?.data?.txid, data?.data?.orderId, data?.data?.order_id, data?.data?.ref,
  ];
  return String(candidates.find((value) => value !== undefined && value !== null && String(value).trim()) || "").trim().slice(0, 120);
}

function buildMxHeaders() {
  const headers = { "Content-Type": "application/json" };
  if (MXSHOP_MX_KEY) headers["mx-key"] = MXSHOP_MX_KEY;
  if (MXSHOP_PASSKEY) headers.passkey = MXSHOP_PASSKEY;
  return headers;
}

function buildMxUid(order) {
  const userId = String(order.userId || "").trim();
  const zoneId = String(order.zoneId || "").trim();
  const gameKey = String(order.gameKey || order.pkg?.gameKey || "").trim();
  if (!userId) return "";
  if (!GAME_REQUIRES_ZONE[gameKey] && !zoneId) return userId;
  if (!zoneId) return "";
  const format = process.env[`MXSHOP_UID_FORMAT_${gameKey.toUpperCase()}`] || MXSHOP_UID_FORMAT;
  if (format === "space") return `${userId} ${zoneId}`;
  if (format === "slash") return `${userId}/${zoneId}`;
  return `${userId}(${zoneId})`;
}

function getMappedStockReleaseId(pkgId, order = {}) {
  if (String(pkgId).startsWith("hok-") || order.gameKey === "hok") {
    const known = ["hok-80","hok-240","hok-400","hok-560","hok-2400-108","hok-4000-180","hok-honor-point-pack","hok-premium-purchase-rebate-pack","hok-standard-purchase-rebate-pack","hok-weekly-pass","hok-weekly-pass-plus"];
    const defaults = {"hok-80":"16802454","hok-240":"16802455","hok-400":"16802456","hok-560":"16802457","hok-2400-108":"16802458","hok-4000-180":"16802459","hok-honor-point-pack":"16802462","hok-premium-purchase-rebate-pack":"16802463","hok-standard-purchase-rebate-pack":"16802464","hok-weekly-pass":"16802465","hok-weekly-pass-plus":"16802466"};
    try {
      const overrides = JSON.parse(process.env.MXSHOP_HOK_PACKAGE_MAP || "{}");
      const value = Object.hasOwn(overrides, pkgId) ? overrides[pkgId] : defaults[pkgId];
      return known.includes(pkgId) && /^[1-9]\d*$/.test(process.env.MXSHOP_HOK_STOCK_IDX || "1712") && ["string", "number"].includes(typeof value) && /^[1-9]\d*$/.test(String(value)) ? String(value) : "";
    } catch { return ""; }
  }
  const raw = process.env.MXSHOP_PACKAGE_MAP || "{}";
  const defaultMap = {
    1: "169991",
    2: "169992",
    3: "169993",
    4: "169994",
    5: "16800984",
    6: "16800985",
    7: "169995",
    8: "169998",
    9: "169999",
    10: "169996",
    11: "170014",
    12: "170015",
    13: "170016",
    14: "170017",
    15: "170018",
    16: "170019",
    17: "170020",
    18: "170021",
    19: "170022",
    20: "170023",
    21: "170024",
    22: "170025",
    23: "170026",
    24: "170027",
    "pubg-60": "431",
    "pubg-120": "452",
    "pubg-180": "544",
    "pubg-325": "432",
    "pubg-385": "456",
    "pubg-660": "433",
    "pubg-720": "474",
    "pubg-985": "458",
    "pubg-1320": "460",
    "pubg-1800": "434",
    "pubg-2125": "660",
    "pubg-2460": "468",
    "pubg-3850": "435",
    "pubg-8100": "436",
    "pubg-16200": "466",
    "pubg-24300": "470",
    "pubg-prime-1-month": "190504",
    "pubg-firearm-materials-pack": "190506",
    "pubg-prime-plus-1-month": "190505",
  };
  try {
    const map = { ...defaultMap, ...JSON.parse(raw) };
    const mapped = String(map[pkgId] || "").trim();
    if (mapped) return mapped;
  } catch {
    const mapped = String(defaultMap[pkgId] || "").trim();
    if (mapped) return mapped;
  }
  const direct = order?.pkg?.mxshopStockReleaseId || order?.pkg?.stockReleaseId || order?.pkg?.stockreleaselist_id;
  return direct ? String(direct).trim() : "";
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function lookupMlbbAccount(userId, zoneId) {
  try {
    const response = await fetch("https://gopay.co.id/games/v1/order/user-account", {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "BestDia/1.0" },
      body: JSON.stringify({ code: "MOBILE_LEGENDS", data: { userId: String(userId || ""), zoneId: String(zoneId || "") } }),
    });
    const data = await response.json();
    const account = data?.data || {};
    return { nickname: String(account.username || account.nickname || "").trim(), region: normalizeMlbbRegion(account.countryOrigin || account.region || account.country || "") };
  } catch {
    return { nickname: "", region: "" };
  }
}

function normalizeMlbbRegion(value) {
  const raw = String(value || "").trim();
  const names = { jp: "Japan", ph: "Philippines", id: "Indonesia", idn: "Indonesia", my: "Malaysia", mys: "Malaysia", ru: "Russia", rus: "Russia", sg: "Singapore", sgp: "Singapore", global: "Global" };
  return names[raw.toLowerCase()] || raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isUnsupportedMlbbRegion(region) {
  return /^(japan|philippines|indonesia|malaysia|russia|singapore)$/i.test(String(region || "").trim());
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
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

exports.tryAutoFulfillMxshopOrder = tryAutoFulfillMxshopOrder;
exports.getMappedStockReleaseId = getMappedStockReleaseId;
exports.isMxDeliveryConfirmed = isMxDeliveryConfirmed;
exports.getSupplierTransactionId = getSupplierTransactionId;
