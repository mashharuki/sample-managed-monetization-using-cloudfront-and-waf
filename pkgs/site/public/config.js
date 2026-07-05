// ローカル開発用設定（floci local dev mode）。
// `pnpm dev:local` 実行時に Vite dev server からこのファイルが提供されます。
// 本番 CDK デプロイ時は BucketDeployment の Source.data() が S3 上のこのファイルを上書きします。
// baseUrl は pkgs/local-server の x402 モックサーバーを指します。
window.X402_CONFIG = {
  baseUrl: "http://localhost:3001",
  proxyPath: "/proxy",
  routes: [
    { path: "/weather", label: "Weather (JSON)", contentType: "json" },
    { path: "/sports", label: "Sports (Markdown)", contentType: "markdown" },
    { path: "/main.html", label: "Landing (HTML)", contentType: "html" },
  ],
  payTo: "0x6A93800ADEd9E1f8a8c973145Ec19360598E7487",
  usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  chainId: 84532,
  faucetUrl: "https://faucet.circle.com/",
  wafMonetizationUrl: "http://localhost:3001",
  wafTrafficUrl: "http://localhost:3001",
};
