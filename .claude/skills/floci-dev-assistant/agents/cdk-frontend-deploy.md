# CDK フロントエンドデプロイ エージェント

CDK スタックに S3 + CloudFront 構成でフロントエンドをデプロイするパターン。

---

## 重要な前提

**`cdk deploy` はインフラを作るだけ**で、フロントエンドのビルド成果物（`dist/`）を
S3 へアップロードしない。別途 `BucketDeployment` を CDK スタックに組み込む必要がある。

---

## AccessDenied の診断フロー

CloudFront URL で `<Code>AccessDenied</Code>` が返る場合:

```
AccessDenied?
├─ S3 バケットが空 (最多) → BucketDeployment を追加してデプロイし直す
└─ バケットポリシーに CloudFront OAC が未設定
   → aws s3api get-bucket-policy --bucket <BUCKET> で確認
   → S3BucketOrigin.withOriginAccessControl() を使っているか確認
```

確認コマンド:
```bash
aws s3 ls s3://<BUCKET_NAME>/ --region ap-northeast-1
aws s3api get-bucket-policy --bucket <BUCKET_NAME> --region ap-northeast-1
```

---

## CDK パターン: BucketDeployment

### インポート

```typescript
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
```

### スタック内の実装

```typescript
// isAws ブロック内、Distribution 定義の直後に追加
const distribution = new cloudfront.Distribution(this, "Distribution", {
  defaultRootObject: "index.html",
  defaultBehavior: {
    origin: origins.S3BucketOrigin.withOriginAccessControl(frontendBucket),
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    compress: true,
  },
  errorResponses: [
    { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html" },
    { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html" },
  ],
});

// ↓ これを追加する
new s3deploy.BucketDeployment(this, "FrontendDeploy", {
  sources: [s3deploy.Source.asset(join(__dirname, "../../frontend/dist"))],
  destinationBucket: frontendBucket,
  distribution,               // CloudFront キャッシュを自動無効化
  distributionPaths: ["/*"],  // 全パスのキャッシュを削除
});
```

### ポイント

| 設定 | 理由 |
|------|------|
| `distribution` | 指定しないとデプロイ後も古いキャッシュが残る |
| `distributionPaths: ["/*"]` | SPA の場合すべてのパスを無効化する必要がある |
| `S3BucketOrigin.withOriginAccessControl()` | OAC を自動設定しバケットポリシーも付与する |
| `blockPublicAccess: BLOCK_ALL` | OAC 経由のみアクセス許可、パブリック公開は不要 |

---

## デプロイ手順

```bash
# 1. フロントエンドをビルド（先に実行）
cd pkgs/frontend
bun run build

# 2. CDK deploy（S3アップロード + CloudFront キャッシュ無効化まで自動）
cd ../cdk
bun run deploy        # = cdk deploy -c target=aws
```

`BucketDeployment` が CDK の Custom Resource として動作し、デプロイ時に:
1. `dist/` の内容を S3 へアップロード
2. CloudFront の指定パスのキャッシュを無効化 (Invalidation)

---

## よくある落とし穴

| 症状 | 原因 | 対処 |
|------|------|------|
| `AccessDenied` (XML) | S3 バケットが空 | `bun run build` → `bun run deploy` |
| デプロイ後も古い画面 | `distribution` 未指定 | `distributionPaths: ["/*"]` を追加 |
| `CannotFindAsset` | `dist/` が存在しない | `bun run build` を先に実行 |
| OAC ポリシーなし | L1 で手動作成した場合 | L2 `withOriginAccessControl()` を使う |

---

## Floci ローカル環境との違い

| 項目 | Floci (local) | AWS (本番) |
|------|---------------|-----------|
| フロントエンド配信 | S3 パブリック公開 | CloudFront + OAC |
| ファイルアップロード | `aws s3 sync` 手動 or 省略可 | `BucketDeployment` で自動 |
| `blockPublicAccess` | オフ | `BLOCK_ALL` |
| キャッシュ無効化 | 不要 | `distributionPaths: ["/*"]` |
