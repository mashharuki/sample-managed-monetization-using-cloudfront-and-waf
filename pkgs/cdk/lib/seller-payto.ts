/**
 * 販売者の payTo 受取アドレスを解決します — デプロイ時に一度生成され、
 * ローカルにキャッシュされるため、後続のデプロイをまたいで静的です（テンプレートの変動なし）。
 *
 * `cdk synth`/`deploy` 中に CDK プロセス内で実行されます（ランタイムではない）。
 * そのためカスタムリソースも Lambda も不要です。payTo アドレスは受け取りのみを行うため
 * 秘密鍵は不要です — キーペアを生成してアドレスのみを保持します。
 * キャッシュファイルは gitignore されており、削除することで新しい受取人にローテーションできます。
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const CACHE_FILE = path.join(__dirname, "..", ".seller-payto.json");

export function resolveSellerPayTo(): string {
  if (fs.existsSync(CACHE_FILE)) {
    try {
      const cached = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
      if (typeof cached.address === "string" && cached.address.startsWith("0x")) {
        return cached.address;
      }
    } catch {
      // フォールスルーして再生成
    }
  }
  const address = privateKeyToAccount(generatePrivateKey()).address;
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ address }, null, 2));
  return address;
}
