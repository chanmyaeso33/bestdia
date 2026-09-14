const { corsHeaders, findOrderById, firestoreClient, jsonResponse, normalizeOrderId, publicOrder, readPayload } = require("./lib/firestore-admin");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  try {
    const payload = readPayload(event);
    const orderId = normalizeOrderId(payload.orderId || payload.id);
    if (!orderId) return jsonResponse(400, { ok: false, error: "Missing Order ID" });
    const firestore = await firestoreClient();
    const found = await findOrderById(firestore, orderId);
    if (!found) return jsonResponse(404, { ok: false, error: "Order not found" });
    return jsonResponse(200, { ok: true, order: publicOrder(found.data) });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, { ok: false, error: error.message || "Order status failed" });
  }
};
