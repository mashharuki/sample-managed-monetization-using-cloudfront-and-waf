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
import { BASE_SEPOLIA_USDC } from "../utils/constants";
import { ROUTES } from "../utils/routes";
import { resolveSellerPayTo } from "../utils/seller-payto";
import { buildRules, monetizationConfig } from "./monetize/monetization";

/** パス → WAF メトリクス/ルール名に使える安全なトークンに変換（"/main.html" → "main-html"）。 */
const metricToken = (p: string) => p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-");

// Circle のテストネットフォーセット（Base Sepolia USDC）。ページから資金補充のためにディープリンクします。
const CIRCLE_FAUCET_URL = "https://faucet.circle.com/";
// バンドルスクリプト内のプレースホルダートークン。実際の出力ディレクトリに置換されます。
const OUTDIR = "__OUTDIR__";

/**
 * MonetizationStack用のCDKスタックファイル
 */
export class MonetizationStack extends Stack {
  /**
   * コンストラクター
   * @param scope
   * @param id
   * @param props
   */
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
    //    購入者（ブラウザウォレット）がここに支払いを行います。受け取り専用なので
    //    秘密鍵は不要で、Lambda やカスタムリソースも必要ありません。
    const sellerPayTo = resolveSellerPayTo();

    // 3. CloudFront Function — モックの有料コンテンツを生成します（パスに応じて
    //    JSON / Markdown / HTML を返します）。WAF の後に実行（エッジ順序が確認済み）されるため、
    //    支払い済みリクエストだけがここに到達します。
    const edgeFn = new CfFunction(this, "EdgeFunction", {
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromFile({ filePath: path.join(__dirname, "cff", "edge.js") }),
      comment: "x402 サンプル — モック有料コンテンツ（WAF 支払い検証後に実行）",
    });

    // 4. 有料ルート用のキャッシュポリシー。CloudFront-Viewer-Country をエッジ関数に転送します
    //    （ここで許可リストに入れない限り、このヘッダーは存在しません）。
    const edgeCachePolicy = new CachePolicy(this, "EdgeCachePolicy", {
      comment: "ビューワーの国情報をエッジ CloudFront Function に転送。キャッシュなし。",
      defaultTtl: Duration.seconds(0),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.seconds(1),
      headerBehavior: CacheHeaderBehavior.allowList("CloudFront-Viewer-Country"),
    });

    // 5. WAF WebACL — このテンプレートだけでネイティブ x402 収益化を完結させます。
    //    `MonetizationConfig` と `Monetize` ルールアクションは CloudFormation
    //    (AWS::WAFv2::WebACL) でサポートされていますが、この aws-cdk-lib では
    //    まだ型定義されていないため、addPropertyOverride 経由で注入します。
    //    カスタムリソースも実行時 API 呼び出しも不要で、`cdk deploy` 一発でペイウォールが完成します。
    //    ポスチャ: Bot Control v6 (Count) で AI トラフィックラベルを付与。
    //    デフォルトは Allow（"/" は無料）。有料ルートごとに 1 つの Monetize ルール。
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

    // ここでMoneize ルールを導入
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
    //    各有料ルートも S3 オリジンを使いますが、viewer-request エッジ関数がコンテンツで短絡します。
    const s3Origin = S3BucketOrigin.withOriginAccessControl(siteBucket);
    const distribution = new Distribution(this, "Distribution", {
      comment: "x402 WAF 収益化サンプル",
      defaultRootObject: "index.html",
      webAclId: webAcl.attrArn,
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // SPA のキャッシュを無効にして、すべてのデプロイが即時反映されるようにします。
        // キャッシュ無効化の遅延も、キャッシュバスティングのクエリパラメータも不要です。
        //（デモ用のため、ページは小さいです。）Vite のコンテンツハッシュ付きアセットファイル名がバージョン管理を担います。
        cachePolicy: CachePolicy.CACHING_DISABLED,
      },
    });
    // 収益化ルートごとに 1 つのビヘイビア — それぞれが同じエッジ関数を実行し（パスで分岐）、
    // 独自の WAF Monetize ルールで価格が設定されます。
    for (const route of ROUTES) {
      distribution.addBehavior(`${route.path}*`, s3Origin, {
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: edgeCachePolicy,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        functionAssociations: [{ function: edgeFn, eventType: FunctionEventType.VIEWER_REQUEST }],
      });
    }

    const baseUrl = `https://${distribution.distributionDomainName}`;

    // 6b. UA プロキシ — ブラウザができない唯一のこと：本物の `User-Agent` を送信すること。
    //     ブラウザがバーストを制御し、各リクエストで /proxy?target=…&ua=… を呼び出します。
    //     この Lambda が本物の UA を使って単一の GET を再送信するため、WAF Bot Control が
    //     真の GPTBot/ClaudeBot 等として認識してラベル付けします。Function URL は IAM 認証 +
    //     CloudFront OAC 経由でのみアクセス可能（パブリック非公開）。
    const proxyFn = new NodejsFunction(this, "UaProxyFunction", {
      entry: path.join(__dirname, "proxy", "handler.ts"),
      handler: "handler",
      runtime: LambdaRuntime.NODEJS_24_X,
      timeout: Duration.seconds(15),
      // SELF_ORIGIN 環境変数なし（Distribution との循環依存が生じるため）。
      // ハンドラーは代わりに受信した Host ヘッダーからオリジンを導出します。
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
      // クエリ文字列（target/ua/origin）を Lambda に転送します。CACHING_DISABLED だけでは
      // クエリ引数はオリジンに転送されません。
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
    });

    // 7. サイトのデプロイ。CDK が Vite ビルドを実行し（React + TS → 静的アセット）、
    //    デプロイ時のトークン（ベース URL、ルート、WebACL コンソールリンク、販売者 payTo；
    //    購入者キーは含まない — ブラウザで生成されます）から config.js を生成します。
    //    ビルドにデプロイ時の値は不要（config.js 経由でランタイムに到達）なので、
    //    `cdk deploy` 一発で完全設定済みのサイトが完成します。バンドルはローカル（ホストの
    //    Node）で実行され、Docker フォールバックがあるため Docker は必須ではありません。
    const siteDir = path.join(__dirname, "..", "..", "site");
    const bundleScript = [
      "npm ci --no-audit --no-fund || npm install --no-audit --no-fund",
      "npm run build",
      `cp -r dist/. ${OUTDIR}/`,
    ];
    // ホストの Node ツールチェーンのみを使ってサイトをビルド — Docker は使いません。
    // Node/npx が利用できない場合は、コンテナビルドに静かにフォールバックするのではなく
    // 明示的にエラーを出します。これによりローカルツールチェーンに対して再現性が確保されます。
    const localBundling: ILocalBundling = {
      tryBundle(outputDir: string): boolean {
        try {
          execSync("node --version && npx --version", { stdio: "ignore" });
        } catch {
          throw new Error(
            "サイトのビルドにはローカルの Node.js ツールチェーン（node + npx）が必要です。" +
              "Node.js 24 以上をインストールして `cdk deploy` を再実行してください。",
          );
        }
        execSync(bundleScript.join(" && ").replace(new RegExp(OUTDIR, "g"), outputDir), {
          cwd: siteDir,
          stdio: "inherit",
        });
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
            // CDK の BundlingOptions 型はまだ `image` を必須とするため、このプレースホルダーは
            // 到達不能で、意図的に `command`（Docker 専用）を持ちません。
            local: localBundling,
            image: DockerImage.fromRegistry("public.ecr.aws/sam/build-nodejs24.x:1.149.0"),
          },
        }),
        Source.data(
          "config.js",
          [
            "window.X402_CONFIG = {",
            `  baseUrl: ${JSON.stringify(baseUrl)},`,
            `  routes: ${JSON.stringify(
              ROUTES.map((r) => ({ path: r.path, label: r.label, contentType: r.contentType })),
            )},`,
            `  proxyPath: "/proxy",`,
            `  payTo: "${sellerPayTo}",`,
            `  usdcAddress: ${JSON.stringify(BASE_SEPOLIA_USDC)},`,
            `  chainId: 84532,`,
            `  faucetUrl: ${JSON.stringify(CIRCLE_FAUCET_URL)},`,
            // この WebACL の AWS WAF "pro" コンソールへのディープリンク。CLOUDFRONT
            // スコープ = グローバル。パスのリージョンは WebACL が存在するリージョン（us-east-1）。
            // AI 収益/収益化ビュー用と、ライブ AI トラフィック用の 2 つ。
            `  wafMonetizationUrl: "https://us-east-1.console.aws.amazon.com/wafv2-pro/ai-revenue-payments/${webAcl.name}/${webAcl.attrId}?region=us-east-1&scope=global",`,
            `  wafTrafficUrl: "https://us-east-1.console.aws.amazon.com/wafv2-pro/protections/${webAcl.name}/${webAcl.attrId}/ai-traffic?region=us-east-1&scope=global"`,
            "};",
          ].join("\n"),
        ),
      ],
    });

    // ==================================================================
    // 8. 出力値。
    // ==================================================================

    new CfnOutput(this, "DistributionUrl", {
      value: baseUrl,
      description: "これを開いてください — 購入者ページ（無料ランディング + x402 デモ）。",
    });
    new CfnOutput(this, "PaidEndpoints", {
      value: ROUTES.map((r) => `${baseUrl}${r.path}`).join(" , "),
      description: "有料エンドポイント。`curl -i` で WAF の生の 402 レスポンスを確認できます。",
    });
    new CfnOutput(this, "SellerPayTo", {
      value: sellerPayTo,
      description: "WAF が支払いを決済するアドレス（Base Sepolia テストネット）。",
    });
    new CfnOutput(this, "FaucetUrl", {
      value: CIRCLE_FAUCET_URL,
      description: "ここでブラウザ内の購入者ウォレットにテストネット USDC を補充します。",
    });
    new CfnOutput(this, "WafMonetizationConsoleUrl", {
      value: `https://us-east-1.console.aws.amazon.com/wafv2-pro/ai-revenue-payments/${webAcl.name}/${webAcl.attrId}?region=us-east-1&scope=global`,
      description: "AWS WAF コンソール — この WebACL の AI 収益/収益化ビュー。",
    });
    new CfnOutput(this, "WafTrafficConsoleUrl", {
      value: `https://us-east-1.console.aws.amazon.com/wafv2-pro/protections/${webAcl.name}/${webAcl.attrId}/ai-traffic?region=us-east-1&scope=global`,
      description: "AWS WAF コンソール — この WebACL のライブ AI トラフィック。",
    });
  }
}
