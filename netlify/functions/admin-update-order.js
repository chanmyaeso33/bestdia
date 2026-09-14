const { adminOrder, corsHeaders, firestoreClient, getOrderByDocId, jsonResponse, readPayload, requireAdmin, updateOrderDoc } = require("./lib/firestore-admin");
const { getMappedStockReleaseId, getSupplierTransactionId, isMxDeliveryConfirmed, tryAutoFulfillMxshopOrder } = require("./mxshop-topup");

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: corsHeaders(), body: "" };
  if (event.httpMethod !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  try {
    const payload = readPayload(event);
    const auth = requireAdmin(payload);
    if (auth) return auth;
    const docId = String(payload.docId || "").trim();
    if (!docId || /[/?#]/.test(docId)) return jsonResponse(400, { ok: false, error: "Invalid order document ID" });
    const firestore = await firestoreClient();
    const current = await getOrderByDocId(firestore, docId);
    if (!current) return jsonResponse(404, { ok: false, error: "Order not found" });

    const updates = { updatedAt: new Date().toISOString() };
    if (payload.status) {
      const status = String(payload.status);
      if (!["pending", "processing", "completed", "failed", "cancelled"].includes(status)) return jsonResponse(400, { ok: false, error: "Invalid status" });
      updates.status = status;
      updates.timeline = Array.isArray(current.timeline) ? [...current.timeline] : [];
      updates.timeline.push({ status, time: Date.now() });
    }
    if (payload.mxshopTopup && typeof payload.mxshopTopup === "object") {
      updates.mxshopTopup = payload.mxshopTopup;
      if (payload.mxshopTopup.status === "success") {
        updates.timeline = Array.isArray(current.timeline) ? [...current.timeline] : [];
        if (isMxDeliveryConfirmed(payload.mxshopTopup.response)) {
          if (current.status !== "completed") {
            updates.status = "completed";
            updates.completedAt = new Date().toISOString();
            updates.supplierTransactionId = getSupplierTransactionId(payload.mxshopTopup.response) || payload.mxshopTopup.transactionId || "";
            updates.timeline.push({ status: "completed", time: Date.now() });
          }
        } else {
          updates.mxshopTopup = { ...payload.mxshopTopup, status: "submitted", completedAt: "", submittedAt: payload.mxshopTopup.submittedAt || payload.mxshopTopup.completedAt || current.updatedAt || current.createdAt || new Date().toISOString() };
          if (current.status === "completed") {
            updates.status = "processing";
            updates.completedAt = "";
            updates.timeline.push({ status: "processing", time: Date.now() });
          }
        }
      } else if (payload.mxshopTopup.status === "failed") {
        updates.status = "failed";
        updates.failedAt = payload.mxshopTopup.failedAt || new Date().toISOString();
        updates.failedReason = payload.mxshopTopup.error || payload.mxshopTopup.reason || "Supplier top-up failed";
        updates.timeline = Array.isArray(current.timeline) ? [...current.timeline] : [];
        updates.timeline.push({ status: "failed", time: Date.now() });
      }
    }
    if (updates.status === "processing" && !updates.mxshopTopup && !current.mxshopTopup) {
      const candidateOrder = { ...current, ...updates };
      if (getMappedStockReleaseId(String(candidateOrder.pkg?.id || ""), candidateOrder)) {
        const autoTopup = await tryAutoFulfillMxshopOrder(candidateOrder);
        updates.mxshopTopup = autoTopup;
        if (autoTopup.status === "success") {
          updates.status = "completed";
          updates.completedAt = autoTopup.completedAt || new Date().toISOString();
          updates.supplierTransactionId = autoTopup.transactionId || "";
          updates.timeline.push({ status: "completed", time: Date.now() });
        } else if (autoTopup.status === "failed") {
          updates.status = "failed";
          updates.failedAt = autoTopup.failedAt || new Date().toISOString();
          updates.failedReason = autoTopup.error || autoTopup.reason || "Supplier top-up failed";
          updates.timeline.push({ status: "failed", time: Date.now() });
        }
      }
    }
    if (payload.archived === true) {
      updates.archived = true;
      updates.archivedAt = new Date().toISOString();
    }
    if (Object.keys(updates).length === 1) return jsonResponse(400, { ok: false, error: "No order update was provided" });
    const updated = await updateOrderDoc(firestore, docId, updates);
    return jsonResponse(200, { ok: true, order: adminOrder({ docId, data: updated }) });
  } catch (error) {
    return jsonResponse(error.statusCode || 500, { ok: false, error: error.message || "Admin update failed" });
  }
};
