import { useMemo, useState } from "react";
import { ContentView } from "./ContentView";
import { config, DEFAULT_USER_AGENTS } from "./utils/config";
import { useWallets } from "./utils/wallet";
import { callOnly, type Leg, payRoundTrip } from "./utils/x402";
import { WalletPicker } from "./WalletPicker";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shortUA = (u: string) => u.split("/")[0].replace(/Bot$/i, "").trim() || u.slice(0, 14);

/**
 * 連続的なジッター付きインフライトスケジューラー。固定バッチを発射して各バッチが
 * 空になるのを待つ方式（波の間にインフライト数がゼロになるのこぎり波パターン）の代わりに、
 * 常に一定のインフライトリクエスト数を *ソフトターゲット* として維持します。
 * 1 つが完了するたびにターゲットまで補充されます — 通常は 1 つの代替を起動し、
 * ターゲットがジッターで上昇した場合は複数起動することもあります。
 * ターゲット自体が補充のたびに [min,max] の範囲で再決定されるため、
 * ストリームは一定値に固定されずに有機的に変動します。
 * `total` 件のリクエストがすべて完了したら解決します。`runAt(i)` は i 番目の計画ジョブを実行します。
 */
function runPool(opts: {
  total: number;
  min: number;
  max: number;
  runAt: (i: number) => Promise<void>;
}): Promise<void> {
  const { total, min, max, runAt } = opts;
  const jitterTarget = () => min + Math.floor(Math.random() * (max - min + 1));
  return new Promise<void>((resolve) => {
    if (total <= 0) return resolve();
    let launched = 0;
    let completed = 0;
    let inFlight = 0;
    const topUp = () => {
      const target = Math.max(1, jitterTarget());
      while (inFlight < target && launched < total) {
        const i = launched++;
        inFlight++;
        runAt(i).finally(() => {
          inFlight--;
          completed++;
          if (completed >= total) resolve();
          else topUp();
        });
      }
    };
    topUp();
  });
}

const LS_UAS = "x402.customUserAgents";
function loadCustomUAs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(LS_UAS) || "[]");
  } catch {
    return [];
  }
}

export function App() {
  const { wallets, active, balances, refreshBalance, regenerate, use, remove } = useWallets();

  // request widget state
  const [routePath, setRoutePath] = useState(config.routes[0]?.path ?? "/weather");
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);

  // result state
  const [status, setStatus] = useState("");
  const [legs, setLegs] = useState<Leg[]>([]);
  // ラウンドトリップ中に表示するレッグパネルの合計数（未到着のものはローダーとしてレンダリング）。
  // 0 = 3 レッグのトリップを実行していない。
  const [expectedLegs, setExpectedLegs] = useState(0);
  const [content, setContent] = useState<{ contentType: string; body: string } | null>(null);
  // count>1 の Call バースト用のライブトラフィック集計。
  const [tally, setTally] = useState<{
    total: number;
    target: number;
    byClient: Record<string, { n: number; c402: number }>;
  } | null>(null);
  // ライブ PAY 集計：UA ごとのファネル — 計画数、次に各ステージの進行状況（要求済み → 支払済み → 決済済み）。
  type PayStage = { planned: number; requested: number; paid: number; settled: number };
  const [payTally, setPayTally] = useState<{
    target: number;
    byClient: Record<string, PayStage>;
  } | null>(null);

  const LEG_TITLES = ["1 · Request", "2 · Sign", "3 · Request + pay"];

  // user-agents for count>1 bursts
  const [customUAs, setCustomUAs] = useState<string[]>(loadCustomUAs());
  const allUAs = useMemo(() => [...DEFAULT_USER_AGENTS, ...customUAs], [customUAs]);
  const [selectedUAs, setSelectedUAs] = useState<string[]>(() => [...DEFAULT_USER_AGENTS]);
  const [newUa, setNewUa] = useState("");

  const route = config.routes.find((r) => r.path === routePath) ?? config.routes[0];
  const url = `${config.baseUrl}${routePath}`;

  function toggleUA(ua: string) {
    setSelectedUAs((p) => (p.includes(ua) ? p.filter((u) => u !== ua) : [...p, ua]));
  }
  function reset() {
    setLegs([]);
    setExpectedLegs(0);
    setContent(null);
    setTally(null);
    setPayTally(null);
  }

  // CALL — N=1: 単一の 402 レッグ。N>1: 選択したクライアントを横断した並列ジッター付きバースト
  // → WAF AI トラフィックビュー用のライブトラフィック集計（クライアントごとのバー）。
  async function call() {
    reset();
    setBusy(true);
    try {
      if (count <= 1) {
        setStatus("Calling — no payment…");
        const leg = await callOnly(url);
        setLegs([leg]);
        setStatus(leg.ok ? "402 — AWS WAF priced the request." : `Status ${leg.status}.`);
        refreshBalance();
        return;
      }

      const uas = selectedUAs.length ? selectedUAs : DEFAULT_USER_AGENTS;
      // 合計は設定したカウントと正確に一致します。ジッターはバッチ処理/タイミングにのみ存在します。
      const target = Math.max(1, count);
      const jobs = Array.from({ length: target }, (_, i) => uas[i % uas.length]);
      // クライアントがインターリーブするようにシャッフル
      for (let i = jobs.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
      }

      const byClient: Record<string, { n: number; c402: number }> = {};
      for (const ua of uas) byClient[ua] = { n: 0, c402: 0 };
      let total = 0;
      setTally({ total: 0, target, byClient: { ...byClient } });
      setStatus(`Sending ${target} requests across ${uas.length} clients…`);

      const fireOne = async (ua: string) => {
        // 各リクエストが時間的に分散するようにジッター付き開始（リアルに見え、並列処理が見える）
        await sleep(Math.random() * 700);
        // UA プロキシを経由：ブラウザは User-Agent を設定できないため、プロキシが
        // 本物の UA で GET を再発行します → WAF が真のボットとして認識しラベル付けします。
        const purl = `${config.baseUrl}${config.proxyPath}?target=${encodeURIComponent(routePath)}&ua=${encodeURIComponent(ua)}&origin=${encodeURIComponent(config.baseUrl)}`;
        let c402 = 0;
        try {
          const r = await fetch(purl, { method: "GET", cache: "no-store" });
          const j = await r.json().catch(() => null);
          if (j && j.upstreamStatus === 402) c402 = 1;
        } catch {
          /* count as sent */
        }
        const e = byClient[ua];
        e.n += 1;
        e.c402 += c402;
        total += 1;
        setTally({ total, target, byClient: { ...byClient } });
        setStatus(`Sent ${total}/${target}…`);
      };

      // 連続ジッターストリーム：常に ~3–14 のリクエストをインフライト状態に保ち、
      // 各完了時に補充します。これにより、フルバッチとゼロの間でのこぎり波を描く代わりに
      // トラフィックが有機的に見えます。
      await runPool({ total: jobs.length, min: 3, max: 14, runAt: (i) => fireOne(jobs[i]) });
      const tot402 = Object.values(byClient).reduce((s, e) => s + e.c402, 0);
      setStatus(
        `Done — ${tot402}/${target} returned 402. Open the WAF AI-traffic console to see the mix.`,
      );
      refreshBalance(); // after the batch (unpaid 402s don't move funds, but keeps it fresh)
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  // 完全な 3 レッグのラウンドトリップを 1 回実行し、各レッグが完了するたびにストリーミングします。
  async function oneRoundTrip(streamLegs: boolean) {
    if (!active) return false;
    if (streamLegs) {
      setLegs([]);
      setExpectedLegs(3);
    }
    const progress = ["Requesting", "Signing", "Paying + settling"];
    const rt = await payRoundTrip(url, active.privateKey, (leg) => {
      if (!streamLegs) return;
      setLegs((prev) => {
        const next = [...prev, leg];
        const upcoming = progress[next.length];
        if (upcoming) setStatus(`${next.length + 1} · ${upcoming}…`);
        return next;
      });
    });
    const paid = rt.legs[rt.legs.length - 1]?.ok;
    if (paid) setContent({ contentType: rt.bodyContentType, body: rt.body });
    return !!paid;
  }

  // CALL & PAY — count=1: 1 回の支払いの 3 レッグ解剖図 + レンダリングされたコンテンツ。
  // count>1: 並列有料ラウンドトリップとライブ決済集計（レッグ/コンテンツなし —
  // 各支払いが着地するたびに更新される実行中の決済数 + 金額のみ）。
  async function callAndPay() {
    if (!active) return;
    reset();
    setBusy(true);
    try {
      if (count <= 1) {
        setStatus("1 · Requesting…");
        const ok = await oneRoundTrip(true);
        setStatus(
          ok
            ? "200 — paid, settled, and served. Balance will tick down."
            : "Payment didn't complete — is the wallet funded with Base Sepolia USDC?",
        );
        refreshBalance();
        return;
      }

      // 並列有料ラウンドトリップ → UA ごとのライブファネル（要求済み → 支払済み → 決済済み）。
      // ステップ 1 — 計画：選択したクライアントに対してラウンドロビンで正確に `count` 回の
      // 支払いを割り当て、リクエストが発火する前に UA ごとの行が確定するようにします。
      const pk = active.privateKey;
      const uas = selectedUAs.length ? selectedUAs : DEFAULT_USER_AGENTS;
      const target = Math.max(1, count);
      const planList: string[] = Array.from({ length: target }, (_, k) => uas[k % uas.length]);
      const funnel: Record<string, PayStage> = {};
      for (const ua of uas) funnel[ua] = { planned: 0, requested: 0, paid: 0, settled: 0 };
      for (const ua of planList) funnel[ua].planned += 1;

      // ステップ 2 — 計画を前もってレンダリング（計画数を持つ行、進行状況は 0）。
      setPayTally({ target, byClient: { ...funnel } });
      setStatus(
        `Planned ${target} payments across ${Object.values(funnel).filter((f) => f.planned > 0).length} clients — bursting…`,
      );
      let settled = 0;

      // ステップ 3 — バースト。各レッグ（要求 → 署名 → 決済）でリアルタイムに各行を更新。
      const payOne = async (ua: string) => {
        await sleep(Math.random() * 700);
        try {
          // レッグ間に ~600ms の待機を設けることで、各ユニットが緑にスナップする代わりに
          // 琥珀（要求済み）→ 紫（支払済み）→ 緑（決済済み）と視覚的に遷移します。
          await payRoundTrip(
            url,
            pk,
            (leg) => {
              const f = funnel[ua];
              if (leg.title.startsWith("1")) f.requested += 1;
              else if (leg.title.startsWith("2")) f.paid += 1;
              else if (leg.title.startsWith("3") && leg.ok) {
                f.settled += 1;
                settled += 1;
              }
              setPayTally({ target, byClient: { ...funnel } });
            },
            600,
          );
        } catch {
          /* レッグファネルはすでにどこまで到達したかを反映しています */
        }
        setStatus(`Settled ${settled}/${target}…`);
        refreshBalance();
      };

      // 連続ジッターストリーム：常に ~2–6 の有料ラウンドトリップをインフライト状態に保ち、
      // 各決済時に補充します。これにより、フルバッチが空になるのを待つ代わりに
      // ファネルがスムーズに進行します。
      await runPool({ total: planList.length, min: 2, max: 6, runAt: (i) => payOne(planList[i]) });
      setStatus(
        `Done — ${settled}/${target} payments settled on Base Sepolia. Balance ticked down.`,
      );
      refreshBalance();
    } catch (e) {
      setStatus(`Payment failed — ${String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  function addUa() {
    const v = newUa.trim();
    if (!v || allUAs.includes(v)) return;
    const next = [...customUAs, v];
    localStorage.setItem(LS_UAS, JSON.stringify(next));
    setCustomUAs(next);
    setSelectedUAs((p) => [...p, v]);
    setNewUa("");
  }

  return (
    <div className="wrap">
      <header className="topbar">
        <div className="topbar-text">
          <span className="eyebrow">x402 · AWS WAF AI Traffic Monetization</span>
          <h1>Pay-per-request content, priced by AWS WAF</h1>
          <p>
            Native WAF monetization over the{" "}
            <a href="https://www.x402.org/" target="_blank" rel="noreferrer">
              x402 protocol
            </a>
            : call a route →<b> 402</b> → pay from a browser wallet → WAF settles on Base Sepolia
            and serves JSON/Markdown/HTML.
          </p>
        </div>
        <div className="topbar-wallet">
          <WalletPicker
            wallets={wallets}
            active={active}
            balances={balances}
            onUse={use}
            onRegenerate={regenerate}
            onRemove={remove}
          />
        </div>
      </header>

      {/* リクエスト */}
      <section className="card">
        <div className="reqbar">
          <select
            className="route-select"
            value={routePath}
            onChange={(e) => {
              setRoutePath(e.target.value);
              reset();
            }}
          >
            {config.routes.map((r) => (
              <option key={r.path} value={r.path}>
                {r.path} · {r.label}
              </option>
            ))}
          </select>
          <span className="perua">
            ×
            <input
              type="number"
              min={1}
              max={200}
              value={count}
              onChange={(e) => setCount(parseInt(e.target.value || "1", 10))}
            />
          </span>
          <button type="button" onClick={call} disabled={busy}>
            Call
          </button>
          <button
            type="button"
            className="secondary"
            onClick={callAndPay}
            disabled={busy || !active}
          >
            Call &amp; pay
          </button>
          <span className="grow" />
          <a href={config.wafTrafficUrl} target="_blank" rel="noreferrer" className="link">
            WAF traffic ↗
          </a>
          <a href={config.wafMonetizationUrl} target="_blank" rel="noreferrer" className="link">
            revenue ↗
          </a>
        </div>
        {count > 1 && (
          <div className="ualist">
            <span className="ualabel">clients:</span>
            {allUAs.map((u) => (
              <label key={u} className="ua" title={u}>
                <input
                  type="checkbox"
                  checked={selectedUAs.includes(u)}
                  onChange={() => toggleUA(u)}
                />
                <span>{u.length > 40 ? `${u.slice(0, 37)}…` : u}</span>
              </label>
            ))}
            <span className="addua">
              <input
                placeholder="add UA…"
                value={newUa}
                onChange={(e) => setNewUa(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addUa()}
              />
            </span>
          </div>
        )}
      </section>

      {/* 3 · 結果：レッグを並べて表示し、次にレンダリングされたコンテンツ */}
      <section className="card">
        <div className="hint resp-status">
          {status || "Pick a route, then Call (402) or Call & pay (full round-trip)."}
        </div>
        {(legs.length > 0 || expectedLegs > 0) && (
          <div className="legs">
            {Array.from({ length: Math.max(legs.length, expectedLegs) }).map((_, i) => {
              const leg = legs[i];
              if (leg) {
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: legs are strictly sequential and never reordered
                  <div key={i} className={`leg ${leg.ok ? "ok" : "bad"}`}>
                    <div className="leg-head">
                      {leg.title}
                      {leg.status != null && (
                        <span
                          className={`pill ${leg.status === 402 ? "b402" : leg.status === 200 ? "b200" : ""}`}
                        >
                          {leg.status}
                        </span>
                      )}
                    </div>
                    <pre className="leg-body">{leg.detail}</pre>
                  </div>
                );
              }
              // 保留中のレッグ → ローダープレースホルダー
              const inFlight = i === legs.length; // 次のレッグが今実行中
              return (
                // biome-ignore lint/suspicious/noArrayIndexKey: legs are strictly sequential and never reordered
                <div key={i} className="leg pending">
                  <div className="leg-head">
                    {LEG_TITLES[i] ?? `${i + 1} · …`}
                    {inFlight && <span className="spinner" />}
                  </div>
                  <div className="leg-body skeleton">
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {content && (
          <div className="content-out">
            <div className="content-label">Paid response · {route?.contentType.toUpperCase()}</div>
            <ContentView contentType={content.contentType} body={content.body} />
          </div>
        )}
        {tally && (
          <div className="tally">
            <div className="tally-top">
              <span className="tally-count">
                {tally.total}
                <span className="of"> / {tally.target}</span>
              </span>
              <span className="tally-label">
                unpaid requests · every one → <span className="pill b402">402</span>
              </span>
            </div>
            {Object.entries(tally.byClient)
              .filter(([, e]) => e.n > 0 || tally.total < tally.target)
              .map(([ua, e]) => {
                const max = Math.max(1, ...Object.values(tally.byClient).map((x) => x.n));
                return (
                  <div key={ua} className="bar-row">
                    <span className="bar-name" title={ua}>
                      {shortUA(ua)}
                    </span>
                    <span className="bar-track">
                      <span className="bar-fill" style={{ width: `${(e.n / max) * 100}%` }} />
                    </span>
                    <span className="bar-n">{e.n}</span>
                  </div>
                );
              })}
          </div>
        )}
        {payTally && (
          <div className="tally">
            <div className="tally-legend">
              <span>
                <i className="seg req" /> requested (402)
              </span>
              <span>
                <i className="seg paid" /> paid (signed)
              </span>
              <span>
                <i className="seg set" /> settled (200)
              </span>
            </div>
            {Object.entries(payTally.byClient)
              .filter(([, f]) => f.planned > 0)
              .map(([ua, f]) => {
                // 3 つのレイヤー、それぞれ左端に固定し、幅は計画合計に対する累積数
                //（決済済み ⊆ 支払済み ⊆ 要求済み）。z-index でスタック：琥珀（要求済み）が後ろ、
                // 紫（支払済み）がその上、緑（決済済み）が最前面。各バンドはステージが進むにつれて
                // 左→右に成長し、累積数が異なるため緑|紫|琥珀|空のバンドが見えます。
                // 後ろのグレーのトラックは計画（保留中）合計 — フレーム 1 から表示されます。
                const d = Math.max(1, f.planned);
                const pct = (n: number) => `${(Math.max(0, n) / d) * 100}%`;
                return (
                  <div key={ua} className="bar-row">
                    <span className="bar-name" title={ua}>
                      {shortUA(ua)}
                    </span>
                    <span
                      className="bar-track stacked"
                      title={`planned ${f.planned} · requested ${f.requested} · paid ${f.paid} · settled ${f.settled}`}
                    >
                      <span className="seg req" style={{ width: pct(f.requested) }} />
                      <span className="seg paid" style={{ width: pct(f.paid) }} />
                      <span className="seg set" style={{ width: pct(f.settled) }} />
                    </span>
                    <span className="bar-n">
                      {f.settled}/{f.planned}
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </section>
    </div>
  );
}
