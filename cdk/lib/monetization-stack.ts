import * as path from "path";
import { execSync } from "child_process";
import {
  CfnOutput,
  Duration,
  ILocalBundling,
  RemovalPolicy,
  Stack,
  StackProps,
  DockerImage,
} from "aws-cdk-lib";
import { Construct } from "constructs";
import { Bucket, BlockPublicAccess, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { BucketDeployment, Source } from "aws-cdk-lib/aws-s3-deployment";
import {
  AllowedMethods,
  CacheHeaderBehavior,
  CachePolicy,
  OriginRequestPolicy,
  Distribution,
  Function as CfFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin, FunctionUrlOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import { Runtime as LambdaRuntime, FunctionUrlAuthType, InvokeMode } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { buildRules, monetizationConfig, BASE_SEPOLIA_USDC } from "./monetize/monetization";
import { resolveSellerPayTo } from "./seller-payto";
import { ROUTES } from "./routes";

/** Path → a safe token for WAF metric/rule names ("/main.html" → "main-html"). */
const metricToken = (p: string) => p.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-");

// Circle's testnet faucet (Base Sepolia USDC). The page deep-links here to fund.
const CIRCLE_FAUCET_URL = "https://faucet.circle.com/";
// Placeholder token in the bundle script, swapped for the real output dir.
const OUTDIR = "__OUTDIR__";

export class MonetizationStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // 1. S3 — origin for the static buyer page. Private; reached only via CloudFront OAC.
    const siteBucket = new Bucket(this, "SiteBucket", {
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      encryption: BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 2. Seller payTo — a static testnet receiver address, generated once at deploy
    //    time (in the CDK process) and cached locally so it's stable across deploys.
    //    The buyer (browser wallet) pays INTO this; it only ever receives, so no key
    //    is exposed and no Lambda/custom resource is needed.
    const sellerPayTo = resolveSellerPayTo();

    // 3. CloudFront Function — synthesizes the mock paid content (it switches on the
    //    path to return JSON / Markdown / HTML). Runs AFTER WAF (verified edge order),
    //    so only paid requests ever reach it.
    const edgeFn = new CfFunction(this, "EdgeFunction", {
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromFile({ filePath: path.join(__dirname, "cff", "edge.js") }),
      comment: "x402 sample — mock paid content (runs after WAF payment verification)",
    });

    // 4. Cache policy for the paid routes that forwards CloudFront-Viewer-Country to
    //    the edge function (the header isn't present unless allow-listed here).
    const edgeCachePolicy = new CachePolicy(this, "EdgeCachePolicy", {
      comment: "Forward viewer-country to the edge CloudFront Function; no caching.",
      defaultTtl: Duration.seconds(0),
      minTtl: Duration.seconds(0),
      maxTtl: Duration.seconds(1),
      headerBehavior: CacheHeaderBehavior.allowList("CloudFront-Viewer-Country"),
    });

    // 5. WAF WebACL — native x402 monetization, entirely in this template.
    //    `MonetizationConfig` + the `Monetize` rule action are supported by
    //    CloudFormation (AWS::WAFv2::WebACL) but not yet typed in this aws-cdk-lib,
    //    so they're injected via addPropertyOverride. No custom resource, no runtime
    //    API call — the paywall ships with one `cdk deploy`.
    //    Posture: Bot Control v6 (Count) for AI-traffic labels; default Allow ("/" is
    //    free); one Monetize rule per paid route.
    const webAcl = new CfnWebACL(this, "WebACL", {
      name: `${id}-acl`,
      scope: "CLOUDFRONT",
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: `${id}-acl`,
      },
      rules: [], // injected below (the Monetize action isn't typed yet)
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

    // 6. CloudFront distribution. Default "/" → S3 (the page). Each paid route → S3
    //    origin too, but the viewer-request edge function short-circuits with content.
    const s3Origin = S3BucketOrigin.withOriginAccessControl(siteBucket);
    const distribution = new Distribution(this, "Distribution", {
      comment: "x402 WAF monetization sample",
      defaultRootObject: "index.html",
      webAclId: webAcl.attrArn,
      defaultBehavior: {
        origin: s3Origin,
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        // Caching disabled on the SPA so every deploy is live immediately — no
        // invalidation lag, no cache-busting query params. (It's a demo; the page is
        // tiny.) Vite's content-hashed asset filenames already handle versioning.
        cachePolicy: CachePolicy.CACHING_DISABLED,
      },
    });
    // One behavior per monetized route — each runs the same edge function (it
    // switches on the path) and is priced by its own WAF Monetize rule.
    for (const route of ROUTES) {
      distribution.addBehavior(`${route.path}*`, s3Origin, {
        viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: edgeCachePolicy,
        allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
        functionAssociations: [
          { function: edgeFn, eventType: FunctionEventType.VIEWER_REQUEST },
        ],
      });
    }

    const baseUrl = `https://${distribution.distributionDomainName}`;

    // 6b. UA proxy — the one thing the browser can't do: send a real `User-Agent`.
    //     The browser drives the burst; for each request it calls /proxy?target=…&ua=…
    //     and this Lambda re-issues that single GET with the real UA, so WAF Bot
    //     Control sees a genuine GPTBot/ClaudeBot/etc. Function URL is IAM-auth +
    //     reached only via CloudFront OAC (never public).
    const proxyFn = new NodejsFunction(this, "UaProxyFunction", {
      entry: path.join(__dirname, "proxy", "handler.ts"),
      handler: "handler",
      runtime: LambdaRuntime.NODEJS_24_X,
      timeout: Duration.seconds(15),
      // No SELF_ORIGIN env (it would create a circular dep with the Distribution).
      // The handler derives its origin from the incoming Host header instead.
      environment: {
        ALLOWED_TARGETS: ROUTES.map((r) => r.path).join(","),
      },
      bundling: { minify: true, sourceMap: false, target: "es2022", externalModules: ["@aws-sdk/*"] },
    });
    const proxyUrl = proxyFn.addFunctionUrl({
      authType: FunctionUrlAuthType.AWS_IAM,
      invokeMode: InvokeMode.BUFFERED,
    });
    const proxyOrigin = FunctionUrlOrigin.withOriginAccessControl(proxyUrl);
    distribution.addBehavior("/proxy*", proxyOrigin, {
      viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: CachePolicy.CACHING_DISABLED,
      // Forward the query string (target/ua/origin) to the Lambda; CACHING_DISABLED
      // alone does NOT forward query args to the origin.
      originRequestPolicy: OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      allowedMethods: AllowedMethods.ALLOW_GET_HEAD,
    });

    // 7. Deploy the site. CDK runs the Vite build (React + TS → static assets),
    //    then generates config.js from deploy-time tokens (base URL, routes, WebACL
    //    console links, seller payTo; NO buyer key — that's generated in the
    //    browser). The build NEVER needs deploy values (they arrive at runtime via
    //    config.js), so one `cdk deploy` produces a fully-configured site. Bundling
    //    runs LOCALLY (host node) with a Docker fallback, so no Docker is required.
    const siteDir = path.join(__dirname, "..", "..", "site");
    const bundleScript = [
      "npm ci --no-audit --no-fund || npm install --no-audit --no-fund",
      "npm run build",
      `cp -r dist/. ${OUTDIR}/`,
    ];
    // Build the site on the host's Node toolchain only — no Docker. If Node/npx
    // isn't available we fail loudly rather than silently falling back to a
    // container build, so deploys are reproducible against the local toolchain.
    const localBundling: ILocalBundling = {
      tryBundle(outputDir: string): boolean {
        try {
          execSync("node --version && npx --version", { stdio: "ignore" });
        } catch {
          throw new Error(
            "A local Node.js toolchain (node + npx) is required to build the site. " +
              "Install Node.js 24+ and re-run `cdk deploy`.",
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
            // `local` always builds (or throws), so the Docker path is never taken.
            // CDK's BundlingOptions type still requires `image`; this placeholder is
            // unreachable and intentionally has no `command` (Docker-only) to run.
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
            // Deep-links into the AWS WAF "pro" console for this WebACL. CLOUDFRONT
            // scope = global; region in the path is where the WebACL lives (us-east-1).
            // One for the AI revenue / monetization view, one for live AI traffic.
            `  wafMonetizationUrl: "https://us-east-1.console.aws.amazon.com/wafv2-pro/ai-revenue-payments/${webAcl.name}/${webAcl.attrId}?region=us-east-1&scope=global",`,
            `  wafTrafficUrl: "https://us-east-1.console.aws.amazon.com/wafv2-pro/protections/${webAcl.name}/${webAcl.attrId}/ai-traffic?region=us-east-1&scope=global"`,
            "};",
          ].join("\n"),
        ),
      ],
    });

    // 8. Outputs.
    new CfnOutput(this, "DistributionUrl", {
      value: baseUrl,
      description: "Open this — the buyer page (free landing + the x402 demo).",
    });
    new CfnOutput(this, "PaidEndpoints", {
      value: ROUTES.map((r) => `${baseUrl}${r.path}`).join(" , "),
      description: "The paid endpoints. `curl -i` any to see the raw WAF 402.",
    });
    new CfnOutput(this, "SellerPayTo", {
      value: sellerPayTo,
      description: "The address WAF settles payments into (Base Sepolia testnet).",
    });
    new CfnOutput(this, "FaucetUrl", {
      value: CIRCLE_FAUCET_URL,
      description: "Fund your in-browser buyer wallet with testnet USDC here.",
    });
    new CfnOutput(this, "WafMonetizationConsoleUrl", {
      value: `https://us-east-1.console.aws.amazon.com/wafv2-pro/ai-revenue-payments/${webAcl.name}/${webAcl.attrId}?region=us-east-1&scope=global`,
      description: "AWS WAF console — this WebACL's AI revenue / monetization view.",
    });
    new CfnOutput(this, "WafTrafficConsoleUrl", {
      value: `https://us-east-1.console.aws.amazon.com/wafv2-pro/protections/${webAcl.name}/${webAcl.attrId}/ai-traffic?region=us-east-1&scope=global`,
      description: "AWS WAF console — live AI traffic for this WebACL.",
    });
  }
}
