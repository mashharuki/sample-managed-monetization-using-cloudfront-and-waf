/**
 * ローカル x402 モックサーバー — AWS WAF の Monetize ルールアクションをエミュレートします。
 *
 * 本番の AWS WAF が行う動作:
 *   GET /weather            → 402 + PAYMENT-REQUIRED ヘッダー
 *   GET /weather (署名付き)  → 200 + PAYMENT-RESPONSE ヘッダー + コンテンツ
 *
 * ローカルモードの簡略化:
 *   - 署名の暗号検証はスキップ（任意の PAYMENT-SIGNATURE を受け入れる）
 *   - Base Sepolia への実際の USDC 送金は行わない
 *   - コンテンツ生成は本番の edge.js と同じロジック
 *
 * エンドポイント:
 *   GET /weather     → JSON 天気データ
 *   GET /sports      → Markdown スポーツダイジェスト
 *   GET /main.html   → HTML ランディングページ
 *   GET /proxy       → UA プロキシ（/proxy?target=&ua=&origin=）
 */

import http from "node:http";
import { URL } from "node:url";

const PORT = 3001;

// Base Sepolia USDC コントラクトアドレス（本番と同一）
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BASE_SEPOLIA_CAIP2 = "eip155:84532";

// ローカル販売者アドレス（pkgs/cdk/.seller-payto.json の値）
const LOCAL_SELLER_ADDRESS = "0x6A93800ADEd9E1f8a8c973145Ec19360598E7487";

// 収益化対象ルートと価格（USDC 6桁の最小単位）
const ROUTES: Record<string, { amount: string; mimeType: string }> = {
  "/weather": { amount: "1000", mimeType: "application/json" },   // 0.001 USDC
  "/sports": { amount: "2000", mimeType: "text/markdown" },        // 0.002 USDC
  "/main.html": { amount: "1000", mimeType: "text/html" },         // 0.001 USDC
};

const ALLOWED_TARGETS = Object.keys(ROUTES);

// ── x402 ヘッダーユーティリティ ──────────────────────────────────────────

function base64Encode(data: string): string {
  return Buffer.from(data, "utf8").toString("base64");
}

/**
 * PAYMENT-REQUIRED ヘッダー値を生成します（x402 v1 形式）。
 * @x402/core の encodePaymentRequiredHeader と同じエンコード方式（base64 JSON）。
 */
function buildPaymentRequiredHeader(resourceUrl: string, routeKey: string): string {
  const route = ROUTES[routeKey];
  const payload = {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: BASE_SEPOLIA_CAIP2,
        maxAmountRequired: route.amount,
        resource: resourceUrl,
        description: `ローカルモック x402 — ${routeKey}`,
        mimeType: route.mimeType,
        payTo: LOCAL_SELLER_ADDRESS,
        maxTimeoutSeconds: 300,
        asset: BASE_SEPOLIA_USDC,
        extra: null,
      },
    ],
  };
  return base64Encode(JSON.stringify(payload));
}

/**
 * 200 レスポンスに付与する PAYMENT-RESPONSE ヘッダー値を生成します。
 * ローカルでは実際のトランザクションがないため、モック値を返します。
 */
function buildPaymentResponseHeader(): string {
  const payload = {
    success: true,
    transaction: "0x" + "0".repeat(64),
    network: BASE_SEPOLIA_CAIP2,
    payer: "0x" + "0".repeat(40),
  };
  return base64Encode(JSON.stringify(payload));
}

// ── コンテンツ生成（edge.js と同じロジック）────────────────────────────────

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function rint(lo: number, hi: number): number {
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

function generateWeather(): string {
  const tempC = rint(8, 31);
  return JSON.stringify({
    service: "x402-weather",
    country: "LOCAL",
    tempC,
    tempF: Math.round(tempC * 1.8 + 32),
    condition: pick(["Sunny", "Partly cloudy", "Cloudy", "Light rain", "Thunderstorms", "Clear", "Windy", "Foggy"]),
    humidity: `${rint(30, 90)}%`,
    windKph: rint(3, 40),
    note: "Paid weather — local x402 mock server (floci local dev mode).",
    servedBy: "local-x402-server",
  });
}

function generateSports(): string {
  const teams = ["Nimbus FC", "Vortex United", "Pixel Rovers", "Quasar SC", "Cobalt Kings", "Ember Owls", "Lunar Tide", "Granite Wolves"];
  const match = () => {
    let a = pick(teams);
    let b = pick(teams);
    while (b === a) b = pick(teams);
    const st = pick(["FT", "Q4", "Live", "HT", "90'+3"]);
    return `| ${a} vs ${b} | ${rint(0, 5)} – ${rint(0, 5)} | ${st} |`;
  };
  return [
    "# Sports — paid digest (local x402 mock)",
    "",
    "_You only see this because the local x402 mock server accepted your payment signature._",
    "",
    `Updated for **LOCAL** · ref #${rint(1000, 9999)}`,
    "",
    "| Match | Score | Status |",
    "|-------|-------|--------|",
    match(),
    match(),
    match(),
    "",
    "> Served by local-x402-server (floci local dev mode).",
  ].join("\n");
}

function generateHtml(): string {
  const hero = pick(["#0052ff", "#7c3aed", "#0891b2", "#059669"]);
  return [
    "<!-- paid HTML fragment — local x402 mock server -->",
    `<article style="font-family:system-ui;color:#0a0b0d;line-height:1.5">`,
    `<div style="background:linear-gradient(135deg,${hero},#0a0b0d);color:#fff;border-radius:14px;padding:22px 24px;margin-bottom:16px">`,
    `<div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;opacity:.8">Local Dev · x402 Mock</div>`,
    `<h1 style="margin:6px 0 4px;font-size:26px">The Edge Dispatch</h1>`,
    `<p style="margin:0;opacity:.9">Unlocked · issue #${rint(100, 999)}</p>`,
    "</div>",
    `<p style="margin:0 0 14px">This is a <strong>local mock</strong> of the x402 paid content.</p>`,
    `<p style="margin:0 0 14px;color:#5b616e;font-size:13px">In production, AWS WAF verifies the EIP-3009 signature and settles on Base Sepolia. Locally, any signature is accepted.</p>`,
    `<blockquote style="margin:0;border-left:3px solid ${hero};padding:6px 14px;color:#5b616e">"Pay-per-request content — running via floci local dev mode."</blockquote>`,
    `<p style="margin:14px 0 0;font-size:12px;color:#7c828a">Served by local-x402-server · build ${rint(10000, 99999)}</p>`,
    "</article>",
  ].join("\n");
}

// ── HTTP サーバー ──────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const pathname = urlObj.pathname;

  // CORS ヘッダー（ブラウザの Vite dev server からのクロスオリジンアクセスを許可）
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, PAYMENT-SIGNATURE");
  res.setHeader("Access-Control-Expose-Headers", "PAYMENT-REQUIRED, PAYMENT-RESPONSE");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // /proxy — UA プロキシエンドポイントのシミュレーション
  // 本番では Lambda が実際の UA で upstream に GET を再発行します。
  // ローカルでは自分自身に対してリクエストを再発行します。
  if (pathname.startsWith("/proxy")) {
    const target = urlObj.searchParams.get("target") ?? "";
    const ua = urlObj.searchParams.get("ua") ?? "x402-sim/1.0";

    if (!ALLOWED_TARGETS.includes(target)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: `target not allowed: ${target}` }));
      return;
    }

    const targetUrl = `http://localhost:${PORT}${target}`;
    fetch(targetUrl, {
      method: "GET",
      headers: { "user-agent": ua },
    })
      .then((r) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ target, ua, upstreamStatus: r.status }));
      })
      .catch((e) => {
        res.writeHead(502, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ target, ua, error: String(e) }));
      });
    return;
  }

  // 収益化ルートの特定
  const matchedRoute = ALLOWED_TARGETS.find((t) => pathname.startsWith(t));
  if (!matchedRoute) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", pathname }));
    return;
  }

  const paymentSignature = req.headers["payment-signature"];

  if (!paymentSignature) {
    // 未払いリクエスト → 402 + PAYMENT-REQUIRED ヘッダー
    const resourceUrl = `http://localhost:${PORT}${pathname}`;
    const paymentRequiredHeader = buildPaymentRequiredHeader(resourceUrl, matchedRoute);
    res.setHeader("Content-Type", "application/json");
    res.setHeader("PAYMENT-REQUIRED", paymentRequiredHeader);
    res.writeHead(402);
    res.end(JSON.stringify({ error: "Payment required" }));
    return;
  }

  // 支払い済みリクエスト（ローカルでは署名検証をスキップ）→ 200 + コンテンツ
  res.setHeader("PAYMENT-RESPONSE", buildPaymentResponseHeader());

  if (pathname.startsWith("/sports")) {
    res.writeHead(200, { "Content-Type": "text/markdown" });
    res.end(generateSports());
  } else if (pathname.startsWith("/main.html")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(generateHtml());
  } else {
    // /weather（デフォルト）
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(generateWeather());
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 Local x402 mock server`);
  console.log(`   Port: http://localhost:${PORT}`);
  console.log(`   Routes: ${ALLOWED_TARGETS.join(", ")}`);
  console.log(`   Payment verification: DISABLED (local dev mode)`);
  console.log(`   Seller: ${LOCAL_SELLER_ADDRESS}`);
  console.log(`\n   [Ctrl+C で停止]\n`);
});
