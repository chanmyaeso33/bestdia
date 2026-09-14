exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const text = String(payload.text || "").trim();
  if (!text) {
    return jsonResponse(400, { error: "Missing notification text" });
  }
  const slipDataUrl = String(payload.slipDataUrl || "");
  const slipFileName = String(payload.slipFileName || "payment-slip.jpg");

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) {
    return jsonResponse(500, {
      error: "Telegram is not configured",
      details: "Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in Netlify environment variables.",
    });
  }

  try {
    const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
      }),
    });

    const body = await telegramRes.json().catch(() => ({}));
    if (!telegramRes.ok || body.ok === false) {
      const isUnauthorized = telegramRes.status === 401 || body.error_code === 401;
      return jsonResponse(502, {
        error: isUnauthorized ? "Telegram bot token is invalid" : "Telegram send failed",
        details: isUnauthorized
          ? "Generate a new token in BotFather, save it as TELEGRAM_BOT_TOKEN in Netlify, then redeploy."
          : body.description || telegramRes.statusText,
      });
    }

    if (slipDataUrl.startsWith("data:image/")) {
      const sentPhoto = await sendSlipPhoto(botToken, chatId, slipDataUrl, slipFileName);
      if (!sentPhoto.ok) {
        return jsonResponse(200, {
          ok: true,
          warning: "Order notification sent, but payment slip photo failed.",
          details: sentPhoto.description || sentPhoto.error || null,
        });
      }
    }

    return jsonResponse(200, { ok: true });
  } catch (error) {
    return jsonResponse(502, { error: "Telegram request failed", details: error.message });
  }
};

async function sendSlipPhoto(botToken, chatId, dataUrl, fileName) {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return { ok: false, error: "Invalid slip image" };

  const bytes = Buffer.from(match[2], "base64");
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("caption", "Payment slip");
  form.append("photo", new Blob([bytes], { type: match[1] }), fileName || "payment-slip.jpg");

  const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const body = await response.json().catch(() => ({}));
  return {
    ok: response.ok && body.ok !== false,
    status: response.status,
    ...body,
  };
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
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
}
