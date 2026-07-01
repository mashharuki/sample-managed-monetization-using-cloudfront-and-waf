import {
  BASE_SEPOLIA_CHAIN_ID,
  BASE_SEPOLIA_USDC,
  CIRCLE_FAUCET_URL,
  PROXY_PATH,
} from "./constants";
import type { RouteSpec } from "./routes";

/** パス文字列を WAF メトリクス/ルール名として使える安全なトークンに変換。
 *  例: "/main.html" → "main-html" */
export function metricToken(path: string): string {
  return path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-");
}

/** Vite サイトビルドのシェルコマンドを生成する。
 *  CDK の localBundling.tryBundle(outputDir) 内で execSync に渡す。 */
export function buildBundleCommand(outputDir: string): string {
  return [
    "npm ci --no-audit --no-fund || npm install --no-audit --no-fund",
    "npm run build",
    `cp -r dist/. ${outputDir}/`,
  ].join(" && ");
}

/** buildConfigJs に渡すパラメータ。 */
export interface ConfigJsParams {
  /** CloudFront ディストリビューションの HTTPS ベース URL。 */
  baseUrl: string;
  /** 収益化ルートの配列（ROUTES をそのまま渡す）。 */
  routes: RouteSpec[];
  /** 販売者の受取ウォレットアドレス（Base Sepolia）。 */
  sellerPayTo: string;
  /** WAF WebACL の名前（コンソール URL 生成用）。 */
  webAclName: string;
  /** WAF WebACL の ID（コンソール URL 生成用）。 */
  webAclId: string;
}

/** SPA が読み込む config.js の内容を生成する。
 *  WAF コンソールへのディープリンク URL の構築も含む。 */
export function buildConfigJs(params: ConfigJsParams): string {
  const { baseUrl, routes, sellerPayTo, webAclName, webAclId } = params;
  const region = "us-east-1";
  const routeEntries = routes.map((r) => ({
    path: r.path,
    label: r.label,
    contentType: r.contentType,
  }));
  return [
    "window.X402_CONFIG = {",
    `  baseUrl: ${JSON.stringify(baseUrl)},`,
    `  routes: ${JSON.stringify(routeEntries)},`,
    `  proxyPath: ${JSON.stringify(PROXY_PATH)},`,
    `  payTo: "${sellerPayTo}",`,
    `  usdcAddress: ${JSON.stringify(BASE_SEPOLIA_USDC)},`,
    `  chainId: ${BASE_SEPOLIA_CHAIN_ID},`,
    `  faucetUrl: ${JSON.stringify(CIRCLE_FAUCET_URL)},`,
    `  wafMonetizationUrl: "https://${region}.console.aws.amazon.com/wafv2-pro/ai-revenue-payments/${webAclName}/${webAclId}?region=${region}&scope=global",`,
    `  wafTrafficUrl: "https://${region}.console.aws.amazon.com/wafv2-pro/protections/${webAclName}/${webAclId}/ai-traffic?region=${region}&scope=global"`,
    "};",
  ].join("\n");
}
