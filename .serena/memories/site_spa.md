# Site (SPA) 詳細

## 技術スタック

- **フレームワーク:** Vite 8 + React 19 (TypeScript)
- **x402 クライアント:** `@x402/core 2.16.0` + `@x402/evm 2.16.0`
- **チェーン操作:** `viem 2.53.1`
- **サニタイズ:** `dompurify 3.4.11`

## ソースファイル (pkgs/site/src/)

| ファイル | 役割 |
|---|---|
| `App.tsx` | メインアプリ、バースト制御ロジック、インフライトスケジューラー |
| `WalletPicker.tsx` | ブラウザ内ウォレット生成・管理 UI |
| `ContentView.tsx` | 有料コンテンツ表示（JSON/Markdown/HTML レンダリング） |
| `utils/config.ts` | `window.X402_CONFIG` の型付きアクセサー |
| `utils/wallet.ts` | viem ウォレット操作ユーティリティ |
| `utils/x402.ts` | `callOnly`（402確認）/ `payRoundTrip`（支払い完了）実装 |

## ランタイム設定 (config.js)

CDK デプロイ時に `BucketDeployment` → `Source.data("config.js", ...)` で生成される。
SPA は `window.X402_CONFIG` を参照する。

```javascript
window.X402_CONFIG = {
  baseUrl: "https://d3274z4iiqwf6d.cloudfront.net",
  routes: [...],           // RouteSpec の label/path/contentType のみ
  proxyPath: "/proxy",
  payTo: "0x6A93800ADEd9E1f8a8c973145Ec19360598E7487",
  usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  chainId: 84532,          // Base Sepolia
  faucetUrl: "https://faucet.circle.com/",
  wafMonetizationUrl: "...",
  wafTrafficUrl: "...",
};
```

## ウォレット管理

- キーは `localStorage` で保管（ブラウザ内スローアウェイウォレット）
- 複数ウォレット作成可能（AI ボットシミュレーション用）
- `localStorage` キー: `x402.customUserAgents`（カスタム UA 保存）

## バーストトラフィック機能

`runPool()` 関数が並列インフライトスケジューラーを実装:
- 固定バッチではなくソフトターゲット方式（一定数を常に維持）
- ジッター付きターゲット: `[min, max]` で有機的に変動
- 各リクエストが `/proxy?target=<path>&ua=<bot-ua>&origin=<distribution>` を呼び出し

## ローカル開発

```bash
pnpm dev       # Vite dev server (pkgs/site)
pnpm build     # 本番ビルド
pnpm preview   # ビルド結果プレビュー
```

## 注意事項

- Testnet のみ (Base Sepolia)。実資金・本番キー使用禁止
- `index.html` は `pkgs/site/dist/index.html` (`pkgs/site/index.html` はルートテンプレート)
