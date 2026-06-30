// 開発専用フォールバック設定。デプロイ時に CDK が実際の config.js（ライブ CloudFront URL、
// WebACL コンソールリンク、販売者 payTo を含む）を S3 にアップロードしてこれを上書きします。
// Vite が public/ を dist/ にコピーするため、`npm run dev` と素のビルドでも読み込まれます。
window.X402_CONFIG = {
  baseUrl: "https://example.cloudfront.net",
  proxyPath: "/proxy",
  routes: [
    { path: "/weather", label: "Weather (JSON)", contentType: "json" },
    { path: "/sports", label: "Sports (Markdown)", contentType: "markdown" },
    { path: "/main.html", label: "Landing (HTML)", contentType: "html" },
  ],
  payTo: "0xe6AA1B60c4EC760668dB3C06d7A894c5Fd39D0aa",
  usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  chainId: 84532,
  faucetUrl: "https://faucet.circle.com/",
  wafMonetizationUrl: "https://console.aws.amazon.com/wafv2/home",
  wafTrafficUrl: "https://console.aws.amazon.com/wafv2/home",
};
