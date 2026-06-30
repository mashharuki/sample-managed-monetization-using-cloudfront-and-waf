/**
 * 薄い UA プロキシ — ブラウザができない唯一のこと：本物の `User-Agent` を設定すること。
 *
 * ブラウザがトラフィックバースト全体を制御します（ループ、ジッター、並列処理）。
 * 各リクエストでブラウザは `/proxy?target=/weather&ua=<client>` としてこのプロキシを呼び出します。
 * プロキシは同じディストリビューション上のターゲットパスへ、その UA を本物の `User-Agent`
 * ヘッダーとして使って正確に 1 つの GET を再発行します。これにより AWS WAF Bot Control が
 * 真の GPTBot/ClaudeBot 等として認識し、AI トラフィックビューでラベル付けします。
 * 上流の STATUS のみを返します（ボディは返しません — 未払い呼び出しはいずれにせよ
 * コンテンツのない 402 です）。そのため有料コンテンツを解放することは決してありません。
 *
 * CloudFront 経由でのみアクセス可能（Function URL は IAM 認証 + OAC）。パブリックではありません。
 */
const ALLOWED_TARGETS = (process.env.ALLOWED_TARGETS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = async (event: any) => {
  const qs = event.queryStringParameters ?? {};
  const target = String(qs.target ?? "");
  const ua = String(qs.ua ?? "x402-sim/1.0");

  const cors = { "access-control-allow-origin": "*", "content-type": "application/json" };

  // 設定済みの収益化パスのみ許可（オープンプロキシにしない）。
  if (!ALLOWED_TARGETS.includes(target)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: `target not allowed: ${target}` }) };
  }

  // ブラウザは自身のページオリジン（CloudFront ドメイン）を `origin` として渡します。
  // デプロイ時の環境変数としては注入しません（それをすると Lambda と Distribution の間に
  // CDK の循環依存が生じるためです）。プロキシは同じディストリビューションを経由してループバック
  // するため WAF が実行されます。安全のため *.cloudfront.net のみに制限します。
  const origin = String(qs.origin ?? "");
  if (!/^https:\/\/[a-z0-9.-]+\.cloudfront\.net$/i.test(origin)) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ error: `不正なオリジン: ${origin}` }) };
  }
  // 各呼び出しがキャッシュされた繰り返しではなく、個別のエッジリクエストになるようにキャッシュバスト。
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
