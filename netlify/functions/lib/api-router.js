const path = require("path");
const fs = require("fs");

let apiPromise;

function loadApi() {
  if (!apiPromise) {
    const modPath = path.join(__dirname, "../../../functions/api/[[path]].js");
    const source = fs.readFileSync(modPath, "utf8");
    apiPromise = import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  }
  return apiPromise;
}

async function routeApi(event, route) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-BestDia-Secret",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }
  const api = await loadApi();
  const headers = new Headers(event.headers || {});
  const request = new Request(`https://${event.headers.host || "localhost"}/api/${route}`, {
    method: event.httpMethod,
    headers,
    body: event.httpMethod === "GET" || event.httpMethod === "HEAD" ? undefined : event.body || "",
  });
  const response = await api.onRequest({ request, env: process.env, params: { path: [route] } });
  return {
    statusCode: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  };
}

module.exports = { routeApi };
