# デプロイ済み状態 (2026-07-01 時点)

## cdk-outputs.json

```json
{
  "X402WafSample": {
    "DistributionUrl": "https://d3274z4iiqwf6d.cloudfront.net",
    "SellerPayTo": "0x6A93800ADEd9E1f8a8c973145Ec19360598E7487",
    "FaucetUrl": "https://faucet.circle.com/",
    "PaidEndpoints": "https://d3274z4iiqwf6d.cloudfront.net/weather , https://d3274z4iiqwf6d.cloudfront.net/sports , https://d3274z4iiqwf6d.cloudfront.net/main.html",
    "WafMonetizationConsoleUrl": "https://us-east-1.console.aws.amazon.com/wafv2-pro/ai-revenue-payments/X402WafSample-acl/2e4a3c9d-d520-4b66-9b67-69ccc4611683?region=us-east-1&scope=global",
    "WafTrafficConsoleUrl": "https://us-east-1.console.aws.amazon.com/wafv2-pro/protections/X402WafSample-acl/2e4a3c9d-d520-4b66-9b67-69ccc4611683/ai-traffic?region=us-east-1&scope=global"
  }
}
```

## 有料エンドポイント確認

```bash
curl -i https://d3274z4iiqwf6d.cloudfront.net/weather
# → HTTP/2 402 (WAF が未払いリクエストを拒否)
```

## WAF コンソールで収益確認する際の注意

WAF の収益ダッシュボードはデフォルトが **mainnet** 表示。testnet の収益を確認するには:
1. WAF コンソール → AI revenue payments
2. Dashboard settings → **Environment: Test** に変更

## WebACL 情報

- **名前:** `X402WafSample-acl`
- **ID:** `2e4a3c9d-d520-4b66-9b67-69ccc4611683`
- **スコープ:** CLOUDFRONT (us-east-1 グローバル)
- **スタック名:** `X402WafSample`
