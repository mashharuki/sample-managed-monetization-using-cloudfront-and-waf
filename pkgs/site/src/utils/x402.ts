/**
 * 手動の x402 v2 ラウンドトリップ。UI が各レッグを表示できるよう 3 つのレッグに分解しています：
 *
 *   1. リクエスト    — リソースに GET。AWS WAF が PAYMENT-REQUIRED で 402 を返します。
 *   2. 署名          — ブラウザ内で EIP-3009 支払い認可を構築・署名します。
 *   3. リクエスト+支払い — PAYMENT-SIGNATURE 付きで再度 GET。WAF が検証・決済・配信します。
 *
 * レッグ 2 の署名済みペイロードが見えるよう、wrapFetchWithPayment のブラックボックスを
 * 使わずに @x402/core クライアントを直接操作します。
 */

import { x402Client } from "@x402/core/client";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const BASE_SEPOLIA_CAIP2 = "eip155:84532";

export type Leg = {
  title: string;
  status?: number;
  detail: string; // pretty-printed JSON / text for the panel
  ok: boolean;
};

export type RoundTrip = { legs: Leg[]; bodyContentType: string; body: string };

/** 3 つのレッグを実行し、各レッグが完了した瞬間に `onLeg` を呼び出します（UI がトリップ全体を
 *  待たずに各レッグ終了時にパネルをレンダリングできるようにするため）。最終的な集計も返します。 */
export async function payRoundTrip(
  url: string,
  privateKey: Hex,
  onLeg?: (leg: Leg) => void,
  legDelayMs = 0, // バースト時にファネルの各ステージが見えるよう、レッグ間の待機時間
): Promise<RoundTrip> {
  const legs: Leg[] = [];
  const sleep = (ms: number) =>
    ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve();
  const emit = async (leg: Leg) => {
    legs.push(leg);
    onLeg?.(leg);
    await sleep(legDelayMs);
  };
  const account = privateKeyToAccount(privateKey);
  const client = x402Client.fromConfig({
    schemes: [{ network: BASE_SEPOLIA_CAIP2, client: new ExactEvmScheme(account) }],
  });

  // レッグ 1 — 未払いリクエスト → 402 チャレンジ。
  const r1 = await fetch(url, { method: "GET" });
  const challengeHeader = r1.headers.get("PAYMENT-REQUIRED");
  const paymentRequired = challengeHeader ? decodePaymentRequiredHeader(challengeHeader) : null;
  await emit({
    title: "1 · Request",
    status: r1.status,
    ok: r1.status === 402,
    detail: paymentRequired
      ? JSON.stringify(paymentRequired, null, 2)
      : `(no PAYMENT-REQUIRED header; status ${r1.status})`,
  });
  if (r1.status !== 402 || !paymentRequired) {
    return { legs, bodyContentType: "text", body: await r1.text() };
  }

  // レッグ 2 — ブラウザ内で支払い認可に署名します。
  const payload = await client.createPaymentPayload(paymentRequired);
  const sigHeader = encodePaymentSignatureHeader(payload);
  await emit({
    title: "2 · Sign",
    ok: true,
    detail: JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  });

  // レッグ 3 — 署名付きで再試行 → 200 + 決済レシート。
  const r3 = await fetch(url, { method: "GET", headers: { "PAYMENT-SIGNATURE": sigHeader } });
  const receiptHeader = r3.headers.get("PAYMENT-RESPONSE");
  const receipt = receiptHeader ? decodePaymentResponseHeader(receiptHeader) : null;
  const bodyContentType = r3.headers.get("content-type") || "text";
  const body = await r3.text();
  await emit({
    title: "3 · Request + pay",
    status: r3.status,
    ok: r3.status === 200,
    detail: receipt ? JSON.stringify(receipt, null, 2) : `(status ${r3.status})`,
  });

  return { legs, bodyContentType, body };
}

/** レッグ 1 のみ — 支払いなしで 402 チャレンジを表示します。 */
export async function callOnly(url: string): Promise<Leg> {
  const r = await fetch(url, { method: "GET" });
  const h = r.headers.get("PAYMENT-REQUIRED");
  const challenge = h ? decodePaymentRequiredHeader(h) : null;
  return {
    title: "1 · Request",
    status: r.status,
    ok: r.status === 402,
    detail: challenge ? JSON.stringify(challenge, null, 2) : await r.text(),
  };
}
