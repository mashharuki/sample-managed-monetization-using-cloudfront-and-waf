#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { MonetizationStack } from "../lib/monetization-stack";

const app = new App();

// CLOUDFRONT-scope WAF WebACLs MUST live in us-east-1, and Lambda@Edge-adjacent
// edge resources are simplest there too — so the whole sample is pinned to us-east-1.
new MonetizationStack(app, "X402WafSample", {
  env: { region: "us-east-1" },
  description:
    "AWS WAF native x402 monetization (AI Traffic Monetization) over CloudFront — minimal sample.",
});

app.synth();
