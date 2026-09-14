const crypto = require("crypto");

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { ...corsHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function readPayload(event) {
  try {
    return JSON.parse(event.body || "{}");
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireAdmin(payload) {
  if (!process.env.ADMIN_PASSWORD) return jsonResponse(500, { ok: false, error: "ADMIN_PASSWORD is not configured" });
  if (!safeEqual(payload.adminPassword || "", process.env.ADMIN_PASSWORD)) {
    return jsonResponse(401, { ok: false, error: "Wrong admin password" });
  }
  return null;
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
  const header = base64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = base64url(Buffer.from(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })));
  const input = `${header}.${claim}`;
  const signature = crypto.sign("RSA-SHA256", Buffer.from(input), serviceAccount.private_key);
  const assertion = `${input}.${base64url(signature)}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "Could not get Firebase access token");
  return data.access_token;
}

async function firestoreClient() {
  const serviceAccount = parseServiceAccount();
  if (!serviceAccount) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured");
  return { projectId: serviceAccount.project_id, token: await getAccessToken(serviceAccount) };
}

async function listOrders(firestore) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firestore.projectId}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${firestore.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "orders" }],
        orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
        limit: 250,
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Could not list Firestore orders");
  return (Array.isArray(data) ? data : []).filter((item) => item.document).map((item) => decodeDocument(item.document));
}

async function findOrderById(firestore, orderId) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firestore.projectId}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${firestore.token}`, "Content-Type": "application/json" },
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
  return hit?.document ? decodeDocument(hit.document) : null;
}

async function getOrderByDocId(firestore, docId) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firestore.projectId}/databases/(default)/documents/orders/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${firestore.token}` },
  });
  if (response.status === 404) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "Could not get Firestore order");
  return decodeDocument(data).data;
}

async function updateOrderDoc(firestore, docId, updates) {
  const fields = {};
  for (const [key, value] of Object.entries(updates)) fields[key] = encodeFirestoreValue(value);
  const mask = Object.keys(fields).map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join("&");
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firestore.projectId}/databases/(default)/documents/orders/${encodeURIComponent(docId)}?${mask}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${firestore.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "Could not update Firestore order");
  return decodeDocument(data).data;
}

function decodeDocument(document) {
  const docId = String(document.name || "").split("/").pop();
  const data = {};
  for (const [key, value] of Object.entries(document.fields || {})) data[key] = decodeFirestoreValue(value);
  return { docId, data };
}

function decodeFirestoreValue(value) {
  if (!value || typeof value !== "object") return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return Number(value.doubleValue);
  if ("booleanValue" in value) return Boolean(value.booleanValue);
  if ("timestampValue" in value) return value.timestampValue;
  if ("nullValue" in value) return null;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeFirestoreValue);
  if ("mapValue" in value) {
    const result = {};
    for (const [key, nested] of Object.entries(value.mapValue.fields || {})) result[key] = decodeFirestoreValue(nested);
    return result;
  }
  return null;
}

function encodeFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encodeFirestoreValue) } };
  if (typeof value === "object") {
    const fields = {};
    for (const [key, nested] of Object.entries(value)) fields[key] = encodeFirestoreValue(nested);
    return { mapValue: { fields } };
  }
  const text = String(value);
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? { timestampValue: text } : { stringValue: text };
}

function publicOrder(order) {
  return {
    id: order.id,
    gameKey: order.gameKey,
    gameName: order.gameName,
    userId: order.userId,
    zoneId: order.zoneId,
    ign: order.ign,
    pkg: order.pkg,
    payment: order.payment,
    paymentStatus: order.paymentStatus,
    status: order.status,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    timeline: order.timeline || [],
  };
}

function adminOrder(order) {
  return { docId: order.docId, ...order.data };
}

function publicTickerItem(order) {
  const orderId = normalizeOrderId(order.id);
  const pkg = order.pkg || {};
  const packageName = pkg.firstBonus
    ? `${fmtNumber(pkg.baseDiamonds)}+${fmtNumber(pkg.firstBonus)} Diamonds`
    : pkg.title || (pkg.diamonds ? `${fmtNumber(pkg.diamonds)} Diamonds` : String(pkg.name || "Top-up package"));
  return `${orderId} - ${packageName} - ပြီးဆုံး`;
}

function fmtNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function normalizeOrderId(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

module.exports = {
  adminOrder,
  corsHeaders,
  firestoreClient,
  getOrderByDocId,
  jsonResponse,
  listOrders,
  normalizeOrderId,
  publicOrder,
  publicTickerItem,
  readPayload,
  requireAdmin,
  updateOrderDoc,
  findOrderById,
};
