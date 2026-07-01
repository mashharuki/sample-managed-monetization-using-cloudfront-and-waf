/** CfnOutput の description 文字列。 */
export const OUTPUT_DESCRIPTIONS = {
  DISTRIBUTION_URL: "これを開いてください — 購入者ページ（無料ランディング + x402 デモ）。",
  PAID_ENDPOINTS: "有料エンドポイント。`curl -i` で WAF の生の 402 レスポンスを確認できます。",
  SELLER_PAY_TO: "WAF が支払いを決済するアドレス（Base Sepolia テストネット）。",
  FAUCET_URL: "ここでブラウザ内の購入者ウォレットにテストネット USDC を補充します。",
  WAF_MONETIZATION_CONSOLE: "AWS WAF コンソール — この WebACL の AI 収益/収益化ビュー。",
  WAF_TRAFFIC_CONSOLE: "AWS WAF コンソール — この WebACL のライブ AI トラフィック。",
} as const;

/** localBundling などで throw するエラーメッセージ。 */
export const ERROR_MESSAGES = {
  NO_NODE:
    "サイトのビルドにはローカルの Node.js ツールチェーン（node + npx）が必要です。" +
    "Node.js 24 以上をインストールして `cdk deploy` を再実行してください。",
} as const;

/** CDK リソース（CloudFront Function / CachePolicy / Distribution）の comment 文字列。 */
export const RESOURCE_COMMENTS = {
  EDGE_FUNCTION: "x402 サンプル — モック有料コンテンツ（WAF 支払い検証後に実行）",
  EDGE_CACHE_POLICY: "ビューワーの国情報をエッジ CloudFront Function に転送。キャッシュなし。",
  DISTRIBUTION: "x402 WAF 収益化サンプル",
} as const;
