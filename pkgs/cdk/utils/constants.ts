// ── チェーン / 決済 ──────────────────────────────────────────
/** Base Sepolia USDC コントラクト — 購入者が支払いに使用するトークン。 */
export const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
/** Base Sepolia のチェーン ID。 */
export const BASE_SEPOLIA_CHAIN_ID = 84532;
/** Bot Control マネージドルールグループのバージョン。v6 以上必須（AI トラフィックラベル対応）。 */
export const BOT_CONTROL_VERSION = "Version_6.0";
/** WAF Monetize ルールのデフォルト基本価格（USDC）。 */
export const DEFAULT_PRICE_USDC = "0.001";

// ── URL ──────────────────────────────────────────────────────
/** Circle テストネットフォーセット。ページから資金補充のためにディープリンクします。 */
export const CIRCLE_FAUCET_URL = "https://faucet.circle.com/";

// ── サイトバンドル ────────────────────────────────────────────
/** BucketDeployment のフォールバック用 Docker イメージ（実質未使用）。 */
export const SITE_BUNDLE_DOCKER_IMAGE = "public.ecr.aws/sam/build-nodejs24.x:1.149.0";

// ── CloudFront ───────────────────────────────────────────────
/** エッジ CloudFront Function に転送するビューワー国ヘッダー名。 */
export const VIEWER_COUNTRY_HEADER = "CloudFront-Viewer-Country";
/** UA プロキシの CloudFront ビヘイビアパス。 */
export const PROXY_PATH = "/proxy";
/** 有料ルート用キャッシュポリシーのデフォルト / 最小 TTL（秒）。 */
export const CACHE_DEFAULT_TTL_SEC = 0;
/** 有料ルート用キャッシュポリシーの最大 TTL（秒）。 */
export const CACHE_MAX_TTL_SEC = 1;

// ── Lambda ───────────────────────────────────────────────────
/** UA プロキシ Lambda のタイムアウト（秒）。 */
export const PROXY_TIMEOUT_SEC = 15;
