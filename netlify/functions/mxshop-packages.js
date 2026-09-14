const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const MXSHOP_API_BASE = process.env.MXSHOP_API_BASE || "https://service.mxshop.in.th";
const MXSHOP_MX_KEY = process.env.MXSHOP_MX_KEY || "";
const MXSHOP_PASSKEY = process.env.MXSHOP_PASSKEY || "";

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { ok: false, error: "Invalid JSON body" });
  }

  if (!ADMIN_PASSWORD) return jsonResponse(500, { ok: false, error: "ADMIN_PASSWORD is not configured" });
  if (String(payload.adminPassword || "") !== ADMIN_PASSWORD) return jsonResponse(401, { ok: false, error: "Wrong admin password" });
  if (!MXSHOP_MX_KEY || !MXSHOP_PASSKEY) return jsonResponse(500, { ok: false, error: "MXSHOP_MX_KEY and MXSHOP_PASSKEY are required" });

  const stockIds = parseStockIds(payload);
  const type = payload.type || 4;
  const results = [];

  for (const stockIDX of stockIds) {
    const releases = await mxPost("/api/v1/get_stockreleaselist", { StockIDX: stockIDX, type });
    const list = Array.isArray(releases.result) ? releases.result : [];
    results.push({
      stockIDX,
      ok: Boolean(releases.success ?? releases.ok),
      error: releases.msg || releases.message || releases.error || "",
      count: list.length,
      packages: list.map((item) => ({
        stockreleaselist_id: item.stockreleaselist_id,
        product_stockname: item.product_stockname,
        price: item.price,
        not_available: item.not_available,
      })),
    });
  }

  return jsonResponse(200, { ok: results.every((item) => item.ok), type, stockIds, results });
};

function parseStockIds(payload) {
  const raw = payload.stockIds ?? payload.StockIDXs ?? payload.StockIDX ?? process.env.MXSHOP_STOCK_IDXS ?? process.env.MXSHOP_STOCK_IDX ?? "17";
  const values = Array.isArray(raw) ? raw : String(raw).split(",");
  const stockIds = values.map((value) => String(value || "").trim()).filter(Boolean);
  return stockIds.length ? [...new Set(stockIds)] : ["17"];
}

async function mxPost(path, body = {}) {
  try {
    const response = await fetch(`${MXSHOP_API_BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "mx-key": MXSHOP_MX_KEY,
        passkey: MXSHOP_PASSKEY,
      },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const data = safeJson(text);
    return { httpStatus: response.status, ok: response.ok, ...(data || { raw: text }) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
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
