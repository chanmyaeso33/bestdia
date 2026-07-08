const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-BestDia-Secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function onRequest(context) {
  const { request, env, params } = context;
  if (request.method === "OPTIONS") return new Response("", { status: 204, headers: JSON_HEADERS });

  const routePath = Array.isArray(params.path) ? params.path.join("/") : String(params.path || "");
  const route = routePath.replace(/^\/+|\/+$/g, "");

  try {
    if (route === "admin-auth") return adminAuth(request, env);
    if (route === "admin-archive-orders") return adminArchiveOrders(request, env);
    if (route === "admin-balance-topups") return adminBalanceTopups(request, env);
    if (route === "admin-confirm-balance-topup") return adminConfirmBalanceTopup(request, env);
    if (route === "admin-orders") return adminOrders(request, env);
    if (route === "admin-update-balance-topup") return adminUpdateBalanceTopup(request, env);
    if (route === "admin-update-order") return adminUpdateOrder(request, env);
    if (route === "account-balance") return accountBalance(request, env);
    if (route === "create-balance-topup") return createBalanceTopup(request, env);
    if (route === "create-order") return createOrder(request, env);
    if (route === "mlbb-lookup") return mlbbLookup(request, env);
    if (route === "mxshop-diagnostic") return mxshopDiagnostic(request, env);
    if (route === "mxshop-packages") return mxshopPackages(request, env);
    if (route === "mxshop-topup") return mxshopTopup(request, env);
    if (route === "order-status") return orderStatus(request, env);
    if (route === "payment-webhook") return paymentWebhook(request, env);
    if (route === "public-ticker") return publicTicker(request, env);
    if (route === "telegram-diagnostic") return telegramDiagnostic(request, env);
    if (route === "telegram-notify") return telegramNotify(request, env);
    return jsonResponse(404, { ok: false, error: "API route not found" });
  } catch (error) {
    if (error.status) return jsonResponse(error.status, { ok: false, error: error.message });
    return jsonResponse(500, { ok: false, error: error.message || "Unexpected API error" });
  }
}

async function adminAuth(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  const payload = await readJson(request);
  const auth = requireAdmin(payload, env);
  if (auth) return auth;
  return jsonResponse(200, { ok: true });
}

const THB_TO_KS = 133.5;
const BALANCE_THB_TO_KS = 1335;
const PAYMENTS = {
  kbz: { key: "kbz", name: "KBZPay" },
  wave: { key: "wave", name: "Wave Money" },
  truemoney: { key: "truemoney", name: "TrueMoney" },
  balance: { key: "balance", name: "BestDia Balance" },
};
const priceMarginByThb = (thb) => thb < 150 ? 0.05 : (thb < 500 ? 0.03 : 0.02);
const roundKsToLast2 = (ks) => Math.round(ks / 100) * 100;
const PRICE_OVERRIDES_KS = { 7: 6600, 10: 35500, 21: 125900, 22: 209000, "pubg-325": 20500, "pubg-660": 40500, "pubg-1800": 99000, "pubg-8100": 385000, "pubg-prime-1-month": 4500, "pubg-prime-3-month": 12900, "pubg-mythic-emblem-pack": 20500, "pubg-prime-plus-3-month": 120900 };
const trustedPriceKs = (thb) => roundKsToLast2(Number(thb || 0) * THB_TO_KS * (1 + priceMarginByThb(Number(thb || 0))));
const withPrice = (pkg, product) => ({
  ...pkg,
  gameKey: product.key,
  gameName: product.name,
  unit: product.unit,
  price: PRICE_OVERRIDES_KS[pkg.id] ?? trustedPriceKs(pkg.supplierPriceThb),
  exchangeRateThbToKs: THB_TO_KS,
});
const PRODUCTS = (() => {
  const mlbb = { key: "mlbb", name: "Mobile Legends", unit: "Diamonds", requiresZone: true };
  const pubg = { key: "pubg", name: "PUBG Mobile", unit: "UC", requiresZone: false };
  mlbb.packages = [
    { id: 1, title: "50+5 Diamonds", name: "Special Bonus", diamonds: 55, baseDiamonds: 50, regularBonus: 5, firstBonus: 50, supplierPriceThb: 26.13, mxshopStockReleaseId: "169991" },
    { id: 2, title: "150+15 Diamonds", name: "Special Bonus", diamonds: 165, baseDiamonds: 150, regularBonus: 15, firstBonus: 150, supplierPriceThb: 78.32, mxshopStockReleaseId: "169992" },
    { id: 3, title: "250+25 Diamonds", name: "Special Bonus", diamonds: 275, baseDiamonds: 250, regularBonus: 25, firstBonus: 250, supplierPriceThb: 125.63, mxshopStockReleaseId: "169993" },
    { id: 4, title: "500+65 Diamonds", name: "Special Bonus", diamonds: 565, baseDiamonds: 500, regularBonus: 65, firstBonus: 500, supplierPriceThb: 257.95, mxshopStockReleaseId: "169994" },
    { id: 5, title: "Weekly Elite Bundle", name: "Bundle", supplierPriceThb: 25.74, mxshopStockReleaseId: "16800984" },
    { id: 6, title: "Monthly Epic Bundle", name: "Bundle", supplierPriceThb: 127.92, mxshopStockReleaseId: "16800985" },
    { id: 7, title: "Weekly Diamond Pass", name: "Pass", supplierPriceThb: 49.40, mxshopStockReleaseId: "169995" },
    { id: 8, title: "Weekly Diamond Pass x2", name: "Pass", supplierPriceThb: 98.80, mxshopStockReleaseId: "169998" },
    { id: 9, title: "Weekly Diamond Pass x3", name: "Pass", supplierPriceThb: 148.20, mxshopStockReleaseId: "169999" },
    { id: 10, title: "Twilight Pass", name: "Pass", supplierPriceThb: 261.63, mxshopStockReleaseId: "169996" },
    { id: 11, title: "86 Diamonds", name: "78 + 8 Bonus", diamonds: 86, supplierPriceThb: 39.38, mxshopStockReleaseId: "170014" },
    { id: 12, title: "172 Diamonds", name: "156 + 16 Bonus", diamonds: 172, supplierPriceThb: 78.08, mxshopStockReleaseId: "170015" },
    { id: 13, title: "257 Diamonds", name: "234 + 23 Bonus", diamonds: 257, supplierPriceThb: 113.09, mxshopStockReleaseId: "170016" },
    { id: 14, title: "343 Diamonds", name: "312 + 31 Bonus", diamonds: 343, supplierPriceThb: 152.45, mxshopStockReleaseId: "170017" },
    { id: 15, title: "429 Diamonds", name: "390 + 39 Bonus", diamonds: 429, supplierPriceThb: 191.17, mxshopStockReleaseId: "170018" },
    { id: 16, title: "600 Diamonds", name: "546 + 54 Bonus", diamonds: 600, supplierPriceThb: 265.54, mxshopStockReleaseId: "170019" },
    { id: 17, title: "706 Diamonds", name: "625 + 81 Bonus", diamonds: 706, supplierPriceThb: 307.2, mxshopStockReleaseId: "170020" },
    { id: 18, title: "792 Diamonds", name: "703 + 89 Bonus", diamonds: 792, supplierPriceThb: 346.56, mxshopStockReleaseId: "170021" },
    { id: 19, title: "1049 Diamonds", name: "937 + 112 Bonus", diamonds: 1049, supplierPriceThb: 459.65, mxshopStockReleaseId: "170022" },
    { id: 20, title: "1135 Diamonds", name: "1015 + 120 Bonus", diamonds: 1135, supplierPriceThb: 498.37, mxshopStockReleaseId: "170023" },
    { id: 21, title: "2195 Diamonds", name: "1860 + 335 Bonus", diamonds: 2195, supplierPriceThb: 929.92, mxshopStockReleaseId: "170024" },
    { id: 22, title: "3688 Diamonds", name: "3099 + 589 Bonus", diamonds: 3688, supplierPriceThb: 1541.66, mxshopStockReleaseId: "170025" },
    { id: 23, title: "5532 Diamonds", name: "4649 + 883 Bonus", diamonds: 5532, supplierPriceThb: 2322.15, mxshopStockReleaseId: "170026" },
    { id: 24, title: "9288 Diamonds", name: "7740 + 1548 Bonus", diamonds: 9288, supplierPriceThb: 3844.36, mxshopStockReleaseId: "170027" },
  ].map((pkg) => withPrice(pkg, mlbb));
  const pubgMxIds = { "60": "431", "120": "452", "180": "544", "325": "432", "385": "456", "660": "433", "720": "474", "985": "458", "1320": "460", "1800": "434", "2125": "660", "2460": "468", "3850": "435", "8100": "436", "16200": "466", "24300": "470" };
  pubg.packages = [
    ["60", 32.10], ["120", 64.20], ["180", 96.30], ["325", 148.50], ["385", 180.60], ["660", 295.01], ["720", 325.01], ["985", 443.50], ["1045", 475.50], ["1320", 589.01], ["1800", 730.01], ["1920", 789.20], ["2125", 874.50], ["2460", 1020.01], ["3850", 1435.01], ["8100", 2835.01], ["16200", 5670.02], ["24300", 8505.03], ["72900", 25515.09],
  ].map(([uc, thb]) => withPrice({ id: `pubg-${uc}`, title: `${uc} UC`, name: "", uc: Number(uc), supplierPriceThb: thb, mxshopStockReleaseId: pubgMxIds[uc] || "" }, pubg)).concat([
    { id: "pubg-first-purchase-pack", title: "First Purchase Pack", name: "Special Pack", supplierPriceThb: 32.10 },
    { id: "pubg-prime-1-month", title: "Prime 1 Month", name: "Subscription", supplierPriceThb: 33.01, mxshopStockReleaseId: "190504" },
    { id: "pubg-firearm-materials-pack", title: "Upgradable Firearm Materials Pack", name: "Materials Pack", supplierPriceThb: 89.10, mxshopStockReleaseId: "190506" },
    { id: "pubg-prime-3-month", title: "Prime 3 Month", name: "Subscription", supplierPriceThb: 95.01 },
    { id: "pubg-mythic-emblem-pack", title: "Mythic Emblem Pack", name: "Special Pack", supplierPriceThb: 148.50 },
    { id: "pubg-prime-plus-1-month", title: "Prime Plus 1 Month", name: "Subscription", supplierPriceThb: 299.01, mxshopStockReleaseId: "190505" },
    { id: "pubg-prime-plus-3-month", title: "Prime Plus 3 Month", name: "Subscription", supplierPriceThb: 890.01 },
  ].map((pkg) => withPrice(pkg, pubg)));
  return { mlbb, pubg };
})();

async function createBalanceTopup(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  const accountId = normalizeAccountId(payload.accountId);
  const accountName = String(payload.accountName || "").trim().slice(0, 120);
  const amount = Math.round(Number(payload.amount || 0));
  const trustedPay = PAYMENTS[String(payload.payKey || "").trim()];
  if (!accountId) return jsonResponse(400, { ok: false, error: "Missing BestDia account ID" });
  if (!amount || amount < 1) return jsonResponse(400, { ok: false, error: "Invalid top up amount" });
  if (!trustedPay || trustedPay.key === "balance") return jsonResponse(400, { ok: false, error: "Invalid payment method" });
  const slipDataUrl = String(payload.slipDataUrl || "");
  if (!slipDataUrl.startsWith("data:image/")) return jsonResponse(400, { ok: false, error: "Payment slip image is required" });

  const now = new Date().toISOString();
  const topupId = `BT${Date.now().toString().slice(-7)}`;
  const requiredAmount = trustedPay.key === "truemoney" ? amount : amount * BALANCE_THB_TO_KS;
  const requiredCurrency = trustedPay.key === "truemoney" ? "THB" : "Ks";
  const cleanTopup = {
    id: topupId,
    accountId,
    accountName,
    amount,
    requiredAmount,
    requiredCurrency,
    payment: trustedPay.name,
    payKey: trustedPay.key,
    status: "pending",
    createdAt: now,
    updatedAt: now,
    slip: {
      name: String(payload.slipFileName || "balance-topup-slip.jpg").slice(0, 140),
      receivedBy: "telegram",
    },
    timeline: [{ status: "pending", time: Date.now() }],
  };

  const firestore = await firestoreClient(env);
  const created = await createCollectionDoc(firestore, "balance_topups", cleanTopup);
  let notification = { ok: false, skipped: true };
  try {
    await notifyTelegram(env, `<b>[Balance Top Up]</b>\nRequest: <code>${escapeHtml(topupId)}</code>\nAccount: <code>${escapeHtml(accountId)}</code>\nName: ${escapeHtml(accountName || "-")}\nAmount: ${escapeHtml(formatAmount(amount))} BD\nRequired: ${escapeHtml(formatAmount(requiredAmount))} ${escapeHtml(requiredCurrency)}\nRate: 1 BD = 1 THB\nPayment: ${escapeHtml(trustedPay.name)}\nStatus: pending`);
    notification = { ok: true };
    if (slipDataUrl.startsWith("data:image/") && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      const photo = await sendSlipPhoto(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, slipDataUrl, cleanTopup.slip.name);
      notification.photoOk = Boolean(photo.ok);
      notification.photoError = photo.ok ? "" : photo.description || photo.error || "Top up slip photo failed";
      cleanTopup.slip.telegramFileId = photo.result?.photo?.slice(-1)?.[0]?.file_id || "";
      if (cleanTopup.slip.telegramFileId) await updateCollectionDoc(firestore, "balance_topups", created.docId, { slip: cleanTopup.slip });
    }
  } catch (error) {
    notification = { ok: false, error: error.message || "Telegram notification failed" };
  }

  return jsonResponse(200, { ok: true, topupId, docId: created.docId, notification });
}

async function accountBalance(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  const accountId = normalizeAccountId(payload.accountId);
  if (!accountId) return jsonResponse(400, { ok: false, error: "Missing BestDia account ID" });
  const firestore = await firestoreClient(env);
  const account = await getAccountBalanceDoc(firestore, accountId);
  return jsonResponse(200, { ok: true, accountId, balance: Number(account?.balance || 0), history: account?.history || [] });
}

async function createOrder(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  const order = payload.order && typeof payload.order === "object" ? payload.order : {};
  const orderId = normalizeOrderId(order.id || `BD${Date.now().toString().slice(-6)}`);
  const userId = String(order.userId || "").trim().slice(0, 80);
  const contact = String(order.contact || "").trim().slice(0, 160);
  const pkg = order.pkg && typeof order.pkg === "object" ? order.pkg : null;
  const trustedProduct = PRODUCTS[String(order.gameKey || "").trim()];
  const trustedPkg = trustedProduct && pkg ? trustedProduct.packages.find((item) => String(item.id) === String(pkg.id)) : null;
  if (!orderId || !userId || !contact || !pkg) return jsonResponse(400, { ok: false, error: "Missing order information" });
  if (!trustedProduct || !trustedPkg) return jsonResponse(400, { ok: false, error: "Invalid package selection" });
  if (trustedProduct.requiresZone && !String(order.zoneId || "").trim()) return jsonResponse(400, { ok: false, error: "Missing Zone ID" });
  const trustedPay = PAYMENTS[String(order.payKey || "").trim()];
  if (!trustedPay || String(order.payment || "").trim() !== trustedPay.name) return jsonResponse(400, { ok: false, error: "Invalid payment method" });

  const now = new Date().toISOString();
  const initialStatus = trustedPay.key === "balance" ? "processing" : "pending";
  const cleanOrder = {
    id: orderId,
    gameKey: trustedProduct.key,
    gameName: trustedProduct.name,
    userId,
    zoneId: trustedProduct.requiresZone ? String(order.zoneId || "").trim().slice(0, 80) : "",
    contact,
    ign: String(order.ign || "").trim().slice(0, 120),
    accountId: String(order.accountId || "").trim().slice(0, 160),
    pkg: trustedPkg,
    payment: trustedPay.name,
    payKey: trustedPay.key,
    paymentReference: orderId,
    paymentStatus: trustedPay.key === "balance" ? "verified" : "slip_uploaded",
    slip: {
      name: String(payload.slipFileName || order.slip?.name || "payment-slip.jpg").slice(0, 140),
      receivedBy: trustedPay.key === "balance" ? "balance" : "telegram",
    },
    status: initialStatus,
    createdAt: now,
    updatedAt: now,
    completedAt: "",
    timeline: [{ status: initialStatus, time: Date.now() }],
  };

  const firestore = await firestoreClient(env);
  let balanceCharge = 0;
  let balanceAccount = null;
  let balanceAccountId = "";
  if (trustedPay.key === "balance") {
    balanceAccountId = normalizeAccountId(cleanOrder.accountId);
    if (!balanceAccountId) return jsonResponse(400, { ok: false, error: "Missing BestDia account ID" });
    balanceAccount = await getAccountBalanceDoc(firestore, balanceAccountId);
    balanceCharge = Math.ceil(Number(trustedPkg.price || 0) / THB_TO_KS);
    if (Number(balanceAccount?.balance || 0) < balanceCharge) return jsonResponse(400, { ok: false, error: "BestDia balance is not enough" });
  }
  const created = await createOrderDoc(firestore, cleanOrder);
  let autoTopup = null;
  let finalOrder = cleanOrder;
  if (trustedPay.key === "balance") {
    autoTopup = await tryAutoFulfillMxshopOrder(env, cleanOrder);
    const topupNow = new Date().toISOString();
    const timeline = Array.isArray(cleanOrder.timeline) ? [...cleanOrder.timeline] : [];
    const orderUpdates = {
      mxshopTopup: autoTopup,
      updatedAt: topupNow,
      timeline,
    };
    if (autoTopup.status === "success") {
      orderUpdates.status = "completed";
      orderUpdates.completedAt = autoTopup.completedAt || topupNow;
      orderUpdates.supplierTransactionId = autoTopup.transactionId || "";
      timeline.push({ status: "completed", time: Date.now() });
      const history = Array.isArray(balanceAccount?.history) ? [...balanceAccount.history] : [];
      history.unshift({ type: "purchase", title: `Paid ${packageText(trustedPkg)}`, amount: -balanceCharge, orderId, at: topupNow, supplierTransactionId: autoTopup.transactionId || "" });
      const accountUpdates = {
        accountId: balanceAccountId,
        balance: Number(balanceAccount?.balance || 0) - balanceCharge,
        history: history.slice(0, 40),
        updatedAt: topupNow,
      };
      if (!balanceAccount) accountUpdates.createdAt = topupNow;
      await commitOrderAndAccountUpdates(firestore, created.docId, orderUpdates, balanceAccountId, accountUpdates);
      finalOrder = { ...cleanOrder, ...orderUpdates };
    } else if (autoTopup.status === "failed") {
      orderUpdates.status = "failed";
      orderUpdates.failedAt = autoTopup.failedAt || topupNow;
      orderUpdates.failedReason = autoTopup.error || autoTopup.reason || "Supplier top-up failed";
      timeline.push({ status: "failed", time: Date.now() });
      await updateOrderDoc(firestore, created.docId, orderUpdates);
      finalOrder = { ...cleanOrder, ...orderUpdates };
    } else {
      orderUpdates.status = "processing";
      await updateOrderDoc(firestore, created.docId, orderUpdates);
      finalOrder = { ...cleanOrder, ...orderUpdates };
    }
  }

  let notification = { ok: false, skipped: true };
  try {
    await notifyTelegram(env, `<b>[New Order]</b>\nOrder ID: <code>${escapeHtml(orderId)}</code>\nGame: ${escapeHtml(cleanOrder.gameName)}\nPackage: ${escapeHtml(packageText(trustedPkg))}\nAmount: ${escapeHtml(formatAmount(trustedPkg.price))} Ks\nPlayer: ${escapeHtml(cleanOrder.zoneId ? `${userId} (Zone ${cleanOrder.zoneId})` : userId)}\nIn-game name: ${escapeHtml(cleanOrder.ign || "Not verified")}\nContact: ${escapeHtml(contact)}\nPayment: ${escapeHtml(cleanOrder.payment)}`);
    notification = { ok: true };
    const slipDataUrl = String(payload.slipDataUrl || "");
    if (slipDataUrl.startsWith("data:image/") && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      const photo = await sendSlipPhoto(env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_CHAT_ID, slipDataUrl, cleanOrder.slip.name);
      notification.photoOk = Boolean(photo.ok);
      notification.photoError = photo.ok ? "" : photo.description || photo.error || "Payment slip photo failed";
    }
  } catch (error) {
    notification = { ok: false, error: error.message || "Telegram notification failed" };
  }

  return jsonResponse(200, { ok: true, orderId, docId: created.docId, order: publicOrder(finalOrder), notification, autoTopup });
}

async function orderStatus(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  const orderId = normalizeOrderId(payload.orderId || payload.id);
  if (!orderId) return jsonResponse(400, { ok: false, error: "Missing Order ID" });
  const firestore = await firestoreClient(env);
  const found = await findOrderById(firestore, orderId);
  if (!found) return jsonResponse(404, { ok: false, error: "Order not found" });
  return jsonResponse(200, { ok: true, order: publicOrder(found.data) });
}

async function publicTicker(request, env) {
  if (request.method !== "GET" && request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const firestore = await firestoreClient(env);
  const orders = await listOrders(firestore);
  const items = orders
    .filter((order) => !order.data.archived && order.data.pkg && order.data.status === "completed")
    .slice(0, 10)
    .map((order, index) => publicTickerItem(order.data, index));
  return jsonResponse(200, { ok: true, items });
}

async function adminOrders(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  const auth = requireAdmin(payload, env);
  if (auth) return auth;
  const firestore = await firestoreClient(env);
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
    if (!isBestDiaBalance || data.status === "cancelled" || data.status === "failed" || mxStatus === "success" || mxStatus === "submitted" || mxStatus === "failed" || mxStatus === "skipped") return order;
    const now = new Date().toISOString();
    const autoTopup = await tryAutoFulfillMxshopOrder(env, data);
    const timeline = Array.isArray(data.timeline) ? [...data.timeline] : [];
    const updates = {
      status: autoTopup.status === "success" ? "completed" : "processing",
      mxshopTopup: autoTopup,
      updatedAt: now,
      timeline,
    };
    if (autoTopup.status === "success") {
      updates.completedAt = data.completedAt || autoTopup.completedAt || now;
      updates.supplierTransactionId = autoTopup.transactionId || data.supplierTransactionId || "";
      if (data.status !== "completed") timeline.push({ status: "completed", time: Date.now() });
    } else if (autoTopup.status === "failed") {
      updates.status = "failed";
      updates.failedAt = autoTopup.failedAt || now;
      updates.failedReason = autoTopup.error || autoTopup.reason || "Supplier top-up failed";
      timeline.push({ status: "failed", time: Date.now() });
    } else if (data.status !== "processing") {
      timeline.push({ status: "processing", time: Date.now() });
    }
    const updated = await updateOrderDoc(firestore, order.docId, updates);
    return { docId: order.docId, data: updated };
  }));
  return jsonResponse(200, { ok: true, orders: repairedOrders.map(adminOrder) });
}

async function adminUpdateOrder(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  const auth = requireAdmin(payload, env);
  if (auth) return auth;
  const docId = String(payload.docId || "").trim();
  if (!docId || /[/?#]/.test(docId)) return jsonResponse(400, { ok: false, error: "Invalid order document ID" });

  const firestore = await firestoreClient(env);
  const current = await getOrderByDocId(firestore, docId);
  if (!current) return jsonResponse(404, { ok: false, error: "Order not found" });

  const updates = { updatedAt: new Date().toISOString() };
  if (payload.status) {
    const status = String(payload.status);
    if (!["pending", "processing", "completed", "failed", "cancelled"].includes(status)) {
      return jsonResponse(400, { ok: false, error: "Invalid status" });
    }
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
    if (getMappedStockReleaseId(String(candidateOrder.pkg?.id || ""), env, candidateOrder)) {
      const autoTopup = await tryAutoFulfillMxshopOrder(env, candidateOrder);
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
}

async function adminBalanceTopups(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  const auth = requireAdmin(payload, env);
  if (auth) return auth;
  const firestore = await firestoreClient(env);
  const topups = await listCollectionDocs(firestore, "balance_topups");
  return jsonResponse(200, { ok: true, topups: topups.map((doc) => ({ docId: doc.docId, ...doc.data })) });
}

async function adminUpdateBalanceTopup(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  const auth = requireAdmin(payload, env);
  if (auth) return auth;
  const docId = String(payload.docId || "").trim();
  const status = String(payload.status || "").trim();
  if (!docId || /[/?#]/.test(docId)) return jsonResponse(400, { ok: false, error: "Invalid top up document ID" });
  if (!["pending", "confirmed", "cancelled"].includes(status)) return jsonResponse(400, { ok: false, error: "Invalid top up status" });
  const firestore = await firestoreClient(env);
  const current = await getCollectionDoc(firestore, "balance_topups", docId);
  if (!current) return jsonResponse(404, { ok: false, error: "Top up not found" });
  if (current.status === "confirmed") return jsonResponse(400, { ok: false, error: "Confirmed top up cannot be changed" });
  const timeline = Array.isArray(current.timeline) ? [...current.timeline] : [];
  timeline.push({ status, time: Date.now() });
  const updated = await updateCollectionDoc(firestore, "balance_topups", docId, { status, timeline, updatedAt: new Date().toISOString() });
  return jsonResponse(200, { ok: true, topup: { docId, ...updated } });
}

async function adminConfirmBalanceTopup(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  const auth = requireAdmin(payload, env);
  if (auth) return auth;
  const docId = String(payload.docId || "").trim();
  if (!docId || /[/?#]/.test(docId)) return jsonResponse(400, { ok: false, error: "Invalid top up document ID" });
  const firestore = await firestoreClient(env);
  const current = await getCollectionDoc(firestore, "balance_topups", docId);
  if (!current) return jsonResponse(404, { ok: false, error: "Top up not found" });
  if (current.status === "confirmed") return jsonResponse(400, { ok: false, error: "Top up already confirmed" });
  if (current.status === "cancelled") return jsonResponse(400, { ok: false, error: "Cancelled top up cannot be confirmed" });

  const amount = Math.round(Number(current.amount || 0));
  const accountId = normalizeAccountId(current.accountId);
  if (!accountId || amount <= 0) return jsonResponse(400, { ok: false, error: "Invalid top up data" });
  const account = await getAccountBalanceDoc(firestore, accountId);
  const history = Array.isArray(account?.history) ? [...account.history] : [];
  history.unshift({ type: "topup-confirmed", title: `Confirmed ${current.id}`, amount, topupId: current.id, at: new Date().toISOString() });
  const balance = Number(account?.balance || 0) + amount;
  await setAccountBalanceDoc(firestore, accountId, {
    accountId,
    balance,
    history: history.slice(0, 40),
    updatedAt: new Date().toISOString(),
  });

  const timeline = Array.isArray(current.timeline) ? [...current.timeline] : [];
  timeline.push({ status: "confirmed", time: Date.now() });
  const updated = await updateCollectionDoc(firestore, "balance_topups", docId, {
    status: "confirmed",
    confirmedAt: new Date().toISOString(),
    creditedAmount: amount,
    balanceAfter: balance,
    timeline,
    updatedAt: new Date().toISOString(),
  });
  await notifyTelegram(env, `<b>[Balance Top Up Confirmed]</b>\nRequest: <code>${escapeHtml(current.id)}</code>\nAccount: <code>${escapeHtml(accountId)}</code>\nAmount: ${escapeHtml(formatAmount(amount))} BD\nBalance after: ${escapeHtml(formatAmount(balance))} BD`);
  return jsonResponse(200, { ok: true, balance, topup: { docId, ...updated } });
}

async function adminArchiveOrders(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  const auth = requireAdmin(payload, env);
  if (auth) return auth;
  const firestore = await firestoreClient(env);
  const orders = await listOrders(firestore);
  const active = orders.filter((order) => !order.data.archived);
  await Promise.all(active.map((order) => updateOrderDoc(firestore, order.docId, {
    archived: true,
    archivedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })));
  return jsonResponse(200, { ok: true, archived: active.length });
}

async function mlbbLookup(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  const payload = await readJson(request);
  const userId = onlyDigits(payload.userId);
  const zoneId = onlyDigits(payload.zoneId);
  if (!userId || !zoneId) return jsonResponse(400, { error: "Missing User ID or Zone ID" });

  const mxshopLookupToken = env.MXSHOP_LOOKUP_TOKEN || env.MXSHOP_BEARER_TOKEN || "";
  const candidates = [
    mxshopLookupToken && {
      source: "mxshop",
      url: env.MXSHOP_LOOKUP_URL || "https://api.mxshop.in.th/api/mobilelegendschecker?uid=",
      method: "GET_UID",
      uidFormat: env.MXSHOP_LOOKUP_UID_FORMAT || env.MXSHOP_UID_FORMAT || "parens",
      headers: { Authorization: `Bearer ${mxshopLookupToken}` },
    },
    {
      source: "xpreloads",
      url: `https://xpreloads.com/api/api/mlbb?user_id=${encodeURIComponent(userId)}&server_id=${encodeURIComponent(zoneId)}`,
      method: "GET",
      headers: { "Content-Type": "application/json", "X-Custom-Token": "narbu-frontend" },
    },
    { source: "namdevel", url: "https://public-api.namdevel.rest/v1/init/username", method: "POST_FORM" },
    env.MLBB_LOOKUP_URL,
    { source: "codashop-api", url: "https://api.codashop.com/v1/init/username", method: "POST_FORM" },
    { source: "codashop-sg", url: "https://order-sg.codashop.com/v1/init/username", method: "POST_FORM" },
  ].filter(Boolean);

  let lookupError = "";
  for (const candidate of candidates) {
    const result = await tryLookup(candidate, userId, zoneId);
    if (result.nickname) return jsonResponse(200, { ok: true, nickname: result.nickname, source: result.source });
    if (result.error && !lookupError) lookupError = result.error;
  }

  return jsonResponse(502, { ok: false, error: lookupError || "Nickname lookup is unavailable. Please verify the ID manually." });
}

async function telegramNotify(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  const payload = await readJson(request);
  const text = String(payload.text || "").trim();
  if (!text) return jsonResponse(400, { error: "Missing notification text" });

  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return jsonResponse(500, {
      error: "Telegram is not configured",
      details: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Cloudflare Pages environment variables.",
    });
  }

  const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  const body = await telegramRes.json().catch(() => ({}));
  if (!telegramRes.ok || body.ok === false) {
    const isUnauthorized = telegramRes.status === 401 || body.error_code === 401;
    return jsonResponse(502, {
      error: isUnauthorized ? "Telegram bot token is invalid" : "Telegram send failed",
      details: isUnauthorized
        ? "Generate a new token in BotFather, save it as TELEGRAM_BOT_TOKEN in Cloudflare, then redeploy."
        : body.description || telegramRes.statusText,
    });
  }

  const slipDataUrl = String(payload.slipDataUrl || "");
  if (slipDataUrl.startsWith("data:image/")) {
    const sentPhoto = await sendSlipPhoto(botToken, chatId, slipDataUrl, String(payload.slipFileName || "payment-slip.jpg"));
    if (!sentPhoto.ok) {
      return jsonResponse(200, {
        ok: true,
        warning: "Order notification sent, but payment slip photo failed.",
        details: sentPhoto.description || sentPhoto.error || null,
      });
    }
  }

  return jsonResponse(200, { ok: true });
}

async function telegramDiagnostic(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { error: "Method not allowed" });
  const payload = await readJson(request);
  if (!env.ADMIN_PASSWORD) return jsonResponse(500, { error: "ADMIN_PASSWORD is not configured" });
  if (payload.adminPassword !== env.ADMIN_PASSWORD) return jsonResponse(401, { error: "Wrong admin password" });

  const botToken = env.TELEGRAM_BOT_TOKEN;
  const configuredChatId = env.TELEGRAM_CHAT_ID;
  const result = { hasBotToken: Boolean(botToken), hasChatId: Boolean(configuredChatId), configuredChatId: configuredChatId || null };

  if (!botToken) return jsonResponse(200, { ...result, ok: false, error: "Missing TELEGRAM_BOT_TOKEN in Cloudflare environment variables." });

  const me = await telegram(botToken, "getMe");
  result.bot = me.ok ? me.result : null;
  result.getMe = summarizeTelegram(me);
  if (!me.ok) return jsonResponse(200, { ...result, ok: false, error: "Bot token is not valid." });

  const updates = await telegram(botToken, "getUpdates", { limit: 20 });
  result.getUpdates = summarizeTelegram(updates);
  if (updates.ok) {
    result.recentChats = updates.result
      .map((update) => update.message || update.edited_message || update.channel_post)
      .filter(Boolean)
      .map((message) => ({
        chatId: message.chat?.id,
        type: message.chat?.type,
        name: [message.chat?.first_name, message.chat?.last_name].filter(Boolean).join(" ") || message.chat?.title || "",
        username: message.chat?.username || "",
        text: message.text || "",
        date: message.date || null,
      }));
  }

  if (!configuredChatId) return jsonResponse(200, { ...result, ok: false, error: "Missing TELEGRAM_CHAT_ID in Cloudflare environment variables." });

  const sent = await telegram(botToken, "sendMessage", {
    chat_id: configuredChatId,
    text: "BestDia Telegram test: notifications are connected.",
  });
  result.sendMessage = summarizeTelegram(sent);

  return jsonResponse(200, { ...result, ok: sent.ok, error: sent.ok ? null : sent.description || "Telegram test message failed." });
}

async function mxshopDiagnostic(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  if (!env.ADMIN_PASSWORD) return jsonResponse(500, { ok: false, error: "ADMIN_PASSWORD is not configured" });
  if (String(payload.adminPassword || "") !== env.ADMIN_PASSWORD) return jsonResponse(401, { ok: false, error: "Wrong admin password" });
  if (!env.MXSHOP_MX_KEY || !env.MXSHOP_PASSKEY) return jsonResponse(500, { ok: false, error: "MXSHOP_MX_KEY and MXSHOP_PASSKEY are required" });

  const stockIDX = payload.StockIDX || env.MXSHOP_STOCK_IDX || "17";
  const hello = await mxPost(env, "/api/v1/hello");
  const balance = await mxPost(env, "/api/v1/get_balance");
  const releases = await mxPost(env, "/api/v1/get_stockreleaselist", { StockIDX: stockIDX, type: payload.type || 4 });

  return jsonResponse(200, {
    ok: Boolean(hello.success && balance.success && !releases.error),
    stockIDX,
    lookup: {
      hasToken: Boolean(env.MXSHOP_LOOKUP_TOKEN || env.MXSHOP_BEARER_TOKEN),
      url: env.MXSHOP_LOOKUP_URL || "https://api.mxshop.in.th/api/mobilelegendschecker?uid=",
      uidFormat: env.MXSHOP_LOOKUP_UID_FORMAT || env.MXSHOP_UID_FORMAT || "parens",
    },
    hello: summarizeMx(hello),
    balance: summarizeMx(balance),
    releases: summarizeMx(releases),
  });
}

async function mxshopPackages(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  const auth = requireAdmin(payload, env);
  if (auth) return auth;
  if (!env.MXSHOP_MX_KEY || !env.MXSHOP_PASSKEY) return jsonResponse(500, { ok: false, error: "MXSHOP_MX_KEY and MXSHOP_PASSKEY are required" });

  const stockIds = parseMxStockIds(payload, env);
  const type = payload.type || 4;
  const results = [];

  for (const stockIDX of stockIds) {
    const releases = await mxPost(env, "/api/v1/get_stockreleaselist", { StockIDX: stockIDX, type });
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
}

async function mxshopTopup(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  const payload = await readJson(request);
  if (!env.ADMIN_PASSWORD) return jsonResponse(500, { ok: false, error: "ADMIN_PASSWORD is not configured" });
  if (String(payload.adminPassword || "") !== env.ADMIN_PASSWORD) return jsonResponse(401, { ok: false, error: "Wrong admin password" });
  try {
    const topup = await performMxshopTopup(env, payload.order || {});
    return jsonResponse(200, { ok: true, status: topup.status || "submitted", skipped: Boolean(topup.skipped), reason: topup.reason || "", mxshop: topup.response || null, request: topup.request || null });
  } catch (error) {
    return jsonResponse(error.status || 502, {
      ok: false,
      error: error.message || "MXShop purchase failed",
      status: error.status || 502,
      mxshop: error.mxshop || null,
      request: error.request || null,
    });
  }
}

async function tryAutoFulfillMxshopOrder(env, order) {
  const pkgId = String(order.pkg?.id || "");
  if (!getMappedStockReleaseId(pkgId, env, order)) {
    return { status: "skipped", skipped: true, reason: "No MXShop package mapping for this package" };
  }
  try {
    const topup = await performMxshopTopup(env, order);
    const now = new Date().toISOString();
    return { status: topup.status || (topup.skipped ? "skipped" : "submitted"), skipped: Boolean(topup.skipped), reason: topup.reason || "", transactionId: topup.transactionId || getSupplierTransactionId(topup.response) || "", request: topup.request || null, response: topup.response || null, completedAt: topup.status === "success" ? now : "", submittedAt: topup.status === "submitted" ? now : "" };
  } catch (error) {
    return { status: "failed", error: error.message || "MXShop purchase failed", request: error.request || null, response: error.mxshop || null, failedAt: new Date().toISOString() };
  }
}

async function performMxshopTopup(env, order) {
  if (env.MXSHOP_AUTO_TOPUP_ENABLED !== "true") {
    return { skipped: true, reason: "MXSHOP_AUTO_TOPUP_ENABLED is not true" };
  }

  const pkgId = String(order.pkg?.id || "");
  const uid = buildMxUid(order, env);
  const stockReleaseId = getMappedStockReleaseId(pkgId, env, order);
  if (!stockReleaseId) {
    const error = new Error(`No MXShop stockreleaselist_id mapped for package id ${pkgId}. Add the supplier stockreleaselist_id to MXSHOP_PACKAGE_MAP, for example {"7":"YOUR_WEEKLY_PASS_ID"}, or set mxshopStockReleaseId on the package.`);
    error.status = 400;
    throw error;
  }
  if (!uid) {
    const error = new Error("Missing player user id or required zone/server id");
    error.status = 400;
    throw error;
  }
  if (!env.MXSHOP_MX_KEY || !env.MXSHOP_PASSKEY) {
    const error = new Error("MXShop credentials are not configured. Set MXSHOP_MX_KEY and MXSHOP_PASSKEY.");
    error.status = 500;
    throw error;
  }

  const requestBody = { stockreleaselist_id: stockReleaseId, uid };
  const response = await fetch(env.MXSHOP_PURCHASE_URL || `${env.MXSHOP_API_BASE || "https://service.mxshop.in.th"}/api/v1/buy`, {
    method: "POST",
    headers: buildMxHeaders(env),
    body: JSON.stringify(requestBody),
  });
  const text = await response.text();
  const data = safeJson(text);

  if (!response.ok || !data || data?.success === false || data?.ok === false || (data?.error_code !== undefined && Number(data.error_code) !== 0) || hasMxFailureSignal(data)) {
    const error = new Error(data?.msg || data?.message || data?.error || response.statusText || "MXShop purchase failed");
    error.status = 502;
    error.mxshop = data || text;
    error.request = requestBody;
    throw error;
  }

  return {
    skipped: false,
    status: isMxDeliveryConfirmed(data) ? "success" : "submitted",
    transactionId: getSupplierTransactionId(data),
    response: data || text,
    request: requestBody,
  };
}

function isMxDeliveryConfirmed(data) {
  if (hasMxFailureSignal(data)) return false;
  if (hasMxSuccessSignal(data)) return true;
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
  return direct.some((value) => ["delivered", "completed", "complete", "success", "successful", "finished", "done"].includes(value));
}

function hasMxSuccessSignal(data) {
  return data?.success === true
    || data?.ok === true
    || data?.result?.success === true
    || data?.result?.ok === true
    || data?.data?.success === true
    || data?.data?.ok === true;
}

function hasMxFailureSignal(data) {
  const values = [
    data?.msg,
    data?.message,
    data?.error,
    data?.result?.msg,
    data?.result?.message,
    data?.data?.msg,
    data?.data?.message,
  ].map((value) => String(value || "").toLowerCase()).join(" ");
  return /\b(fail|failed|error|invalid|insufficient|not enough|not_found|not found|cancel|cancelled)\b/.test(values);
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

function getSupplierTransactionId(data) {
  const candidates = [
    data?.transactionId,
    data?.transaction_id,
    data?.txid,
    data?.tx_id,
    data?.orderId,
    data?.order_id,
    data?.ref,
    data?.reference,
    data?.result?.transactionId,
    data?.result?.transaction_id,
    data?.result?.txid,
    data?.result?.orderId,
    data?.result?.order_id,
    data?.result?.ref,
    data?.data?.transactionId,
    data?.data?.transaction_id,
    data?.data?.txid,
    data?.data?.orderId,
    data?.data?.order_id,
    data?.data?.ref,
  ];
  return String(candidates.find((value) => value !== undefined && value !== null && String(value).trim()) || "").trim().slice(0, 120);
}

async function paymentWebhook(request, env) {
  if (request.method !== "POST") return jsonResponse(405, { ok: false, error: "Method not allowed" });
  if (env.PAYMENT_AUTOMATION_ENABLED !== "true") {
    return jsonResponse(200, { ok: true, skipped: true, reason: "PAYMENT_AUTOMATION_ENABLED is not true" });
  }
  if (!verifyWebhookSecret(request.headers, env.PAYMENT_WEBHOOK_SECRET || "")) {
    return jsonResponse(401, { ok: false, error: "Invalid webhook secret" });
  }

  const payload = await readJson(request);
  const payment = normalizePayment(payload);
  if (!payment.orderId) {
    return jsonResponse(400, { ok: false, error: "Missing order reference. Send orderId, order_id, reference, or client_reference." });
  }

  if (!payment.paid) {
    await notifyTelegram(env, `<b>Payment event not paid</b>\nOrder: <code>${escapeHtml(payment.orderId)}</code>\nProvider: ${escapeHtml(payment.provider)}\nStatus: ${escapeHtml(payment.status || "unknown")}`);
    return jsonResponse(200, { ok: true, paid: false, payment });
  }

  const firestore = await markOrderPaid(env, payment, payload);
  await notifyTelegram(
    env,
    `<b>Payment verified</b>\nOrder: <code>${escapeHtml(payment.orderId)}</code>\nProvider: ${escapeHtml(payment.provider)}\nAmount: ${escapeHtml(String(payment.amount || "unknown"))} ${escapeHtml(payment.currency || "MMK")}\nTxID: <code>${escapeHtml(payment.txid || "none")}</code>\nFirestore: ${firestore.updated ? "updated" : escapeHtml(firestore.reason || "not updated")}`
  );

  return jsonResponse(200, { ok: true, paid: true, payment, firestore });
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, "Content-Type": "application/json" },
  });
}

async function tryLookup(candidate, userId, zoneId) {
  try {
    const config = typeof candidate === "string" ? { source: candidate, url: candidate, method: "POST_FORM" } : candidate;
    const body = new URLSearchParams({ game_code: "MOBILE_LEGENDS", user_id: userId, zone_id: zoneId });
    const options = getLookupOptions(config, body);
    const url = getLookupUrl(config, userId, zoneId);
    const response = await fetch(url, options);
    const raw = await response.text();
    const data = parseLookupBody(raw);
    return { nickname: findNickname(data), error: getLookupError(data, raw), source: config.source || config.url };
  } catch (error) {
    return { error: error.message || "" };
  }
}

function getLookupOptions(config, formBody) {
  const headers = { "User-Agent": "BestDia/1.0", ...(config.headers || {}) };
  if (config.method === "GET" || config.method === "GET_UID") return { method: "GET", headers };
  if (config.method === "POST_JSON") {
    return { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(Object.fromEntries(formBody)) };
  }
  return { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers }, body: formBody };
}

function getLookupUrl(config, userId, zoneId) {
  if (config.method !== "GET_UID") return config.url;
  const uid = formatLookupUid(userId, zoneId, config.uidFormat);
  return String(config.url || "").includes("{uid}")
    ? String(config.url).replace("{uid}", encodeURIComponent(uid))
    : String(config.url || "") + encodeURIComponent(uid);
}

function formatLookupUid(userId, zoneId, format) {
  if (format === "space") return `${userId} ${zoneId}`;
  if (format === "slash") return `${userId}/${zoneId}`;
  if (format === "plain") return `${userId}${zoneId}`;
  return `${userId}(${zoneId})`;
}

function parseLookupBody(raw) {
  const text = String(raw || "").trim();
  if (!text || isLookupErrorText(text)) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { nickname: text };
  }
}

function findNickname(value) {
  if (!value || typeof value !== "object") return "";
  for (const key of ["nickname", "username", "userName", "name", "ign", "nameingame", "charactername", "echo_name", "gamename", "gameName", "playerName"]) {
    if (typeof value[key] === "string" && isValidNickname(value[key])) return value[key].trim();
  }
  for (const nested of Object.values(value)) {
    const found = findNickname(nested);
    if (found) return found;
  }
  return "";
}

function getLookupError(data, raw) {
  const message = findLookupMessage(data) || String(raw || "").trim();
  if (!message) return "";
  if (/โทเค็นไม่ถูกต้อง|หมดอายุ|invalid\s+token|expired\s+token/i.test(message)) {
    return "MXShop lookup token is invalid or expired. Copy a fresh token from MXShop, update MXSHOP_LOOKUP_TOKEN in Cloudflare, then redeploy.";
  }
  if (/กรุณาเข้าสู่ระบบก่อน|please\s+log\s*in/i.test(message)) {
    return "MXShop lookup needs a valid login token. Set MXSHOP_LOOKUP_TOKEN in Cloudflare and redeploy.";
  }
  return "";
}

function findLookupMessage(value) {
  if (!value || typeof value !== "object") return "";
  for (const key of ["message", "msg", "error", "errorMsg", "details", "description"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  for (const nested of Object.values(value)) {
    const found = findLookupMessage(nested);
    if (found) return found;
  }
  return "";
}

function isLookupErrorText(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  return /^(not found|error|failed|invalid|undefined|null)$/i.test(text) ||
    /\berror\s*(code|:)/i.test(text) ||
    /\b(code|status)\s*[:=]\s*\d{3,}/i.test(text) ||
    /\b(too many requests|forbidden|unauthorized|captcha|cloudflare)\b/i.test(text) ||
    /กรุณาเข้าสู่ระบบก่อน|ไม่พบชื่อในเกม|uid\s*อาจไม่ถูกต้อง/i.test(text);
}

function isValidNickname(value) {
  const text = String(value || "").trim();
  if (isLookupErrorText(text)) return false;
  if (text.length < 2 || text.length > 40) return false;
  if (/^[\d\s:._-]+$/.test(text)) return false;
  return true;
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

async function sendSlipPhoto(botToken, chatId, dataUrl, fileName) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return { ok: false, error: "Invalid slip image" };
  const bytes = base64ToBytes(match[2]);
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", "Payment slip");
  form.append("photo", new Blob([bytes], { type: match[1] }), fileName || "payment-slip.jpg");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: "POST", body: form });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok && body.ok !== false, status: response.status, ...body };
}

async function telegram(botToken, method, payload) {
  const options = payload ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : undefined;
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, options);
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok && body.ok !== false, status: response.status, ...body };
  } catch (error) {
    return { ok: false, status: 0, description: error.message };
  }
}

function summarizeTelegram(response) {
  return { ok: response.ok, status: response.status, errorCode: response.error_code || null, description: response.description || null };
}

async function mxPost(env, path, body = {}) {
  try {
    const response = await fetch(`${env.MXSHOP_API_BASE || "https://service.mxshop.in.th"}${path}`, {
      method: "POST",
      headers: buildMxHeaders(env),
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const data = safeJson(text);
    return { httpStatus: response.status, ok: response.ok, ...(data || { raw: text }) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function buildMxHeaders(env) {
  const headers = { "Content-Type": "application/json" };
  if (env.MXSHOP_MX_KEY) headers["mx-key"] = env.MXSHOP_MX_KEY;
  if (env.MXSHOP_PASSKEY) headers.passkey = env.MXSHOP_PASSKEY;
  return headers;
}

function summarizeMx(response) {
  const result = response.result;
  const releaseList = Array.isArray(result) ? result : null;
  return {
    httpStatus: response.httpStatus || null,
    success: response.success ?? response.ok ?? false,
    error_code: response.error_code || null,
    msg: response.msg || response.message || response.error || "",
    result: releaseList
      ? releaseList.slice(0, 40).map((item) => ({
          stockreleaselist_id: item.stockreleaselist_id,
          product_stockname: item.product_stockname,
          price: item.price,
          not_available: item.not_available,
        }))
      : result || null,
  };
}

function parseMxStockIds(payload, env) {
  const raw = payload.stockIds ?? payload.StockIDXs ?? payload.StockIDX ?? env.MXSHOP_STOCK_IDXS ?? env.MXSHOP_STOCK_IDX ?? "17";
  const values = Array.isArray(raw) ? raw : String(raw).split(",");
  const stockIds = values.map((value) => String(value || "").trim()).filter(Boolean);
  return stockIds.length ? [...new Set(stockIds)] : ["17"];
}

function buildMxUid(order, env) {
  const userId = String(order.userId || "").trim();
  const zoneId = String(order.zoneId || "").trim();
  const gameKey = String(order.gameKey || order.pkg?.gameKey || "").trim();
  const product = PRODUCTS[gameKey];
  if (!userId) return "";
  if (!product?.requiresZone && !zoneId) return userId;
  if (!zoneId) return "";
  const format = env[`MXSHOP_UID_FORMAT_${gameKey.toUpperCase()}`] || env.MXSHOP_UID_FORMAT;
  if (format === "space") return `${userId} ${zoneId}`;
  if (format === "slash") return `${userId}/${zoneId}`;
  return `${userId}(${zoneId})`;
}

function getMappedStockReleaseId(pkgId, env, order = {}) {
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
    const mapped = String({ ...defaultMap, ...JSON.parse(env.MXSHOP_PACKAGE_MAP || "{}") }[pkgId] || "").trim();
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

function verifyWebhookSecret(headers, secret) {
  if (!secret) return false;
  const headerSecret = headers.get("x-bestdia-secret") || "";
  const auth = headers.get("authorization") || "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  return safeEqual(headerSecret, secret) || safeEqual(bearer, secret);
}

function safeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ""));
  const right = new TextEncoder().encode(String(b || ""));
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

function normalizePayment(payload) {
  const data = payload.data || payload.result || payload.payment || payload;
  const status = String(data.payment_status || data.checkout_status || data.status || payload.status || payload.type || "").toLowerCase();
  const orderId =
    data.orderId ||
    data.order_id ||
    data.reference ||
    data.client_reference ||
    data.merchant_reference ||
    data.custom_fields?.order_id ||
    data.custom_fields?.account_number ||
    payload.orderId ||
    payload.order_id ||
    payload.reference ||
    payload.client_reference ||
    "";
  const paidStatuses = new Set(["paid", "success", "succeeded", "complete", "completed", "payment_success", "merchant.payment_received", "checkout.session.completed"]);
  return {
    paid: paidStatuses.has(status) || payload.type === "merchant.payment_received",
    status,
    orderId: String(orderId || "").trim().toUpperCase(),
    provider: String(payload.provider || payload.source || data.provider || payload.type || "payment"),
    amount: data.amount || data.total || data.paid_amount || payload.amount || null,
    currency: data.currency || payload.currency || "MMK",
    txid: data.txid || data.transaction_id || data.id || payload.txid || payload.id || "",
    rawEventId: payload.id || data.event_id || "",
  };
}

async function markOrderPaid(env, payment, rawPayload) {
  let firestore;
  try {
    firestore = await firestoreClient(env);
  } catch {
    return { updated: false, reason: "FIREBASE_SERVICE_ACCOUNT_JSON is not configured" };
  }
  const docName = await findOrderDocName(firestore.projectId, firestore.token, payment.orderId);
  if (!docName) return { updated: false, reason: "order not found" };

  const fields = {
    paymentStatus: { stringValue: "verified" },
    paymentReference: { stringValue: payment.orderId },
    paymentProvider: { stringValue: payment.provider },
    paymentTxid: { stringValue: payment.txid || "" },
    paymentCurrency: { stringValue: payment.currency || "MMK" },
    paymentVerifiedAt: { timestampValue: new Date().toISOString() },
    paymentWebhookEventId: { stringValue: payment.rawEventId || "" },
    paymentWebhookRaw: { stringValue: JSON.stringify(rawPayload).slice(0, 9000) },
  };
  if (payment.amount !== null && payment.amount !== undefined && payment.amount !== "") fields.paymentAmount = { doubleValue: Number(payment.amount) || 0 };

  const mask = Object.keys(fields).map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join("&");
  const response = await fetch(`https://firestore.googleapis.com/v1/${docName}?${mask}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) return { updated: false, reason: body.error?.message || response.statusText };
  return { updated: true, docName };
}

function requireAdmin(payload, env) {
  if (!env.ADMIN_PASSWORD) return jsonResponse(500, { ok: false, error: "ADMIN_PASSWORD is not configured" });
  if (!safeEqual(String(payload.adminPassword || ""), env.ADMIN_PASSWORD)) {
    return jsonResponse(401, { ok: false, error: "Wrong admin password" });
  }
  return null;
}

async function firestoreClient(env) {
  const serviceAccount = parseServiceAccount(env);
  if (!serviceAccount) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not configured");
  return {
    projectId: serviceAccount.project_id,
    token: await getAccessToken(serviceAccount),
  };
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
  return (Array.isArray(data) ? data : [])
    .filter((item) => item.document)
    .map((item) => decodeDocument(item.document));
}

async function findOrderById(firestore, orderId) {
  const docName = await findOrderDocName(firestore.projectId, firestore.token, orderId);
  if (!docName) return null;
  const response = await fetch(`https://firestore.googleapis.com/v1/${docName}`, {
    headers: { Authorization: `Bearer ${firestore.token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "Could not get Firestore order");
  return decodeDocument(data);
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

async function commitOrderAndAccountUpdates(firestore, orderDocId, orderUpdates, accountId, accountUpdates) {
  const orderName = `projects/${firestore.projectId}/databases/(default)/documents/orders/${orderDocId}`;
  const accountName = `projects/${firestore.projectId}/databases/(default)/documents/account_balances/${accountDocId(accountId)}`;
  const writes = [
    firestoreUpdateWrite(orderName, orderUpdates),
    firestoreUpdateWrite(accountName, accountUpdates),
  ];
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firestore.projectId}/databases/(default)/documents:commit`, {
    method: "POST",
    headers: { Authorization: `Bearer ${firestore.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ writes }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "Could not commit order and balance updates");
  return true;
}

function firestoreUpdateWrite(name, updates) {
  const fields = {};
  for (const [key, value] of Object.entries(updates)) fields[key] = encodeFirestoreValue(value);
  return {
    update: { name, fields },
    updateMask: { fieldPaths: Object.keys(fields) },
  };
}

async function createOrderDoc(firestore, order) {
  const fields = {};
  for (const [key, value] of Object.entries(order)) fields[key] = encodeFirestoreValue(value);
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firestore.projectId}/databases/(default)/documents/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${firestore.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || "Could not create Firestore order");
  return decodeDocument(data);
}

async function listCollectionDocs(firestore, collectionId, limit = 250) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firestore.projectId}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${firestore.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        orderBy: [{ field: { fieldPath: "createdAt" }, direction: "DESCENDING" }],
        limit,
      },
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Could not list ${collectionId}`);
  return (Array.isArray(data) ? data : []).filter((item) => item.document).map((item) => decodeDocument(item.document));
}

async function getCollectionDoc(firestore, collectionId, docId) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firestore.projectId}/databases/(default)/documents/${collectionId}/${encodeURIComponent(docId)}`, {
    headers: { Authorization: `Bearer ${firestore.token}` },
  });
  if (response.status === 404) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Could not get ${collectionId} document`);
  return decodeDocument(data).data;
}

async function updateCollectionDoc(firestore, collectionId, docId, updates) {
  const fields = {};
  for (const [key, value] of Object.entries(updates)) fields[key] = encodeFirestoreValue(value);
  const mask = Object.keys(fields).map((field) => `updateMask.fieldPaths=${encodeURIComponent(field)}`).join("&");
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${firestore.projectId}/databases/(default)/documents/${collectionId}/${encodeURIComponent(docId)}?${mask}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${firestore.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Could not update ${collectionId} document`);
  return decodeDocument(data).data;
}

async function createCollectionDoc(firestore, collectionId, value, docId = "") {
  const fields = {};
  for (const [key, nested] of Object.entries(value)) fields[key] = encodeFirestoreValue(nested);
  const url = `https://firestore.googleapis.com/v1/projects/${firestore.projectId}/databases/(default)/documents/${collectionId}${docId ? `?documentId=${encodeURIComponent(docId)}` : ""}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${firestore.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || `Could not create ${collectionId} document`);
  return decodeDocument(data);
}

async function getAccountBalanceDoc(firestore, accountId) {
  return getCollectionDoc(firestore, "account_balances", accountDocId(accountId));
}

async function setAccountBalanceDoc(firestore, accountId, value) {
  const docId = accountDocId(accountId);
  const existing = await getAccountBalanceDoc(firestore, accountId);
  if (existing) return updateCollectionDoc(firestore, "account_balances", docId, value);
  return createCollectionDoc(firestore, "account_balances", { ...value, createdAt: new Date().toISOString() }, docId);
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
    completedAt: order.completedAt,
    failedAt: order.failedAt,
    failedReason: order.failedReason,
    supplierTransactionId: order.supplierTransactionId,
    mxshopTopup: order.mxshopTopup || null,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    timeline: order.timeline || [],
  };
}

function adminOrder(order) {
  return { docId: order.docId, ...order.data };
}

function isBestDiaBalanceOrder(order) {
  return order?.payKey === "balance"
    || order?.payment === "BestDia Balance"
    || order?.slip?.receivedBy === "balance"
    || (Boolean(order?.accountId) && order?.paymentStatus === "verified" && !order?.slip?.url);
}

function publicTickerItem(order, index) {
  const suffix = String(order.id || index + 1).replace(/\D/g, "").slice(-4) || String(index + 1).padStart(2, "0");
  const pkg = order.pkg || {};
  const packageName = pkg.firstBonus
    ? `${fmtNumber(pkg.baseDiamonds)}+${fmtNumber(pkg.firstBonus)} Diamonds`
    : pkg.title || (pkg.diamonds ? `${fmtNumber(pkg.diamonds)} Diamonds` : String(pkg.name || "Top-up package"));
  return `BD${suffix} - ${packageName} - ပြီးဆုံး`;
}

function fmtNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function packageText(pkg) {
  return String(pkg?.title || pkg?.name || pkg?.diamonds || pkg?.uc || "Package");
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function normalizeOrderId(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
}

function normalizeAccountId(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 10 ? digits : "";
}

function accountDocId(accountId) {
  return normalizeAccountId(accountId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 180) || "unknown";
}

function parseServiceAccount(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) return null;
  try {
    const parsed = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
    if (parsed.private_key) parsed.private_key = parsed.private_key.replace(/\\n/g, "\n");
    return parsed;
  } catch {
    return null;
  }
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const jwtHeader = base64url(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const jwtClaim = base64url(new TextEncoder().encode(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })));
  const input = `${jwtHeader}.${jwtClaim}`;
  const key = await importPrivateKey(serviceAccount.private_key);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  const assertion = `${input}.${base64url(new Uint8Array(signature))}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error(data.error_description || data.error || "Could not get Firebase access token");
  return data.access_token;
}

async function importPrivateKey(pem) {
  const base64 = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  return crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(base64),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function findOrderDocName(projectId, token, orderId) {
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
  return hit?.document?.name || "";
}

async function notifyTelegram(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
    });
  } catch {}
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
