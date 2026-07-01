# 開発ガイド

## 前提条件

- Node.js 24+
- pnpm
- AWS アカウント + `us-east-1` クレデンシャル
- CDK bootstrap 済み (`npx cdk bootstrap` — 初回のみ)

## よく使うコマンド

```bash
# デプロイ
pnpm deploy          # CDK deploy + cdk-outputs.json 生成

# 開発
pnpm dev             # site の Vite dev server
pnpm synth           # CDK テンプレート合成のみ（デプロイなし）

# コード品質
pnpm lint            # Biome lint
pnpm format          # Biome format（上書き）
pnpm check           # Biome check（lint + format）

# 破棄
pnpm destroy         # CloudFormation スタック削除
```

## ルートを追加する手順

1. `pkgs/cdk/lib/routes.ts` の `ROUTES` 配列にエントリを追加
2. `pkgs/cdk/lib/cff/edge.js` の `_handler` 関数に新パスのコンテンツ生成ロジックを追加
3. `pnpm deploy` で適用

WAF ルール・CF ビヘイビア・SPA の config.js はすべて `ROUTES` から自動生成される。

## コードスタイル

- **言語:** TypeScript (strict)
- **Linter/Formatter:** Biome 2.5.2 (`biome.json` 参照)
- **コメント:** 日本語推奨（既存コードに合わせる）
- **Edge Function:** CloudFront Function (JS_2_0) は ES5 相当。`const`/`let` は使用可、`import` 不可

## 重要な設計決定

### CDK で未型定義の WAF 機能を使う
`CfnWebACL.addPropertyOverride()` で `MonetizationConfig` と `Monetize` アクションを注入。
CloudFormation レベルでは対応済みだが `aws-cdk-lib 2.260.0` のTypeScript 型には未公開。

### 販売者アドレスのキャッシュ
`pkgs/cdk/.seller-payto.json` に保存（gitignore 対象）。
デプロイをまたいで同一アドレスを維持するため、削除しない限りローテーションされない。

### Docker 不使用のサイトビルド
`BucketDeployment` の `localBundling` でホストの Node.js を使う。
Node がない場合は例外を投げる（サイレントフォールバックなし）。

### UA プロキシの循環依存回避
Lambda に `SELF_ORIGIN` 環境変数を渡すと Distribution との循環依存が生じる。
代わりにブラウザから `?origin=<distribution-url>` クエリパラメータで渡し、Lambda 側で `*.cloudfront.net` 正規表現で検証。
