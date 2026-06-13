// Cloudflare Worker: /api/activity-log
// 環境變數：SUP_URL、SERVICE_ROLE_KEY
export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    try {
      const body = await request.json();
      const event_name = String(body.event_name || "").slice(0, 80);
      if (!event_name) return json({ ok: false, error: "missing_event_name" }, 400);

      const row = {
        event_name,
        page: String(body.page || "").slice(0, 300),
        user_id: body.user_id || null,
        guest_id: String(body.guest_id || "").slice(0, 120),
        detail: body.detail && typeof body.detail === "object" ? body.detail : {}
      };

      const res = await fetch(`${env.SUP_URL}/rest/v1/user_activity_logs`, {
        method: "POST",
        headers: {
          "apikey": env.SERVICE_ROLE_KEY,
          "Authorization": `Bearer ${env.SERVICE_ROLE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal"
        },
        body: JSON.stringify(row)
      });

      if (!res.ok) {
        const text = await res.text();
        return json({ ok: false, error: "supabase_insert_failed", detail: text }, 500);
      }
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: String(e && e.message || e) }, 500);
    }
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() }
  });
}
