import { useCallback, useEffect, useState } from "react";
import {
  createPublicClient,
  http,
  formatUnits,
  type Address,
  type Hex,
} from "viem";
import { baseSepolia } from "viem/chains";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { config } from "./config";

export type StoredWallet = {
  id: string;
  address: Address;
  privateKey: Hex;
  createdAt: number;
};

const LS_WALLETS = "x402.wallets";
const LS_ACTIVE = "x402.activeWalletId";

function load(): StoredWallet[] {
  try {
    return JSON.parse(localStorage.getItem(LS_WALLETS) || "[]");
  } catch {
    return [];
  }
}
function save(ws: StoredWallet[]) {
  localStorage.setItem(LS_WALLETS, JSON.stringify(ws));
}
function mint(): StoredWallet {
  const privateKey = generatePrivateKey();
  return {
    id: Math.random().toString(36).slice(2, 10),
    address: privateKeyToAccount(privateKey).address,
    privateKey,
    createdAt: Date.now(),
  };
}

const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/** Wallet manager: localStorage-backed, browser-only keys, live balance polling.
 *  Balances are tracked per-wallet (keyed by id) so a custom dropdown can show the
 *  USDC balance next to every wallet, not just the active one. */
export function useWallets() {
  const [wallets, setWallets] = useState<StoredWallet[]>([]);
  const [activeId, setActive] = useState<string | null>(null);
  const [balances, setBalances] = useState<Record<string, string>>({});

  // Bootstrap: ensure at least one wallet exists.
  useEffect(() => {
    let ws = load();
    if (ws.length === 0) {
      ws = [mint()];
      save(ws);
      localStorage.setItem(LS_ACTIVE, ws[0].id);
    }
    setWallets(ws);
    setActive(localStorage.getItem(LS_ACTIVE) ?? ws[0].id);
  }, []);

  const active = wallets.find((w) => w.id === activeId) ?? wallets[0] ?? null;

  // Refresh USDC balances for EVERY stored wallet (so the dropdown shows each).
  const refreshBalance = useCallback(async () => {
    const current = load();
    const entries = await Promise.all(
      current.map(async (w) => {
        try {
          const usdc = (await publicClient.readContract({
            address: config.usdcAddress,
            abi: ERC20_BALANCE_ABI,
            functionName: "balanceOf",
            args: [w.address],
          })) as bigint;
          return [w.id, Number(formatUnits(usdc, 6)).toFixed(3)] as const;
        } catch {
          return [w.id, "?"] as const;
        }
      }),
    );
    setBalances(Object.fromEntries(entries));
  }, []);

  // Refresh balances on load + whenever the wallet set changes (NOT on a timer —
  // callers also invoke refreshBalance() after each request/batch).
  useEffect(() => {
    if (wallets.length === 0) return;
    refreshBalance();
  }, [wallets, refreshBalance]);

  const regenerate = useCallback(() => {
    const w = mint();
    const next = [...load(), w];
    save(next);
    localStorage.setItem(LS_ACTIVE, w.id);
    setWallets(next);
    setActive(w.id);
  }, []);

  const use = useCallback((id: string) => {
    localStorage.setItem(LS_ACTIVE, id);
    setActive(id);
  }, []);

  const remove = useCallback(
    (id: string) => {
      const next = load().filter((w) => w.id !== id);
      const ensured = next.length ? next : [mint()];
      save(ensured);
      let nextActive = localStorage.getItem(LS_ACTIVE);
      if (nextActive === id || !ensured.find((w) => w.id === nextActive)) {
        nextActive = ensured[0].id;
        localStorage.setItem(LS_ACTIVE, nextActive);
      }
      setWallets(ensured);
      setActive(nextActive);
    },
    [],
  );

  return { wallets, active, balances, refreshBalance, regenerate, use, remove };
}
