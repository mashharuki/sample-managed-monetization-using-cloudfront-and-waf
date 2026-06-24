/**
 * Thin UA proxy — the ONE thing a browser can't do: set the real `User-Agent`.
 *
 * The browser drives the whole traffic burst (loop, jitter, parallelism); for each
 * request it calls this proxy as `/proxy?target=/weather&ua=<client>`. The proxy
 * re-issues exactly ONE GET to the target path on the same distribution with that
 * UA as the real `User-Agent` header, so AWS WAF Bot Control sees a genuine
 * GPTBot/ClaudeBot/etc and labels it in the AI-traffic view. It returns only the
 * upstream STATUS (not the body — unpaid calls are 402 with no content anyway), so
 * it never unlocks paid content.
 *
 * Reached only via CloudFront (Function URL is IAM-auth + OAC), never publicly.
 */
const ALLOWED_TARGETS = (process.env.ALLOWED_TARGETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = async (event: any) => {
  const qs = event.queryStringParameters ?? {};
  const target = String(qs.target ?? "");
  const ua = String(qs.ua ?? "x402-sim/1.0");

  const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };

  // Only allow the configured monetized paths (no open proxy).
  if (!ALLOWED_TARGETS.includes(target)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: `target not allowed: ${target}` }) };
  }

  // The browser passes its own page origin (the CloudFront domain) as `origin` — we
  // do NOT inject it as a deploy-time env var, which is what breaks the CDK circular
  // dependency between this Lambda and the Distribution. The proxy loops back through
  // that same distribution so WAF runs. Restrict to *.cloudfront.net for safety.
  const origin = String(qs.origin ?? "");
  if (!/^https:\/\/[a-z0-9.-]+\.cloudfront\.net$/i.test(origin)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: `bad origin: ${origin}` }) };
  }
  // Cache-bust so each call is a distinct edge request, not a cached repeat.
  const url = `${origin}${target}?_=${Math.random().toString(36).slice(2)}`;
  try {
    const r = await fetch(url, { method: "GET", headers: { "user-agent": ua } });
    return {
      statusCode: 200,
      headers: cors,
      body: JSON.stringify({ target, ua, upstreamStatus: r.status }),
    };
  } catch (e) {
    return { statusCode: 502, headers: cors, body: JSON.stringify({ target, ua, error: String(e) }) };
  }
};
