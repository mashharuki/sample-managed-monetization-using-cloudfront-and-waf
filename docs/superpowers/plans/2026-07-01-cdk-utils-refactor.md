# CDK utils リファクタリング実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pkgs/cdk/` の定数・メッセージ・ユーティリティ関数を `utils/` の専用ファイルに外出しし、`monetization-stack.ts` をインフラ構成の記述のみに絞る。

**Architecture:** `utils/constants.ts` に全定数、`utils/helpers.ts` に変換・生成関数 3 本、`utils/messages.ts` に文字列リテラルを集約する。消費者は `monetization-stack.ts` と `monetize/monetization.ts` の 2 ファイルのみで、直接 import する（バレル不使用）。

**Tech Stack:** TypeScript 6, aws-cdk-lib 2.260.0, pnpm workspaces

## Global Constraints

- TypeScript strict モード必須（`tsconfig.json` の `strict: true`）
- コメントは日本語（既存コードベースに合わせる）
- テストスイートなし。検証コマンドは `pnpm synth`（`pkgs/cdk/` で `npx cdk synth` 相当）
- Biome フォーマット: 2-space indent, 100-char line width, double quotes, trailing commas, semicolons
- `pnpm synth` が通ることが各タスク完了の定義

---

## ファイルマップ

| 操作 | ファイル |
|------|---------|
| 新規作成 | `pkgs/cdk/utils/constants.ts` |
| 新規作成 | `pkgs/cdk/utils/helpers.ts` |
| 新規作成 | `pkgs/cdk/utils/messages.ts` |
| 修正 | `pkgs/cdk/lib/monetize/monetization.ts` |
| 修正 | `pkgs/cdk/lib/monetization-stack.ts` |
| 修正 | `pkgs/cdk/tsconfig.json` |

---

## Task 1: `utils/constants.ts` を実装する

**Files:**
- Modify: `pkgs/cdk/utils/constants.ts`（現在空ファイル）

**Interfaces:**
- Produces:
  - `BASE_SEPOLIA_USDC: string`
  - `BASE_SEPOLIA_CHAIN_ID: number`
  - `BOT_CONTROL_VERSION: string`
  - `DEFAULT_PRICE_USDC: string`
  - `CIRCLE_FAUCET_URL: string`
  - `SITE_BUNDLE_DOCKER_IMAGE: string`
  - `VIEWER_COUNTRY_HEADER: string`
  - `PROXY_PATH: string`
  - `CACHE_DEFAULT_TTL_SEC: number`
  - `CACHE_MAX_TTL_SEC: number`
  - `PROXY_TIMEOUT_SEC: number`

- [ ] **Step 1: `utils/constants.ts` を書く**

```typescript
// ── チェーン / 決済 ──────────────────────────────────────────
/** Base Sepolia USDC コントラクト — 購入者が支払いに使用するトークン。 */
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
/** Base Sepolia のチェーン ID。 */
export const BASE_SEPOLIA_CHAIN_ID = 84532;
/** Bot Control マネージドルールグループのバージョン。v6 以上必須（AI トラフィックラベル対応）。 */
export const BOT_CONTROL_VERSION = "Version_6.0";
/** WAF Monetize ルールのデフォルト基本価格（USDC）。 */
export const DEFAULT_PRICE_USDC = "0.001";

// ── URL ──────────────────────────────────────────────────────
/** Circle テストネットフォーセット。ページから資金補充のためにディープリンクします。 */
export const CIRCLE_FAUCET_URL = "https://faucet.circle.com/";

// ── サイトバンドル ────────────────────────────────────────────
/** BucketDeployment のフォールバック用 Docker イメージ（実質未使用）。 */
export const SITE_BUNDLE_DOCKER_IMAGE = "public.ecr.aws/sam/build-nodejs24.x:1.149.0";

// ── CloudFront ───────────────────────────────────────────────
/** エッジ CloudFront Function に転送するビューワー国ヘッダー名。 */
export const VIEWER_COUNTRY_HEADER = "CloudFront-Viewer-Country";
/** UA プロキシの CloudFront ビヘイビアパス。 */
export const PROXY_PATH = "/proxy";
/** 有料ルート用キャッシュポリシーのデフォルト / 最小 TTL（秒）。 */
export const CACHE_DEFAULT_TTL_SEC = 0;
/** 有料ルート用キャッシュポリシーの最大 TTL（秒）。 */
export const CACHE_MAX_TTL_SEC = 1;

// ── Lambda ───────────────────────────────────────────────────
/** UA プロキシ Lambda のタイムアウト（秒）。 */
export const PROXY_TIMEOUT_SEC = 15;
```

- [ ] **Step 2: `tsconfig.json` を更新して utils/ をコンパイル対象に含める**

`pkgs/cdk/tsconfig.json` の `include` を以下に変更する（`utils/routes.ts` 個別指定 → `utils/**/*.ts` に拡張）:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "ignoreDeprecations": "6.0",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["bin/**/*.ts", "lib/**/*.ts", "utils/**/*.ts"],
  "exclude": ["node_modules", "cdk.out"]
}
```

- [ ] **Step 3: 型チェックが通ることを確認する**

```bash
cd /Users/harukikondo/git/sample-managed-monetization-using-cloudfront-and-waf/pkgs/cdk
npx tsc --noEmit
```

期待: エラーなし（`utils/constants.ts` 単体は何も import しないので通るはず）

- [ ] **Step 4: commit する**

```bash
git add pkgs/cdk/utils/constants.ts pkgs/cdk/tsconfig.json
git commit -m "feat: utils/constants.ts に全定数を集約"
```

---

## Task 2: `utils/helpers.ts` を実装する

**Files:**
- Modify: `pkgs/cdk/utils/helpers.ts`（現在空ファイル）

**Interfaces:**
- Consumes: `BASE_SEPOLIA_USDC`, `BASE_SEPOLIA_CHAIN_ID`, `CIRCLE_FAUCET_URL`, `PROXY_PATH` from `./constants`; `RouteSpec` from `./routes`
- Produces:
  - `metricToken(path: string): string`
  - `buildBundleCommand(outputDir: string): string`
  - `ConfigJsParams` interface
  - `buildConfigJs(params: ConfigJsParams): string`

- [ ] **Step 1: `utils/helpers.ts` を書く**

```typescript
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
```

- [ ] **Step 2: 型チェックが通ることを確認する**

```bash
cd /Users/harukikondo/git/sample-managed-monetization-using-cloudfront-and-waf/pkgs/cdk
npx tsc --noEmit
```

期待: エラーなし

- [ ] **Step 3: commit する**

```bash
git add pkgs/cdk/utils/helpers.ts
git commit -m "feat: utils/helpers.ts に metricToken / buildBundleCommand / buildConfigJs を追加"
```

---

## Task 3: `utils/messages.ts` を実装する

**Files:**
- Modify: `pkgs/cdk/utils/messages.ts`（現在空ファイル）

**Interfaces:**
- Produces:
  - `OUTPUT_DESCRIPTIONS` オブジェクト（キー: `DISTRIBUTION_URL` | `PAID_ENDPOINTS` | `SELLER_PAY_TO` | `FAUCET_URL` | `WAF_MONETIZATION_CONSOLE` | `WAF_TRAFFIC_CONSOLE`）
  - `ERROR_MESSAGES` オブジェクト（キー: `NO_NODE`）
  - `RESOURCE_COMMENTS` オブジェクト（キー: `EDGE_FUNCTION` | `EDGE_CACHE_POLICY` | `DISTRIBUTION`）

- [ ] **Step 1: `utils/messages.ts` を書く**

```typescript
/** CfnOutput の description 文字列。 */
export const OUTPUT_DESCRIPTIONS = {
  DISTRIBUTION_URL:
    "これを開いてください — 購入者ページ（無料ランディング + x402 デモ）。",
  PAID_ENDPOINTS:
    "有料エンドポイント。`curl -i` で WAF の生の 402 レスポンスを確認できます。",
  SELLER_PAY_TO:
    "WAF が支払いを決済するアドレス（Base Sepolia テストネット）。",
  FAUCET_URL:
    "ここでブラウザ内の購入者ウォレットにテストネット USDC を補充します。",
  WAF_MONETIZATION_CONSOLE:
    "AWS WAF コンソール — この WebACL の AI 収益/収益化ビュー。",
  WAF_TRAFFIC_CONSOLE:
    "AWS WAF コンソール — この WebACL のライブ AI トラフィック。",
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
```

- [ ] **Step 2: 型チェックが通ることを確認する**

```bash
cd /Users/harukikondo/git/sample-managed-monetization-using-cloudfront-and-waf/pkgs/cdk
npx tsc --noEmit
```

期待: エラーなし

- [ ] **Step 3: commit する**

```bash
git add pkgs/cdk/utils/messages.ts
git commit -m "feat: utils/messages.ts に CfnOutput description / エラー / コメント文字列を追加"
```

---

## Task 4: `monetize/monetization.ts` を utils から import するよう更新する

**Files:**
- Modify: `pkgs/cdk/lib/monetize/monetization.ts`

**Interfaces:**
- Consumes: `BASE_SEPOLIA_USDC`, `BOT_CONTROL_VERSION`, `DEFAULT_PRICE_USDC` from `../../utils/constants`
- Produces: `buildRules`, `monetizationConfig`, `MonetizeRoute`, `MonetizeInput`（インターフェースは変更なし）

- [ ] **Step 1: `monetize/monetization.ts` を書き換える**

ファイル冒頭の `export const BASE_SEPOLIA_USDC` と `export const BOT_CONTROL_VERSION` を削除し、utils から import に変える。`baseAmount ?? "0.001"` を `DEFAULT_PRICE_USDC` に置き換える。ロジック本体は変更なし。

```typescript
/**
 * AWS WAF ネイティブ x402 収益化 — ルールと設定を純粋な CloudFormation
 * プロパティオブジェクトとして定義します。
 *
 * `MonetizationConfig` と `Monetize` ルールアクションは CloudFormation
 * (AWS::WAFv2::WebACL) でサポートされていますが、この aws-cdk-lib バージョンの
 * 型付き CDK L1 (`CfnWebACL`) にはまだ公開されていないため、スタックは
 * `addPropertyOverride` 経由で注入します。カスタムリソースも実行時 API 呼び出しも
 * 不要で、すべてが 1 つの合成済みテンプレートに含まれています。
 *
 * ポスチャは意図的に最小構成です：
 *   - デフォルトアクション = Allow（"/" のランディングページは無料）
 *   - /weather に 1 つの Monetize ルール → すべてのリクエストが 402 → 支払い → 200
 */
import {
  BOT_CONTROL_VERSION,
  DEFAULT_PRICE_USDC,
} from "../../utils/constants";

export interface MonetizeRoute {
  /** マッチする URI プレフィックス（例: "/weather"）。 */
  path: string;
  /** 価格乗数 × ベース Amount。 */
  priceMultiplier: number;
  /** メトリクス/ルール名に使える安全なトークン（例: "weather", "main-html"）。 */
  metricName: string;
}

export interface MonetizeInput {
  /** MonetizationConfig 用の受取人ウォレット（販売者の受取アドレス）。 */
  walletAddress: string;
  /** USDC の基本単価。デフォルト 0.001。 */
  baseAmount?: string;
  /** CloudWatch の可視性のためのメトリクス名プレフィックス。 */
  metricPrefix: string;
  /** 収益化するルート（それぞれ 1 つの Monetize ルール）。 */
  routes: MonetizeRoute[];
}

/** ルール 0 — Bot Control マネージドグループ（v6、Count: 検出+ラベルのみ、ブロックなし）。
 *  WAF AI トラフィックビューにボットの組織/カテゴリ/検証ラベルを提供します。 */
function botControlRule(metricPrefix: string): Record<string, unknown> {
  return {
    Name: "AWSBotControl",
    Priority: 0,
    Statement: {
      ManagedRuleGroupStatement: {
        VendorName: "AWS",
        Name: "AWSManagedRulesBotControlRuleSet",
        Version: BOT_CONTROL_VERSION,
        ManagedRuleGroupConfigs: [
          { AWSManagedRulesBotControlRuleSet: { InspectionLevel: "COMMON" } },
        ],
      },
    },
    OverrideAction: { Count: {} },
    VisibilityConfig: {
      SampledRequestsEnabled: true,
      CloudWatchMetricsEnabled: true,
      MetricName: `${metricPrefix}-bot-control`,
    },
  };
}

/** 最初に Bot Control v6 (Count)、次にルートごとに 1 つの終端 Monetize ルール。 */
export function buildRules(input: MonetizeInput): Array<Record<string, unknown>> {
  const rules: Array<Record<string, unknown>> = [botControlRule(input.metricPrefix)];
  input.routes.forEach((route, i) => {
    rules.push({
      Name: `Monetize-${route.metricName}`,
      // 優先度 0 は Bot Control。Monetize ルールは 1 から始まります。
      Priority: i + 1,
      Statement: {
        ByteMatchStatement: {
          // CloudFormation は生の検索文字列を受け取り、WAF API 用に base64 エンコードします。
          // ここで事前エンコードしないでください（二重エンコードになりルールが一致しなくなります）。
          // これは base64 を要求する生の UpdateWebACL API とは異なります。
          SearchString: route.path,
          FieldToMatch: { UriPath: {} },
          TextTransformations: [{ Priority: 0, Type: "NONE" }],
          PositionalConstraint: "STARTS_WITH",
        },
      },
      Action: { Monetize: { PriceMultiplier: String(route.priceMultiplier) } },
      VisibilityConfig: {
        SampledRequestsEnabled: true,
        CloudWatchMetricsEnabled: true,
        MetricName: `${input.metricPrefix}-monetize-${route.metricName}`,
      },
    });
  });
  return rules;
}

/** WebACL レベルの MonetizationConfig：受取人ウォレット、チェーン、基本価格、テストネットモード。 */
export function monetizationConfig(input: MonetizeInput): Record<string, unknown> {
  return {
    CryptoConfig: {
      PaymentNetworks: [
        {
          Chain: "BASE_SEPOLIA",
          WalletAddress: input.walletAddress,
          Prices: [{ Amount: input.baseAmount ?? DEFAULT_PRICE_USDC, Currency: "USDC" }],
        },
      ],
    },
    CurrencyMode: "TEST",
  };
}
```

- [ ] **Step 2: 型チェックが通ることを確認する**

```bash
cd /Users/harukikondo/git/sample-managed-monetization-using-cloudfront-and-waf/pkgs/cdk
npx tsc --noEmit
```

期待: エラーなし

- [ ] **Step 3: commit する**

```bash
git add pkgs/cdk/lib/monetize/monetization.ts
git commit -m "refactor: monetization.ts の定数を utils/constants から import に変更"
```

---

## Task 5: `monetization-stack.ts` を utils から import するよう更新する

**Files:**
- Modify: `pkgs/cdk/lib/monetization-stack.ts`

**Interfaces:**
- Consumes:
  - `utils/constants`: `CIRCLE_FAUCET_URL`, `SITE_BUNDLE_DOCKER_IMAGE`, `VIEWER_COUNTRY_HEADER`, `CACHE_DEFAULT_TTL_SEC`, `CACHE_MAX_TTL_SEC`, `PROXY_TIMEOUT_SEC`
  - `utils/helpers`: `metricToken(path: string): string`, `buildBundleCommand(outputDir: string): string`, `buildConfigJs(params: ConfigJsParams): string`
  - `utils/messages`: `OUTPUT_DESCRIPTIONS`, `ERROR_MESSAGES`, `RESOURCE_COMMENTS`
  - `utils/seller-payto`: `resolveSellerPayTo()` (既存 import のパス更新のみ — Task 1 で変更済み)
  - `utils/routes`: `ROUTES` (既存 import — 変更なし)
  - `monetize/monetization`: `buildRules`, `monetizationConfig` (変更なし)
- Produces: `MonetizationStack` class（外部インターフェースは変更なし）

> **注意:** `cff/edge.js` は `lib/cff/` から `pkgs/cdk/cff/` に移動済み。
> `__dirname` は `lib/` を指すため、現在の `path.join(__dirname, "cff", "edge.js")` は壊れている。
> このタスクで `path.join(__dirname, "..", "cff", "edge.js")` に修正する。

- [ ] **Step 1: `monetization-stack.ts` を書き換える**

ファイル全体を以下の内容に置き換える:

```typescript
import {
  CfnOutput,
  DockerImage,
  Duration,
  type ILocalBundling,
  RemovalPolicy,
  Stack,
  type StackProps,
} from "aws-cdk-lib";
import {
  AllowedMethods,
  CacheHeaderBehavior,
  CachePolicy,
  Function as CfFunction,
  Distribution,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  OriginRequestPolicy,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { FunctionUrlOrigin, S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { FunctionUrlAuthType, InvokeMode, Runtime as LambdaRuntime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { BlockPublicAccess, Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import type { Construct } from "constructs";
import { execSync } from "node:child_process";
import * as path from "node:path";
import {
  CACHE_DEFAULT_TTL_SEC,
  CACHE_MAX_TTL_SEC,
  CIRCLE_FAUCET_URL,
  PROXY_TIMEOUT_SEC,
  SITE_BUNDLE_DOCKER_IMAGE,
  VIEWER_COUNTRY_HEADER,
} from "../utils/constants";
import { buildBundleCommand, buildConfigJs, metricToken } from "../utils/helpers";
import { ERROR_MESSAGES, OUTPUT_DESCRIPTIONS, RESOURCE_COMMENTS } from "../utils/messages";
import { ROUTES } from "../utils/routes";
import { resolveSellerPayTo } from "../utils/seller-payto";
import { buildRules, monetizationConfig } from "./monetize/monetization";

export class MonetizationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. S3 — 静的な購入者ページのオリジン。プライベートで、CloudFront OAC 経由でのみアクセス可能。
    const siteBucket = new Bucket(this, "SiteBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 2. 販売者の payTo — デプロイ時（CDK プロセス内）に一度生成されてローカルにキャッシュされる
    //    静的なテストネット受取アドレス。デプロイをまたいでも安定しています。
    const sellerPayTo = resolveSellerPayTo();

    // 3. CloudFront Function — モックの有料コンテンツを生成します（パスに応じて
    //    JSON / Markdown / HTML を返します）。WAF の後に実行されるため、支払い済みリクエストだけがここに到達します。
    const edgeFn = new CfFunction(this, "EdgeFunction", {
      runtime: FunctionRuntime.JS_2_0,
      // cff/ は lib/ の親（pkgs/cdk/cff/）に移動済みのため ".." を挟む。
      code: FunctionCode.fromFile({ filePath: path.join(__dirname, "..", "cff", "edge.js") }),
      comment: RESOURCE_COMMENTS.EDGE_FUNCTION,
    });

    // 4. 有料ルート用のキャッシュポリシー。CloudFront-Viewer-Country をエッジ関数に転送します。
    const edgeCachePolicy = new CachePolicy(this, "EdgeCachePolicy", {
      comment: RESOURCE_COMMENTS.EDGE_CACHE_POLICY,
      defaultTtl: Duration.seconds(CACHE_DEFAULT_TTL_SEC),
      minTtl: Duration.seconds(CACHE_DEFAULT_TTL_SEC),
      maxTtl: Duration.seconds(CACHE_MAX_TTL_SEC),
      headerBehavior: CacheHeaderBehavior.allowList(VIEWER_COUNTRY_HEADER),
    });

    // 5. WAF WebACL — MonetizationConfig と Monetize ルールアクションは aws-cdk-lib では
    //    まだ型定義されていないため addPropertyOverride 経由で注入します。
    const webAcl = new CfnWebACL(this, "WebACL", {
      name: `${id}-acl`,
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${id}-acl`,
      },
      rules: [], // 後で注入（Monetize アクションはまだ型定義されていない）
    });
    const metricPrefix = id.toLowerCase();

    const monetizeRoutes = ROUTES.map((r) => ({
      path: r.path,
      priceMultiplier: r.priceMultiplier,
      metricName: metricToken(r.path),
    }));
    webAcl.addPropertyOverride(
      "Rules",
      buildRules({ walletAddress: sellerPayTo, metricPrefix, routes: monetizeRoutes }),
    );
    webAcl.addPropertyOverride(
      "MonetizationConfig",
      monetizationConfig({ walletAddress: sellerPayTo, metricPrefix, routes: monetizeRoutes }),
    );

    // 6. CloudFront ディストリビューション。デフォルト "/" → S3（ページ）。
    const s3Origin = S3BucketOrigin.withOriginAccessControl(siteBucket);
    const distribution = new Distribution(this, "Distribution", {
      comment: RESOURCE_COMMENTS.DISTRIBUTION,
      defaultRootObject: "index.html",
      webAclId: webAcl.attrArn,
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: CachePolicy.CACHING_DISABLED,
      },
    });
    for (const route of ROUTES) {
      distribution.addBehavior(`${route.path}*`, s3Origin, {
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: edgeCachePolicy,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        functionAssociations: [{ function: edgeFn, eventType: FunctionEventType.VIEWER_REQUEST }],
      });
    }

    const baseUrl = `https://${distribution.distributionDomainName}`;

    // 6b. UA プロキシ — ブラウザが設定できない本物の User-Agent を WAF に送信するための Lambda。
    const proxyFn = new NodejsFunction(this, "UaProxyFunction", {
      entry: path.join(__dirname, "proxy", "handler.ts"),
      handler: "handler",
      runtime: LambdaRuntime.NODEJS_24_X,
      timeout: Duration.seconds(PROXY_TIMEOUT_SEC),
      environment: {
        ALLOWED_TARGETS: ROUTES.map((r) => r.path).join(","),
      },
      bundling: {
        minify: true,
        sourceMap: false,
        target: "es2022",
        externalModules: ["@aws-sdk/*"],
      },
    });
    const proxyUrl = proxyFn.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.BUFFERED,
    });
    const proxyOrigin = FunctionUrlOrigin.withOriginAccessControl(proxyUrl);
    distribution.addBehavior("/proxy*", proxyOrigin, {
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
    });

    // 7. サイトのデプロイ。CDK が Vite ビルドを実行し、config.js をデプロイ時に生成します。
    const siteDir = path.join(__dirname, "..", "..", "site");
    const localBundling: ILocalBundling = {
      tryBundle(outputDir: string): boolean {
        try {
          execSync("node --version && npx --version", { stdio: "ignore" });
        } catch {
          throw new Error(ERROR_MESSAGES.NO_NODE);
        }
        execSync(buildBundleCommand(outputDir), { cwd: siteDir, stdio: "inherit" });
        return true;
      },
    };
    new BucketDeployment(this, "SiteDeployment", {
      destinationBucket: siteBucket,
      distribution,
      distributionPaths: ["/*"],
      sources: [
        Source.asset(siteDir, {
          bundling: {
            // `local` は常にビルドするか例外を投げるため、Docker パスは実行されません。
            local: localBundling,
            image: DockerImage.fromRegistry(SITE_BUNDLE_DOCKER_IMAGE),
          },
        }),
        Source.data(
          "config.js",
          buildConfigJs({
            baseUrl,
            routes: ROUTES,
            sellerPayTo,
            webAclName: webAcl.name,
            webAclId: webAcl.attrId,
          }),
        ),
      ],
    });

    // 8. 出力値。
    new CfnOutput(this, "DistributionUrl", {
      value: baseUrl,
      description: OUTPUT_DESCRIPTIONS.DISTRIBUTION_URL,
    });
    new CfnOutput(this, "PaidEndpoints", {
      value: ROUTES.map((r) => `${baseUrl}${r.path}`).join(" , "),
      description: OUTPUT_DESCRIPTIONS.PAID_ENDPOINTS,
    });
    new CfnOutput(this, "SellerPayTo", {
      value: sellerPayTo,
      description: OUTPUT_DESCRIPTIONS.SELLER_PAY_TO,
    });
    new CfnOutput(this, "FaucetUrl", {
      value: CIRCLE_FAUCET_URL,
      description: OUTPUT_DESCRIPTIONS.FAUCET_URL,
    });
    new CfnOutput(this, "WafMonetizationConsoleUrl", {
      value: `https://us-east-1.console.aws.amazon.com/wafv2-pro/ai-revenue-payments/${webAcl.name}/${webAcl.attrId}?region=us-east-1&scope=global`,
      description: OUTPUT_DESCRIPTIONS.WAF_MONETIZATION_CONSOLE,
    });
    new CfnOutput(this, "WafTrafficConsoleUrl", {
      value: `https://us-east-1.console.aws.amazon.com/wafv2-pro/protections/${webAcl.name}/${webAcl.attrId}/ai-traffic?region=us-east-1&scope=global`,
      description: OUTPUT_DESCRIPTIONS.WAF_TRAFFIC_CONSOLE,
    });
  }
}
```

- [ ] **Step 2: 型チェックが通ることを確認する**

```bash
cd /Users/harukikondo/git/sample-managed-monetization-using-cloudfront-and-waf/pkgs/cdk
npx tsc --noEmit
```

期待: エラーなし

- [ ] **Step 3: `pnpm synth` で CloudFormation テンプレートが生成されることを確認する**

```bash
cd /Users/harukikondo/git/sample-managed-monetization-using-cloudfront-and-waf
pnpm synth
```

期待: `Successfully synthesized to pkgs/cdk/cdk.out` と表示される。エラーなし。

- [ ] **Step 4: commit する**

```bash
git add pkgs/cdk/lib/monetization-stack.ts
git commit -m "refactor: monetization-stack.ts の定数・関数・文字列を utils から参照するよう更新"
```

---

## Task 6: 最終検証

- [ ] **Step 1: 全体の型チェックを実行する**

```bash
cd /Users/harukikondo/git/sample-managed-monetization-using-cloudfront-and-waf/pkgs/cdk
npx tsc --noEmit
```

期待: エラーなし

- [ ] **Step 2: Biome チェックを実行する**

```bash
cd /Users/harukikondo/git/sample-managed-monetization-using-cloudfront-and-waf
pnpm check
```

期待: エラーなし（自動修正あり）。修正がある場合は `git add -p && git commit -m "style: biome format"` する。

- [ ] **Step 3: `pnpm synth` で最終確認する**

```bash
cd /Users/harukikondo/git/sample-managed-monetization-using-cloudfront-and-waf
pnpm synth
```

期待: `Successfully synthesized` と表示される。

- [ ] **Step 4: `monetization-stack.ts` にインラインの文字列リテラル・ローカル定数・ローカル関数定義が残っていないことを目視確認する**

確認ポイント:
- `const CIRCLE_FAUCET_URL` などのローカル定数がない
- `const metricToken` などのローカル関数定義がない
- `"x402 サンプル"` などの日本語文字列リテラルが `description`/`comment` 引数に直書きされていない

- [ ] **Step 5: まとめ commit する（Step 2 で修正がなかった場合）**

```bash
git add -A
git commit -m "chore: CDK utils リファクタリング完了"
```
