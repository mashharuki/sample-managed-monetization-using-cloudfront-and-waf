# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Onchain work:** Read https://ethskills.com/SKILL.md and follow it before writing Solidity or shipping anything onchain.

---

## Project Summary

A one-`cdk deploy` sample of **AWS WAF native x402 AI traffic monetization** over Base Sepolia. WAF prices and verifies payment at the edge — no Lambda@Edge, no origin changes. The buyer is a Vite + React SPA bundled and deployed by CDK itself.

**Deployed at:** `https://d3274z4iiqwf6d.cloudfront.net`  
**Network:** Base Sepolia (testnet USDC only — no real funds)

---

## Commands

All commands run from the **repo root** via pnpm workspaces.

```bash
# Deploy / teardown
pnpm deploy        # cdk deploy --outputs-file ../../cdk-outputs.json
pnpm destroy       # cdk destroy
pnpm synth         # synthesize CloudFormation template only

# Site development
pnpm dev           # Vite dev server (pkgs/site)
pnpm build         # production Vite build (pkgs/site)
pnpm preview       # preview the built site

# Code quality (Biome — runs across all packages)
pnpm lint          # biome lint
pnpm format        # biome format --write
pnpm check         # biome check --write (lint + format)
```

There are no test suites. Verification is done via `curl -i <endpoint>` after deploy.

---

## Architecture

### Edge request flow

```
Browser → CloudFront → AWS WAF (Monetize rules) → CloudFront Function → S3
                            ↑
              Unpaid → 402 returned here.
              Paid → WAF verifies + settles, then CloudFront Function runs.
```

WAF is **always first**. The CloudFront Function only runs on paid requests.

### Package layout

```
pkgs/
  cdk/   TypeScript CDK app (aws-cdk-lib 2.260.0)
  site/  Vite 8 + React 19 SPA
```

### The route registry (`pkgs/cdk/lib/routes.ts`)

`ROUTES` is the single source of truth. Each entry auto-generates:
- A WAF `Monetize` rule (prices that path)
- A CloudFront behavior + function association
- An entry in `config.js` for the SPA's route picker

**Adding a route:** add one entry to `ROUTES`, add its content branch in `pkgs/cdk/lib/cff/edge.js`, then `pnpm deploy`.

### CDK stack highlights (`pkgs/cdk/lib/monetization-stack.ts`)

- **WAF WebACL:** `MonetizationConfig` and `Monetize` rule actions are not yet typed in `aws-cdk-lib 2.260.0` → injected via `webAcl.addPropertyOverride(...)`. Do not try to set them through the typed L1 props.
- **CloudFormation `SearchString`:** pass raw string, not base64 (CloudFormation encodes it itself — unlike the raw WAF API).
- **Bot Control v6** (`Version_6.0`) must run in **Count** (override) mode to add AI traffic labels without blocking.
- **Seller payTo:** generated once at synth time, cached in `pkgs/cdk/.seller-payto.json` (gitignored). Delete this file to rotate to a new receiving address.
- **Site bundle:** `BucketDeployment` runs Vite via `localBundling` on the host Node — Docker is never used. `config.js` is injected as a second `Source.data(...)` so deploy-time values (distribution URL, routes, payTo) reach the SPA without a rebuild.
- **UA proxy Lambda** (`/proxy`, Node.js 24.x): receives `?target=&ua=&origin=` from the browser. Only `ALLOWED_TARGETS` paths are forwarded; `origin` is validated against `*.cloudfront.net`. Not passing `SELF_ORIGIN` as an env var avoids a CDK circular dependency between the Lambda and the Distribution.

### SPA runtime config

The SPA reads `window.X402_CONFIG` (injected by `config.js` at load time, never bundled). Types are in `pkgs/site/src/utils/config.ts`. Wallet keys live in `localStorage` only.

### x402 payment flow (site)

`pkgs/site/src/utils/x402.ts` implements two operations:
- `callOnly` — fires the request, shows the raw 402 challenge
- `payRoundTrip` — signs the payment with the viem wallet, retries with the signed header, returns the 200 body

The burst traffic feature (`runPool` in `App.tsx`) maintains a soft in-flight concurrency target with jitter, routing each request through `/proxy` with a real bot `User-Agent`.

---

## Key constants

| Constant | Value |
|---|---|
| Base Sepolia USDC | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Base Sepolia chain ID | `84532` |
| WAF Bot Control version | `Version_6.0` |
| Base price | `0.001 USDC` (× `priceMultiplier` per route) |

---

## Code style

- **Formatter:** Biome 2.5.2 — 2-space indent, 100-char line width, double quotes, trailing commas, semicolons.
- **CloudFront Function (`edge.js`):** JS_2_0 runtime — ES5-compatible. `const`/`let` work; `import`/`export` do not.
- **Comments:** Japanese preferred (matches existing codebase).
