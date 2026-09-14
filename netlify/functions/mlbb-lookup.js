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

  const userId = onlyDigits(payload.userId);
  const zoneId = onlyDigits(payload.zoneId);
  if (!userId || !zoneId) {
    return jsonResponse(400, { error: "Missing User ID or Zone ID" });
  }

  const candidates = [
    {
      source: "gopay",
      url: "https://gopay.co.id/games/v1/order/user-account",
      method: "POST_GOPAY",
    },
    {
      source: "xpreloads",
      url: `https://xpreloads.com/api/api/mlbb?user_id=${encodeURIComponent(userId)}&server_id=${encodeURIComponent(zoneId)}`,
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Custom-Token": "narbu-frontend",
      },
    },
    {
      source: "namdevel",
      url: "https://public-api.namdevel.rest/v1/init/username",
      method: "POST_FORM",
    },
    process.env.MLBB_LOOKUP_URL,
    {
      source: "codashop-api",
      url: "https://api.codashop.com/v1/init/username",
      method: "POST_FORM",
    },
    {
      source: "codashop-sg",
      url: "https://order-sg.codashop.com/v1/init/username",
      method: "POST_FORM",
    },
  ].filter(Boolean);

  for (const url of candidates) {
    const result = await tryLookup(url, userId, zoneId);
    if (result.nickname && result.region) {
      return jsonResponse(200, {
        ok: true,
        nickname: result.nickname,
        region: result.region,
        unsupported: result.unsupported,
        validOrder: !result.unsupported,
        source: result.source,
      });
    }
  }

  return jsonResponse(502, {
    ok: false,
    error: "Nickname lookup is unavailable. Please verify the ID manually.",
  });
};

async function tryLookup(candidate, userId, zoneId) {
  try {
    const config = typeof candidate === "string"
      ? { source: candidate, url: candidate, method: "POST_FORM" }
      : candidate;
    const body = new URLSearchParams({
      game_code: "MOBILE_LEGENDS",
      user_id: userId,
      zone_id: zoneId,
    });

    const options = config.method === "GET"
      ? {
          method: "GET",
          headers: {
            "User-Agent": "BestDia/1.0",
            ...(config.headers || {}),
          },
        }
      : config.method === "POST_GOPAY"
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json", "User-Agent": "BestDia/1.0", ...(config.headers || {}) },
            body: JSON.stringify({ code: "MOBILE_LEGENDS", data: { userId, zoneId } }),
          }
        : {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": "BestDia/1.0",
            ...(config.headers || {}),
          },
          body,
        };

    const response = await fetch(config.url, options);
    const raw = await response.text();
    const data = parseLookupBody(raw);
    return {
      nickname: findNickname(data),
      region: findRegion(data),
      unsupported: isUnsupportedRegion(findRegion(data)),
      source: config.source || config.url,
    };
  } catch {
    return {};
  }
}

function parseLookupBody(raw) {
  const text = String(raw || "").trim();
  if (!text || /^not found$/i.test(text)) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { nickname: text };
  }
}

function findNickname(value) {
  if (!value || typeof value !== "object") return "";
  const directKeys = ["nickname", "username", "userName", "name", "ign"];
  for (const key of directKeys) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  for (const nested of Object.values(value)) {
    const found = findNickname(nested);
    if (found) return found;
  }
  return "";
}

function findRegion(value) {
  if (!value || typeof value !== "object") return "";
  const names = { jp: "Japan", ph: "Philippines", id: "Indonesia", idn: "Indonesia", my: "Malaysia", mys: "Malaysia", ru: "Russia", rus: "Russia", sg: "Singapore", sgp: "Singapore", global: "Global" };
  for (const key of ["region", "country", "countryOrigin", "country_origin", "countryCode", "country_code", "serverRegion", "server_region"]) {
    if ((typeof value[key] === "string" || typeof value[key] === "number") && String(value[key]).trim()) {
      const raw = String(value[key]).trim(), normalized = raw.toLowerCase().replace(/[_.-]+/g, " ").replace(/\s+/g, " ");
      return names[normalized] || raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
    }
  }
  for (const nested of Object.values(value)) {
    const found = findRegion(nested);
    if (found) return found;
  }
  return "";
}

function isUnsupportedRegion(region) {
  return /^(japan|philippines|indonesia|malaysia|russia|singapore)$/i.test(String(region || "").trim());
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
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
