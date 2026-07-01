import { useEffect, useRef, useState } from "react";
import { config } from "./utils/config";
import type { StoredWallet } from "./utils/wallet";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Props = {
  wallets: StoredWallet[];
  active: StoredWallet | null;
  balances: Record<string, string>;
  onUse: (id: string) => void;
  onRegenerate: () => void;
  onRemove: (id: string) => void;
};

/** カスタムウォレットドロップダウン：トリガーはアクティブなウォレット + 残高を表示します。
 *  開いたパネルはすべてのウォレットを残高とともに一覧表示し、行ごとにコピー/補充/削除ができます。
 *  さらに「新しいウォレット」アクションもあります — そのため外部ツールバーは不要です。 */
export function WalletPicker({ wallets, active, balances, onUse, onRegenerate, onRemove }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const bal = (id: string) => balances[id] ?? "…";

  return (
    <div className="wp" ref={ref}>
      <button type="button" className="wp-trigger" onClick={() => setOpen((o) => !o)}>
        <span className="wp-addr">{active ? short(active.address) : "—"}</span>
        <span className="wp-bal">
          {active ? bal(active.id) : "0.000"} <span className="unit">USDC</span>
        </span>
        <span className="wp-caret">▾</span>
      </button>

      {open && (
        <div className="wp-menu">
          {wallets.map((w) => (
            <div key={w.id} className={`wp-row ${active && w.id === active.id ? "active" : ""}`}>
              <button
                type="button"
                className="wp-pick"
                title={w.address}
                onClick={() => {
                  onUse(w.id);
                  setOpen(false);
                }}
              >
                <span className="wp-dot">{active && w.id === active.id ? "●" : "○"}</span>
                <span className="wp-row-addr">{short(w.address)}</span>
                <span className="wp-row-bal">{bal(w.id)} USDC</span>
              </button>
              <div className="wp-actions">
                <button
                  type="button"
                  className="ic"
                  title="Copy address"
                  onClick={() => navigator.clipboard.writeText(w.address)}
                >
                  ⧉
                </button>
                <a
                  className="ic"
                  title="Fund at faucet"
                  href={config.faucetUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  ＋
                </a>
                <button
                  type="button"
                  className="ic danger"
                  title="Delete wallet"
                  onClick={() => onRemove(w.id)}
                >
                  🗑
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="wp-new"
            onClick={() => {
              onRegenerate();
            }}
          >
            ＋ New wallet
          </button>
        </div>
      )}
    </div>
  );
}
