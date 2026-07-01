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
    //    購入者（ブラウザウォレット）がここに支払いを行います。受け取り専用なので
    //    秘密鍵は不要で、Lambda やカスタムリソースも必要ありません。
    const sellerPayTo = resolveSellerPayTo();

    // 3. CloudFront Function — モックの有料コンテンツを生成します（パスに応じて
    //    JSON / Markdown / HTML を返します）。WAF の後に実行（エッジ順序が確認済み）されるため、
    //    支払い済みリクエストだけがここに到達します。
    const edgeFn = new CfFunction(this, "EdgeFunction", {
      runtime: FunctionRuntime.JS_2_0,
      // cff/ は lib/ の親（pkgs/cdk/cff/）に移動済みのため ".." を挟む。
      code: FunctionCode.fromFile({ filePath: path.join(__dirname, "..", "cff", "edge.js") }),
      comment: RESOURCE_COMMENTS.EDGE_FUNCTION,
    });

    // 4. 有料ルート用のキャッシュポリシー。CloudFront-Viewer-Country をエッジ関数に転送します
    //    （ここで許可リストに入れない限り、このヘッダーは存在しません）。
    const edgeCachePolicy = new CachePolicy(this, "EdgeCachePolicy", {
      comment: RESOURCE_COMMENTS.EDGE_CACHE_POLICY,
      defaultTtl: Duration.seconds(CACHE_DEFAULT_TTL_SEC),
      minTtl: Duration.seconds(CACHE_DEFAULT_TTL_SEC),
      maxTtl: Duration.seconds(CACHE_MAX_TTL_SEC),
      headerBehavior: CacheHeaderBehavior.allowList(VIEWER_COUNTRY_HEADER),
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
      comment: RESOURCE_COMMENTS.DISTRIBUTION,
      defaultRootObject: "index.html",
      webAclId: webAcl.attrArn,
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // SPA のキャッシュを無効にして、すべてのデプロイが即時反映されるようにします。
        // Vite のコンテンツハッシュ付きアセットファイル名がバージョン管理を担います。
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
      timeout: Duration.seconds(PROXY_TIMEOUT_SEC),
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
    const siteDir = path.join(__dirname, "..", "..", "site");
    // ホストの Node ツールチェーンのみを使ってサイトをビルド — Docker は使いません。
    // Node/npx が利用できない場合は明示的にエラーを出します。
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
            // CDK の BundlingOptions 型はまだ `image` を必須とするため、このプレースホルダーは
            // 到達不能で、意図的に `command`（Docker 専用）を持ちません。
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
            webAclName: webAcl.name ?? "",
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
