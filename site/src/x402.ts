/**
 * Manual x402 v2 round-trip, broken into its three legs so the UI can show each:
 *
 *   1. request      — GET the resource; AWS WAF answers 402 with PAYMENT-REQUIRED.
 *   2. sign         — build + sign the EIP-3009 payment authorization in the browser.
 *   3. request+pay  — GET again with PAYMENT-SIGNATURE; WAF verifies, settles, serves.
 *
 * We drive the @x402/core client directly (instead of the wrapFetchWithPayment
 * black box) precisely so the signed payload from leg 2 is visible.
 */
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client } from "@x402/core/client";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm";

const BASE_SEPOLIA_CAIP2 = "eip155:84532";

export type Leg = {
  title: string;
  status?: number;
  detail: string; // pretty-printed JSON / text for the panel
  ok: boolean;
};

export type RoundTrip = { legs: Leg[]; bodyContentType: string; body: string };

/** Run the three legs, invoking `onLeg` the MOMENT each completes (so the UI can
 *  render each panel as soon as its leg ends instead of waiting for the whole trip).
 *  Also returns the final aggregate. */
export async function payRoundTrip(
  url: string,
  privateKey: Hex,
  onLeg?: (leg: Leg) => void,
  legDelayMs = 0, // dwell between legs so the funnel stages are visible in a burst
): Promise<RoundTrip> {
  const legs: Leg[] = [];
  const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
  const emit = async (leg: Leg) => {
    legs.push(leg);
    onLeg?.(leg);
    await sleep(legDelayMs);
  };
  const account = privateKeyToAccount(privateKey);
  const client = x402Client.fromConfig({
    schemes: [{ network: BASE_SEPOLIA_CAIP2, client: new ExactEvmScheme(account) }],
  });

  // Leg 1 — unpaid request → 402 challenge.
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

  // Leg 2 — sign the payment authorization in the browser.
  const payload = await client.createPaymentPayload(paymentRequired);
  const sigHeader = encodePaymentSignatureHeader(payload);
  await emit({
    title: "2 · Sign",
    ok: true,
    detail: JSON.stringify(payload, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2),
  });

  // Leg 3 — retry with the signature → 200 + settlement receipt.
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

/** Leg 1 only — show the 402 challenge without paying. */
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
