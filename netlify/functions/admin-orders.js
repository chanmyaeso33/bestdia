const { adminOrder, corsHeaders, firestoreClient, jsonResponse, listOrders, readPayload, requireAdmin, updateOrderDoc } = require("./lib/firestore-admin");
const { tryAutoFulfillMxshopOrder } = require("./mxshop-topup");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  try {
    const payload = readPayload(event);
    const auth = requireAdmin(payload);
    if (auth) return auth;
    const firestore = await firestoreClient();
    const orders = await listOrders(firestore);
    const activeOrders = orders.filter((order) => !order.data.archived);
    const repairedOrders = await Promise.all(activeOrders.map(async (order) => {
      const data = order.data || {};
      const isBestDiaBalance = isBestDiaBalanceOrder(data);
      const mxStatus = data.mxshopTopup?.status || "";
      if (isBestDiaBalance && mxStatus === "success" && !isMxDeliveryConfirmed(data.mxshopTopup?.response)) {
        const now = new Date().toISOString();
        const timeline = Array.isArray(data.timeline) ? [...data.timeline] : [];
        if (data.status === "completed") timeline.push({ status: "processing", time: Date.now() });
        const updatedTopup = { ...data.mxshopTopup, status: "submitted", completedAt: "", submittedAt: data.mxshopTopup?.submittedAt || data.mxshopTopup?.completedAt || data.updatedAt || data.createdAt || now };
        const updated = await updateOrderDoc(firestore, order.docId, {
          status: "processing",
          completedAt: "",
          mxshopTopup: updatedTopup,
          updatedAt: now,
          timeline,
        });
        return { docId: order.docId, data: updated };
      }
      if (!isBestDiaBalance || data.status === "cancelled" || mxStatus === "success" || mxStatus === "submitted" || mxStatus === "failed" || mxStatus === "skipped") return order;
      const now = new Date().toISOString();
      const autoTopup = await tryAutoFulfillMxshopOrder(data);
      const timeline = Array.isArray(data.timeline) ? [...data.timeline] : [];
      const updates = {
        status: autoTopup.status === "success" ? "completed" : "processing",
        mxshopTopup: autoTopup,
        updatedAt: now,
        timeline,
      };
      if (autoTopup.status === "success") {
        updates.completedAt = data.completedAt || autoTopup.completedAt || now;
        if (data.status !== "completed") timeline.push({ status: "completed", time: Date.now() });
      } else if (data.status !== "processing") {
        timeline.push({ status: "processing", time: Date.now() });
      }
      const updated = await updateOrderDoc(firestore, order.docId, updates);
      return { docId: order.docId, data: updated };
    }));
    return jsonResponse(200, { ok: true, orders: repairedOrders.map(adminOrder) });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, { ok: false, error: error.message || "Admin orders failed" });
  }
};

function isMxDeliveryConfirmed(data) {
  if (hasMxPendingSignal(data)) return false;
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

function isBestDiaBalanceOrder(order) {
  return order?.payKey === "balance"
    || order?.payment === "BestDia Balance"
    || order?.slip?.receivedBy === "balance"
    || (Boolean(order?.accountId) && order?.paymentStatus === "verified" && !order?.slip?.url);
}

function hasMxPendingSignal(data) {
  const values = [
    data?.msg,
    data?.message,
    data?.error,
    data?.description,
    data?.result?.msg,
    data?.result?.message,
    data?.result?.description,
    data?.data?.msg,
    data?.data?.message,
    data?.data?.description,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return /\b(mx\s*not\s*sent|not\s*sent|not\s*send|pending|processing|queued|waiting)\b/.test(values);
}
