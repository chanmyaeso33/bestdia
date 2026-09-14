const { corsHeaders, firestoreClient, jsonResponse, listOrders, publicTickerItem } = require("./lib/firestore-admin");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "GET" && event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  try {
    const firestore = await firestoreClient();
    const orders = await listOrders(firestore);
    const items = orders
      .filter((order) => !order.data.archived && order.data.pkg && order.data.status === "completed" && /^BD\d{6}$/.test(String(order.data.id || "").trim().toUpperCase()))
      .slice(0, 10)
      .map((order) => publicTickerItem(order.data));
    return jsonResponse(200, { ok: true, items });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error.message || "Public ticker failed" });
  }
};
