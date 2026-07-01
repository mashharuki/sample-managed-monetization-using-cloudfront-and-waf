# CDK アーキテクチャ詳細

## 主要ファイル (pkgs/cdk/)

| ファイル | 役割 |
|---|---|
| `lib/routes.ts` | 収益化ルート定義レジストリ（ここを編集すると WAF ルール・CF ビヘイビア・SPA が連動） |
| `lib/monetization-stack.ts` | メイン CDK スタック |
| `lib/monetize/monetization.ts` | WAF Monetize ルール・MonetizationConfig 生成関数 |
| `lib/cff/edge.js` | CloudFront Function（モックコンテンツ生成、JS_2_0 ランタイム） |
| `lib/proxy/handler.ts` | UA プロキシ Lambda ハンドラー |
| `lib/seller-payto.ts` | 販売者ウォレットアドレス解決（`pkgs/cdk/.seller-payto.json` にキャッシュ） |

## ルート定義 (routes.ts)

```typescript
export interface RouteSpec {
  path: string;           // ビヘイビアがマッチするパス (例: "/weather")
  label: string;          // SPA のルートピッカー用ラベル
  contentType: "json" | "markdown" | "html";  // レンダラーヒント
  priceMultiplier: number; // 価格乗数 × WebACL の基本 Amount
}

export const ROUTES: RouteSpec[] = [
  { path: "/weather",   label: "Weather (JSON)",    contentType: "json",     priceMultiplier: 1 },
  { path: "/sports",    label: "Sports (Markdown)", contentType: "markdown", priceMultiplier: 2 },
  { path: "/main.html", label: "Landing (HTML)",    contentType: "html",     priceMultiplier: 1 },
];
```

**新ルート追加:** `ROUTES` 配列にエントリを追加するだけ。WAF ルール・CF ビヘイビア・SPA の config.js が自動生成される。

## WAF 設定の重要な制約

- `MonetizationConfig` と `Monetize` ルールアクションは `aws-cdk-lib 2.260.0` で未型定義
- → `webAcl.addPropertyOverride("Rules", ...)` と `webAcl.addPropertyOverride("MonetizationConfig", ...)` で注入
- CloudFormation の `SearchString` は **生文字列**（事前 base64 エンコード不要。生 WAF API と異なる）
- Bot Control v6 以上が必須（AI トラフィックラベル対応）、Count モード（ブロックなし）で実行

## スタック構成要素

1. **S3 Bucket** — SPA ホスティング (Block All Public Access, OAC のみ)
2. **販売者 payTo** — `lib/seller-payto.ts` でデプロイ時生成・キャッシュ
3. **CloudFront Function** — モックコンテンツ返却 (WAF 後に実行)
4. **WAF WebACL** — Bot Control v6 (Count) + 各ルートの Monetize ルール
5. **CloudFront Distribution** — デフォルト `/` → S3、有料ルート → CF Function
6. **UA Proxy Lambda** — `/proxy` (Node.js 24.x, IAM + OAC, 許可リスト制)
7. **BucketDeployment** — Vite ビルド + config.js 生成・S3 アップロード

## UA プロキシ Lambda の制約

- `ALLOWED_TARGETS` 環境変数で許可パスを制限（オープンプロキシにしない）
- オリジン検証: `*.cloudfront.net` のみ許可
- 上流のステータスのみ返却（有料コンテンツのボディは返さない）
- Distribution との循環依存を避けるため SELF_ORIGIN 環境変数を使わない

## デプロイコマンド

```bash
# ルートから
pnpm deploy         # = cd pkgs/cdk && npx cdk deploy --outputs-file ../../cdk-outputs.json
pnpm synth          # CDK テンプレート合成のみ
pnpm destroy        # スタック削除

# pkgs/cdk から直接
npx cdk deploy --outputs-file ../../cdk-outputs.json
npx cdk destroy
```

## 販売者アドレスのローテーション

```bash
rm pkgs/cdk/.seller-payto.json
npx cdk deploy   # 新しい受取アドレスが生成される
```
