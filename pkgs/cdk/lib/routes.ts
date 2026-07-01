/**
 * 収益化するルート。各ルートは以下を生成します：
 *   - CloudFront Function に紐付いた CloudFront ビヘイビア（パターン）、
 *   - WAF の `Monetize` ルール（WAF がそのルートに対して 402 を返すようにする）、および
 *   - 購入者が選択できる SPA の config.js のエントリ。
 *
 * ルートの追加はここに 1 エントリを追加するだけです。`contentType` は購入者のレンダラーが
 * JSON / Markdown / HTML フォーマットを選ぶためのヒントに過ぎません。実際にボディを
 * 出力するのは CloudFront Function です。
 */
export interface RouteSpec {
  /** ビヘイビアがマッチし購入者が呼び出すパス（例: "/weather"）。 */
  path: string;
  /** 購入者のルートピッカー用の短いラベル。 */
  label: string;
  /** レンダラーヒント：購入者が 200 ボディをどのようにフォーマットするか。 */
  contentType: "json" | "markdown" | "html";
  /** 価格乗数 × WebACL の基本 Amount。 */
  priceMultiplier: number;
}

// ここで対象のパスを指定する
export const ROUTES: RouteSpec[] = [
  { 
    path: "/weather", 
    label: "Weather (JSON)", 
    contentType: "json", 
    priceMultiplier: 1 
  },
  { 
    path: "/sports", 
    label: "Sports (Markdown)", 
    contentType: "markdown", 
    priceMultiplier: 2 
  },
  { 
    path: "/main.html", 
    label: "Landing (HTML)", 
    contentType: "html", 
    priceMultiplier: 1 
  },
];
