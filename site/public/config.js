// DEV-ONLY fallback config. At deploy, CDK uploads a real config.js (with the live
// CloudFront URL, WebACL console links, and seller payTo) that OVERRIDES this in S3.
// Vite copies public/ into dist/, so `npm run dev` and a bare build still load.
window.X402_CONFIG = {
  baseUrl: "https://example.cloudfront.net",
  proxyPath: "/proxy",
  routes: [
    { path: "/weather", label: "Weather (JSON)", contentType: "json" },
    { path: "/sports", label: "Sports (Markdown)", contentType: "markdown" },
    { path: "/main.html", label: "Landing (HTML)", contentType: "html" },
  ],
  payTo: "0x0000000000000000000000000000000000000000",
  usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  chainId: 84532,
  faucetUrl: "https://faucet.circle.com/",
  wafMonetizationUrl: "https://console.aws.amazon.com/wafv2/home",
  wafTrafficUrl: "https://console.aws.amazon.com/wafv2/home",
};
