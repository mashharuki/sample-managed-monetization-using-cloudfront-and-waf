/**
 * AWS WAF native x402 monetization — the rule + config, as plain CloudFormation
 * property objects.
 *
 * `MonetizationConfig` + the `Monetize` rule action ARE supported by CloudFormation
 * (AWS::WAFv2::WebACL), but the typed CDK L1 (`CfnWebACL`) in this aws-cdk-lib
 * version doesn't expose them yet — so the stack injects these via
 * `addPropertyOverride`. No custom resource, no runtime API call: it's all in the
 * one synthesized template.
 *
 * The whole posture is intentionally tiny:
 *   - default action = Allow (the human landing page at "/" is free)
 *   - ONE Monetize rule on /weather → every request gets 402 → pay → 200
 */

/** Base Sepolia USDC contract — what the buyer pays with. */
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/** Bot Control managed-rule-group version. MUST be >= v6 (the group default is v1);
 *  v6 carries the AI bot org / category / verification labels the AI-traffic view
 *  shows. Run in Count (override) so it labels without blocking. */
export const BOT_CONTROL_VERSION = "Version_6.0";

export interface MonetizeRoute {
  /** URI prefix to match, e.g. "/weather". */
  path: string;
  /** Price multiplier × the base Amount. */
  priceMultiplier: number;
  /** Safe token for metric/rule names (e.g. "weather", "main-html"). */
  metricName: string;
}

export interface MonetizeInput {
  /** Payee wallet (the seller's receiving address) for MonetizationConfig. */
  walletAddress: string;
  /** Base unit price in USDC. Default 0.001. */
  baseAmount?: string;
  /** Metric-name prefix for CloudWatch visibility. */
  metricPrefix: string;
  /** The monetized routes (one Monetize rule each). */
  routes: MonetizeRoute[];
}

/** Rule 0 — Bot Control managed group (v6, Count: detect + label only, no block).
 *  Gives the WAF AI-traffic view the bot org/category/verification labels. */
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

/** Bot Control v6 (Count) first, then one terminating Monetize rule per route. */
export function buildRules(input: MonetizeInput): Array<Record<string, unknown>> {
  const rules: Array<Record<string, unknown>> = [botControlRule(input.metricPrefix)];
  input.routes.forEach((route, i) => {
    rules.push({
      Name: `Monetize-${route.metricName}`,
      // Priority 0 is Bot Control; Monetize rules start at 1.
      Priority: i + 1,
      Statement: {
        ByteMatchStatement: {
          // CloudFormation takes the RAW search string and base64-encodes it for the
          // WAF API itself — do NOT pre-encode here (that double-encodes and the rule
          // never matches). This differs from the raw UpdateWebACL API, which wants
          // base64.
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

/** WebACL-level MonetizationConfig: payee wallet, chain, base price, testnet mode. */
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
