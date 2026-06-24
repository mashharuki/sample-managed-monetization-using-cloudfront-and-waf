/**
 * Resolve the seller's payTo receiver address — generated once at deploy time and
 * cached locally so it's STATIC across subsequent deploys (no template churn).
 *
 * Runs in the CDK process during `cdk synth`/`deploy` (not at runtime), so there's
 * no custom resource and no Lambda. A payTo address only ever RECEIVES, so the
 * private key is irrelevant — we mint a keypair and keep only the address. The
 * cache file is gitignored; delete it to rotate to a fresh receiver.
 */
import * as fs from "fs";
import * as path from "path";
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
      // fall through and regenerate
    }
  }
  const address = privateKeyToAccount(generatePrivateKey()).address;
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ address }, null, 2));
  return address;
}
