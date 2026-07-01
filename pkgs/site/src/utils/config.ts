import type { Address } from "viem";

export type RouteConfig = {
  path: string;
  label: string;
  contentType: "json" | "markdown" | "html";
};

export type AppConfig = {
  baseUrl: string;
  proxyPath: string;
  routes: RouteConfig[];
  payTo: string;
  usdcAddress: Address;
  chainId: number;
  faucetUrl: string;
  wafMonetizationUrl: string;
  wafTrafficUrl: string;
};

// CDK によりデプロイ時に /config.js として注入されます（バンドルより先に読み込まれます）。
export const config: AppConfig = (window as unknown as { X402_CONFIG: AppConfig }).X402_CONFIG;

// デフォルトのシミュレートクライアント — AI クローラー/エージェント、ブラウザ、curl の組み合わせで、
// デモが WAF コンソールで多様性を示せます。ユーザーが独自のものを追加できます（localStorage）。
export const DEFAULT_USER_AGENTS = [
  "GPTBot/1.0 (+https://openai.com/gptbot)",
  "ClaudeBot/1.0 (+https://www.anthropic.com/claude-bot)",
  "PerplexityBot/1.0 (+https://perplexity.ai/bot)",
  "Googlebot/2.1 (+http://www.google.com/bot.html)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  "curl/8.4.0",
];
