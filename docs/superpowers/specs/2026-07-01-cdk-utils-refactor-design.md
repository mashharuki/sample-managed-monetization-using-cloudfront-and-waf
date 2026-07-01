# CDK utils リファクタリング設計

**日付:** 2026-07-01  
**対象:** `pkgs/cdk/`  
**目的:** `monetization-stack.ts` に散在する定数・メッセージ・ユーティリティ関数を `utils/` 配下の専用ファイルに外出しし、スタックファイルをインフラ構成の記述に集中させる。

---

## 採用アプローチ

**直接インポート方式（Flat 3-file split）**  
バレルエクスポート（`utils/index.ts`）は追加しない。消費者が実質 `monetization-stack.ts` 1ファイルのみのため、余分な間接層は不要。

---

## ファイル構成（変更後）

```
pkgs/cdk/
├── bin/app.ts                     変更なし
├── cff/edge.js                    変更なし（lib/ から移動済み）
├── lib/
│   ├── monetization-stack.ts      定数・関数・文字列をすべて utils から import
│   ├── monetize/monetization.ts   BASE_SEPOLIA_USDC/BOT_CONTROL_VERSION を utils から import
│   └── proxy/handler.ts           変更なし
└── utils/
    ├── constants.ts               ★ 新規（全定数）
    ├── helpers.ts                 ★ 新規（ユーティリティ関数）
    ├── messages.ts                ★ 新規（文字列リテラル）
    ├── routes.ts                  既存（lib/ から移動済み）
    └── seller-payto.ts            既存（lib/ から移動済み）
```

---

## Section 1: `utils/constants.ts`

```typescript
// ── チェーン / 決済 ──────────────────────────────────────────
export const BASE_SEPOLIA_USDC     = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const BOT_CONTROL_VERSION   = "Version_6.0";
export const DEFAULT_PRICE_USDC    = "0.001";

// ── URL ──────────────────────────────────────────────────────
export const CIRCLE_FAUCET_URL = "https://faucet.circle.com/";

// ── サイトバンドル ────────────────────────────────────────────
export const SITE_BUNDLE_DOCKER_IMAGE = "public.ecr.aws/sam/build-nodejs24.x:1.149.0";

// ── CloudFront ───────────────────────────────────────────────
export const VIEWER_COUNTRY_HEADER = "CloudFront-Viewer-Country";
export const PROXY_PATH            = "/proxy";
export const CACHE_DEFAULT_TTL_SEC = 0;
export const CACHE_MAX_TTL_SEC     = 1;

// ── Lambda ───────────────────────────────────────────────────
export const PROXY_TIMEOUT_SEC = 15;
```

**移動元:**
- `monetization-stack.ts`: `CIRCLE_FAUCET_URL`, `OUTDIR`（helpers 化により不要になる）
- `monetize/monetization.ts`: `BASE_SEPOLIA_USDC`, `BOT_CONTROL_VERSION`

---

## Section 2: `utils/helpers.ts`

### `metricToken`
パス文字列を WAF メトリクス/ルール名として使える安全なトークンに変換。

```typescript
export function metricToken(path: string): string {
  return path.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-");
}
```

### `buildBundleCommand`
サイトビルドシェルコマンドを生成。現在の `bundleScript` 配列 + `OUTDIR` 置換ロジックを吸収。  
`OUTDIR` 定数はこの関数内に畳み込まれるため `constants.ts` には不要。

```typescript
export function buildBundleCommand(outputDir: string): string {
  return [
    "npm ci --no-audit --no-fund || npm install --no-audit --no-fund",
    "npm run build",
    `cp -r dist/. ${outputDir}/`,
  ].join(" && ");
}
```

スタック側 `tryBundle` の呼び出し箇所:
```typescript
execSync(buildBundleCommand(outputDir), { cwd: siteDir, stdio: "inherit" });
```

### `buildConfigJs`
`config.js` の文字列生成と WAF コンソール URL 構築を1関数に集約。

```typescript
import {
  BASE_SEPOLIA_USDC, BASE_SEPOLIA_CHAIN_ID,
  CIRCLE_FAUCET_URL, PROXY_PATH,
} from "./constants";
import type { RouteSpec } from "./routes";

export interface ConfigJsParams {
  baseUrl: string;
  routes: RouteSpec[];
  sellerPayTo: string;
  webAclName: string;
  webAclId: string;
}

export function buildConfigJs(params: ConfigJsParams): string {
  const { baseUrl, routes, sellerPayTo, webAclName, webAclId } = params;
  const region = "us-east-1";
  return [
    "window.X402_CONFIG = {",
    `  baseUrl: ${JSON.stringify(baseUrl)},`,
    `  routes: ${JSON.stringify(routes.map((r) => ({ path: r.path, label: r.label, contentType: r.contentType })))},`,
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
```

スタック側の呼び出し箇所:
```typescript
Source.data("config.js", buildConfigJs({
  baseUrl,
  routes: ROUTES,
  sellerPayTo,
  webAclName: webAcl.name,
  webAclId: webAcl.attrId,
}))
```

---

## Section 3: `utils/messages.ts`

```typescript
export const OUTPUT_DESCRIPTIONS = {
  DISTRIBUTION_URL:         "これを開いてください — 購入者ページ（無料ランディング + x402 デモ）。",
  PAID_ENDPOINTS:           "有料エンドポイント。`curl -i` で WAF の生の 402 レスポンスを確認できます。",
  SELLER_PAY_TO:            "WAF が支払いを決済するアドレス（Base Sepolia テストネット）。",
  FAUCET_URL:               "ここでブラウザ内の購入者ウォレットにテストネット USDC を補充します。",
  WAF_MONETIZATION_CONSOLE: "AWS WAF コンソール — この WebACL の AI 収益/収益化ビュー。",
  WAF_TRAFFIC_CONSOLE:      "AWS WAF コンソール — この WebACL のライブ AI トラフィック。",
} as const;

export const ERROR_MESSAGES = {
  NO_NODE: "サイトのビルドにはローカルの Node.js ツールチェーン（node + npx）が必要です。Node.js 24 以上をインストールして `cdk deploy` を再実行してください。",
} as const;

export const RESOURCE_COMMENTS = {
  EDGE_FUNCTION:     "x402 サンプル — モック有料コンテンツ（WAF 支払い検証後に実行）",
  EDGE_CACHE_POLICY: "ビューワーの国情報をエッジ CloudFront Function に転送。キャッシュなし。",
  DISTRIBUTION:      "x402 WAF 収益化サンプル",
} as const;
```

---

## Section 4: 既存ファイルへの変更

### `monetization-stack.ts`

**削除:** `CIRCLE_FAUCET_URL`, `OUTDIR`, `metricToken` 関数定義、`bundleScript` 配列、config.js 生成ブロック、全 description/comment/error 文字列リテラル

**追加 import:**
```typescript
import {
  BASE_SEPOLIA_USDC, BASE_SEPOLIA_CHAIN_ID, CIRCLE_FAUCET_URL,
  SITE_BUNDLE_DOCKER_IMAGE, VIEWER_COUNTRY_HEADER, PROXY_PATH,
  CACHE_DEFAULT_TTL_SEC, CACHE_MAX_TTL_SEC, PROXY_TIMEOUT_SEC,
} from "../utils/constants";
import { metricToken, buildBundleCommand, buildConfigJs } from "../utils/helpers";
import { OUTPUT_DESCRIPTIONS, ERROR_MESSAGES, RESOURCE_COMMENTS } from "../utils/messages";
import { resolveSellerPayTo } from "../utils/seller-payto";
```

### `monetize/monetization.ts`

`BASE_SEPOLIA_USDC`・`BOT_CONTROL_VERSION` の `export const` を削除し、`utils/constants` から import に変更。ロジック本体は無変更。

### `tsconfig.json`

```json
"include": ["bin/**/*.ts", "lib/**/*.ts", "utils/**/*.ts"]
```

`utils/routes.ts` 個別指定 → `utils/**/*.ts` に拡張。

### `bin/app.ts`

変更なし。`"us-east-1"` はスタック固有の設定値のため定数化対象外。

---

## 変更しないもの

- `cff/edge.js` — JS_2_0 ランタイム用スタンドアロンファイル（`lib/` から移動済み）。TypeScript の import/export が使えないため utils 連携の対象外
- `lib/proxy/handler.ts` — 共有定数を持たない独立 Lambda
- `bin/app.ts` — リージョン指定はスタック固有設定

---

## 完了の定義

1. `utils/` 4ファイル（constants / helpers / messages / routes）が正しく export を持つ
2. `monetization-stack.ts` がインフラ構成の記述のみになる（文字列リテラル・ローカル関数ゼロ）
3. `monetize/monetization.ts` が utils から import するだけになる
4. `pnpm synth` がエラーなく通る
