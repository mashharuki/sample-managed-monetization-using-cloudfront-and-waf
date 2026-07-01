# プロジェクト概要: x402 WAF Weather Sample

## 目的

Amazon CloudFront + AWS WAF の **ネイティブ x402 収益化**機能を使い、AI トラフィックに料金を課すサンプル実装。`cdk deploy` 一発で WAF ペイウォールが完成する（Lambda@Edge 不要、カスタムリソース不要）。

- **プロトコル:** [x402](https://www.x402.org/)
- **ネットワーク:** Base Sepolia (testnet)
- **決済トークン:** USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`)

## アーキテクチャ

```
Browser → CloudFront → AWS WAF (x402: 402返却) → CloudFront Function → S3 (SPA)
                                                  ↑
                              WAF が先に実行。未払い→402、支払い済みのみ到達
```

エッジ処理順序: **WAF → CloudFront Function → オリジン**

- WAF の `Monetize` アクションが未払いリクエストに `402 Payment Required` を返す
- WAF が支払いを検証・決済後、リクエストが CloudFront Function に到達してコンテンツ生成
- UA Proxy Lambda (`/proxy`): ブラウザが設定できない本物の `User-Agent` を WAF Bot Control に送信

## モノレポ構成

```
/
├── pkgs/
│   ├── cdk/          CDK スタック (TypeScript)
│   └── site/         Vite + React 購入者 SPA
├── biome.json        Linter/Formatter 設定
├── pnpm-workspace.yaml
└── cdk-outputs.json  デプロイ済み出力値 (gitignore 対象でない)
```

**パッケージマネージャー:** pnpm (workspace)  
**Linter/Formatter:** Biome 2.5.2  
**Node:** 24+
