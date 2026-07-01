#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import "source-map-support/register";
import { MonetizationStack } from "../lib/monetization-stack";

const app = new App();

// CLOUDFRONT スコープの WAF WebACL は us-east-1 に配置する必要があり、Lambda@Edge 関連の
// エッジリソースも同リージョンが最もシンプルなため、サンプル全体を us-east-1 に固定しています。
new MonetizationStack(app, "X402WafSample", {
  env: {
    region: "us-east-1",
  },
  description:
    "AWS WAF native x402 monetization (AI Traffic Monetization) over CloudFront — minimal sample.",
});

app.synth();
