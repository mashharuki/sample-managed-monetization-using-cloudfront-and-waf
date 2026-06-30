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

/** Base Sepolia USDC コントラクト — 購入者が支払いに使用するトークン。 */
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/** Bot Control マネージドルールグループのバージョン。v6 以上必須（グループのデフォルトは v1）。
 *  v6 は AI トラフィックビューに表示される AI ボットの組織/カテゴリ/検証ラベルを持ちます。
 *  Count（オーバーライド）で実行してブロックせずにラベル付けのみ行います。 */
export const BOT_CONTROL_VERSION = "Version_6.0";

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
          Prices: [{ Amount: input.baseAmount ?? "0.001", Currency: "USDC" }],
        },
      ],
    },
    CurrencyMode: "TEST",
  };
}
