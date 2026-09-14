const { corsHeaders, firestoreClient, jsonResponse, listOrders, readPayload, requireAdmin, updateOrderDoc } = require("./lib/firestore-admin");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  try {
    const payload = readPayload(event);
    const auth = requireAdmin(payload);
    if (auth) return auth;
    const firestore = await firestoreClient();
    const orders = await listOrders(firestore);
    const active = orders.filter((order) => !order.data.archived);
    await Promise.all(active.map((order) => updateOrderDoc(firestore, order.docId, {
      archived: true,
      archivedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })));
    return jsonResponse(200, { ok: true, archived: active.length });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, { ok: false, error: error.message || "Admin archive failed" });
  }
};
