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

// Injected at deploy by CDK as /config.js (loaded before the bundle).
export const config: AppConfig = (window as unknown as { X402_CONFIG: AppConfig })
  .X402_CONFIG;

// Default simulated clients — a mix of AI crawlers/agents, a browser, and curl, so
// a demo shows variety in the WAF console. Users can add their own (localStorage).
export const DEFAULT_USER_AGENTS = [
  "GPTBot/1.0 (+https://openai.com/gptbot)",
  "ClaudeBot/1.0 (+https://www.anthropic.com/claude-bot)",
  "PerplexityBot/1.0 (+https://perplexity.ai/bot)",
  "Googlebot/2.1 (+http://www.google.com/bot.html)",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  "curl/8.4.0",
];
