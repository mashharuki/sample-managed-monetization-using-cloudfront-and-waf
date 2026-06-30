# Amazon CloudFront と AWS WAF を使った AI トラフィックの収益化（x402）

**最小構成・`cdk deploy` 一発**で試せる **AWS WAF ネイティブ AI トラフィック収益化** のサンプルです。[x402 プロトコル](https://www.x402.org/) を使用しています。AWS WAF がエッジでコンテンツルートに価格を付けます。未払いリクエストは WAF から直接 `402` が返り、支払い済みリクエストは Base Sepolia 上で検証・決済された後にレスポンスが返ります。これはすべてワンラウンドトリップで完結し、Lambda@Edge もオリジンのペイウォールコードも不要です。

購入者側は単一の静的ページ（React + TypeScript、CDK がビルド）です。ブラウザ内で使い捨てウォレットを生成し、テストネットフォーセットから資金を補充した後、公式 [x402](https://www.x402.org/) クライアントライブラリを使って 402 の支払いを行います。チャレンジ・署名済みペイロード・決済レシートをそれぞれ個別のステップとして確認できるよう、ステップバイステップで操作できます。また、さまざまな AI ボットとしてトラフィックをバーストさせ、WAF コンソールで確認することもできます。

> **テストネット専用** — Base Sepolia。ウォレットはブラウザの localStorage に保存される使い捨て鍵です。実際の資金には使用しないでください。

| 1 回の支払いを詳細に | 複数の AI ボットが並列で支払い |
|---|---|
| ![有料の x402 ラウンドトリップ: リクエスト → 402、署名、リクエスト + 支払い → 200、そしてレンダリングされた JSON](docs/media/paid-json.png) | ![複数の AI ボットクライアントが並列でバースト支払い、各クライアントが Base Sepolia 上で決済](docs/media/multi-payment.png) |

<sub>左：**Call & pay** はリクエスト → 署名 → リクエスト + 支払いの 3 ステップを表示し、有料レスポンスをレンダリングします。右：並列バースト、クライアントごとに 1 行、「要求済み → 支払済み → 決済済み」が埋まっていきます（ID は匿名化済み）。</sub>

## アーキテクチャ

```
                 ┌──────────────────────── Amazon CloudFront ────────────────────────┐
   ブラウザ ───▶ │  AWS WAF (ネイティブ x402)    CloudFront Function      S3 (静的) │
   (購入者)      │  ├─ Bot Control v6 (Count → AI トラフィックラベル)    └─ SPA     │
                 │  ├─ /            → 許可 (無料)                                    │
                 │  ├─ /weather     → MONETIZE ─┐                                    │
                 │  ├─ /sports      → MONETIZE  ├─ 未払い → 402 PAYMENT-REQUIRED     │
                 │  ├─ /main.html   → MONETIZE ─┘  有効な支払い → 検証 + 決済 → CFF │
                 │  └─ /proxy → Lambda (実際の UA トラフィックジェネレータ、IAM + OAC) │
                 └────────────────────────────────────────────────────────────────────┘

  エッジの処理順序は WAF → CloudFront Function → オリジン:
  WAF が最初に価格検証を行うため、支払い済みリクエストだけがコンテンツ生成関数に到達します。
```

`cdk deploy` 一発ですべてが作成されます：

- **AWS WAF WebACL**（CLOUDFRONT スコープ）— x402 ポスチャ本体。Bot Control v6（Count、AI ボットラベル用）、WebACL `MonetizationConfig`（受取人・価格・Base Sepolia）、ルートごとの `Monetize` ルール。これらは実際の `AWS::WAFv2::WebACL` プロパティであり `addPropertyOverride` 経由で注入されています（現時点の `aws-cdk-lib` では型定義なし）— 純粋な CloudFormation で、**カスタムリソースも実行時 API 呼び出しも不要**。
- **CloudFront + S3** — `/` で SPA を提供し、各ルートは WAF が支払いを検証した*後*にコンテンツを返す **CloudFront Function** を実行します（`/weather` JSON · `/sports` Markdown · `/main.html` HTML）。
- **UA プロキシ Lambda**（`/proxy`、IAM Function URL + OAC）— ブラウザは `fetch` で `User-Agent` を設定できないため、トラフィックジェネレータが各リクエストを本物のボット UA でこの Lambda 経由で再送信し、WAF が正しくラベル付けできるようにします。
- **受取人の payTo アドレス** — デプロイ時に一度生成されてローカルにキャッシュされます。

ルートはレジストリ（`cdk/lib/routes.ts`）で管理されています。エントリを 1 つ追加するだけで、ビヘイビア・Monetize ルール・SPA のピッカー選択肢が追加されます。

## クイックスタート

前提条件：AWS アカウント、**us-east-1** 用の認証情報、Node 24 以上、CDK ブートストラップ。

```bash
cd cdk && npm install
npx cdk bootstrap            # アカウント/リージョンで初回のみ
npx cdk deploy --outputs-file ../cdk-outputs.json
```

**WAF でリクエストに価格をつける（ウォレット不要）：**

```bash
curl -i "$(jq -r '.X402WafSample.DistributionUrl' cdk-outputs.json)/weather"
# → HTTP/2 402  base64 エンコードされた PAYMENT-REQUIRED ヘッダー付き（価格、payTo、アセット、ネットワーク）
```

**ブラウザで支払い** — `DistributionUrl` を開く：

1. ページが自動的にウォレットを作成します。ウォレットドロップダウンから[Circle フォーセット](https://faucet.circle.com/)で資金を補充します（Base Sepolia USDC、ガス不要）。
2. ルートを選択 → **Call** で 402 を確認、または **Call & pay** でフルラウンドトリップを実行して有料コンテンツをレンダリング。
3. カウントを 1 以上に設定してクライアントを選択し、プロキシ経由で **AI ボットトラフィックをバースト**させます。**WAF traffic** / **revenue** リンクから AWS WAF AI トラフィックコンソールが開きます。

> **WAF コンソールで収益を確認する。** このサンプルは **Base Sepolia テストネット** 上で決済を行いますが、収益ダッシュボードはデフォルトで**メインネット**を表示するため、切り替えるまで**ゼロ**が表示されます。WAF の **AI revenue payments** ダッシュボードで **Dashboard settings** を開き、**Environment** を **Test** に設定してください — テストネット（`CurrencyMode: TEST`）フィルターで再クエリされ、支払い情報（カード、グラフ、テーブル）がレンダリングされます。[Revenue analytics](https://docs.aws.amazon.com/waf/latest/developerguide/waf-ai-traffic-monetization-analytics.html) を参照してください。
>
> <p align="center">
>   <img src="docs/media/waf-console-environment-test.png" alt="WAF コンソール → Dashboard settings → Environment: Test" width="480">
> </p>

**削除：** `cd cdk && npx cdk destroy`

## セキュリティ

テストネットデモです。購入者の鍵はブラウザの localStorage 内で生成され、外部に出ることはありません。受取人の payTo は秘密鍵を保持しません（受け取るだけです）。`/proxy` Lambda は設定されたルートへの GET リクエストを再送信し、上流のステータスだけを返します。実際の資金やメインネットの鍵をこのサンプルに通さないでください。セキュリティ上の問題は [CONTRIBUTING.md](CONTRIBUTING.md) に従って報告してください。

このサンプルはテストネット上で暗号通貨の支払いを決済しており、カード情報は扱いません。このパターンをカードデータの処理や本番決済システムに応用する場合は、[PCI-DSS](https://aws.amazon.com/compliance/pci-dss-level-1-faqs/) および適用される金融規制に準拠してください。

## ライセンス

MIT-0。[LICENSE](LICENSE) を参照してください。
