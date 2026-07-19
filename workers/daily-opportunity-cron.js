const DEFAULT_PIPELINE_URL = "https://bestdia.pages.dev/api/run-daily-opportunity-pipeline";

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runDailyPipeline(env, {
      trigger: "cron",
      cron: controller.cron,
      scheduledTime: controller.scheduledTime,
    }));
  },

  async fetch(request, env) {
    if (request.method === "GET") {
      return jsonResponse(200, {
        ok: true,
        worker: "bestdia-daily-opportunity-cron",
        pipelineUrl: env.BESTDIA_PIPELINE_URL || DEFAULT_PIPELINE_URL,
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "Method not allowed" });
    }

    const payload = await request.json().catch(() => ({}));
    if (!env.CRON_TRIGGER_SECRET || payload.secret !== env.CRON_TRIGGER_SECRET) {
      return jsonResponse(401, { ok: false, error: "Unauthorized" });
    }

    const result = await runDailyPipeline(env, { trigger: "manual" });
    return jsonResponse(200, result);
  },
};

async function runDailyPipeline(env, metadata) {
  const adminPassword = env.ADMIN_PASSWORD || env.BESTDIA_ADMIN_PASSWORD;
  if (!adminPassword) throw new Error("ADMIN_PASSWORD is not configured");

  const pipelineUrl = env.BESTDIA_PIPELINE_URL || DEFAULT_PIPELINE_URL;
  const body = {
    adminPassword,
    limitPerSource: Number(env.PIPELINE_LIMIT_PER_SOURCE || 5),
    agentLimit: Number(env.PIPELINE_AGENT_LIMIT || 10),
    metadata,
  };

  const response = await fetch(pipelineUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) {
    throw new Error(result.error || `Pipeline returned HTTP ${response.status}`);
  }
  console.log("BestDia daily opportunity pipeline completed", JSON.stringify(result.summary || result));
  return result;
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
