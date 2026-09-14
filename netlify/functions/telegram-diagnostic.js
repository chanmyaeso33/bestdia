const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

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

  if (!ADMIN_PASSWORD) {
    return jsonResponse(500, { error: "ADMIN_PASSWORD is not configured" });
  }

  if (payload.adminPassword !== ADMIN_PASSWORD) {
    return jsonResponse(401, { error: "Wrong admin password" });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const configuredChatId = process.env.TELEGRAM_CHAT_ID;
  const result = {
    hasBotToken: Boolean(botToken),
    hasChatId: Boolean(configuredChatId),
    configuredChatId: configuredChatId || null,
  };

  if (!botToken) {
    return jsonResponse(200, {
      ...result,
      ok: false,
      error: "Missing TELEGRAM_BOT_TOKEN in Netlify environment variables.",
    });
  }

  const me = await telegram(botToken, "getMe");
  result.bot = me.ok ? me.result : null;
  result.getMe = summarizeTelegram(me);

  if (!me.ok) {
    return jsonResponse(200, {
      ...result,
      ok: false,
      error: "Bot token is not valid.",
    });
  }

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

  if (!configuredChatId) {
    return jsonResponse(200, {
      ...result,
      ok: false,
      error: "Missing TELEGRAM_CHAT_ID in Netlify environment variables.",
    });
  }

  const sent = await telegram(botToken, "sendMessage", {
    chat_id: configuredChatId,
    text: "BestDia Telegram test: notifications are connected.",
  });
  result.sendMessage = summarizeTelegram(sent);

  return jsonResponse(200, {
    ...result,
    ok: sent.ok,
    error: sent.ok ? null : sent.description || "Telegram test message failed.",
  });
};

async function telegram(botToken, method, payload) {
  const options = payload
    ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    : undefined;

  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, options);
    const body = await response.json().catch(() => ({}));
    return {
      ok: response.ok && body.ok !== false,
      status: response.status,
      ...body,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      description: error.message,
    };
  }
}

function summarizeTelegram(response) {
  return {
    ok: response.ok,
    status: response.status,
    errorCode: response.error_code || null,
    description: response.description || null,
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
