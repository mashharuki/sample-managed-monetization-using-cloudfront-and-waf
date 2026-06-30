import { useMemo, useState } from "react";
import { ContentView } from "./ContentView";
import { config, DEFAULT_USER_AGENTS } from "./utils/config";
import { useWallets } from "./utils/wallet";
import { callOnly, payRoundTrip, type Leg } from "./utils/x402";
import { WalletPicker } from "./WalletPicker";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const shortUA = (u: string) => u.split("/")[0].replace(/Bot$/i, "").trim() || u.slice(0, 14);

/**
 * Continuous, jittered in-flight scheduler. Instead of firing fixed batches and
 * waiting for each to drain (which sawtooths the in-flight count down to zero
 * between waves), this keeps a *soft target* of requests in flight at all times:
 * every time one completes it tops back up to the target — usually launching one
 * replacement, occasionally several when the target has jittered upward. The
 * target itself re-rolls within [min,max] on each top-up so the stream drifts
 * organically rather than sitting at a constant. Resolves once all `total`
 * requests have COMPLETED. `runAt(i)` runs the i-th planned job.
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
  // How many leg panels to show total during a round-trip (so the not-yet-arrived
  // ones render as loaders). 0 = not running a 3-leg trip.
  const [expectedLegs, setExpectedLegs] = useState(0);
  const [content, setContent] = useState<{ contentType: string; body: string } | null>(null);
  // Live traffic tally for count>1 Call bursts.
  const [tally, setTally] = useState<{ total: number; target: number; byClient: Record<string, { n: number; c402: number }> } | null>(null);
  // Live PAY tally: per-UA funnel — planned count, then how far each got (requested → paid → settled).
  type PayStage = { planned: number; requested: number; paid: number; settled: number };
  const [payTally, setPayTally] = useState<{ target: number; byClient: Record<string, PayStage> } | null>(null);

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

  // CALL — N=1: single 402 leg. N>1: a parallel, jittered burst across the selected
  // clients → a LIVE traffic tally (per-client bars) for the WAF AI-traffic view.
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
      // Total is EXACTLY the configured count. Jitter lives only in the batching/timing.
      const target = Math.max(1, count);
      const jobs = Array.from({ length: target }, (_, i) => uas[i % uas.length]);
      // shuffle so clients interleave
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
        // jittered start so each request spreads over time (realistic; visibly parallel)
        await sleep(Math.random() * 700);
        // Go through the UA proxy: the browser CAN'T set User-Agent, so the proxy
        // re-issues the GET with the real UA → WAF sees a genuine bot and labels it.
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

      // Continuous jittered stream: keep ~3–14 requests in flight at all times,
      // topping up as each completes, so traffic looks organic instead of
      // sawtoothing between full batches and zero.
      await runPool({ total: jobs.length, min: 3, max: 14, runAt: (i) => fireOne(jobs[i]) });
      const tot402 = Object.values(byClient).reduce((s, e) => s + e.c402, 0);
      setStatus(`Done — ${tot402}/${target} returned 402. Open the WAF AI-traffic console to see the mix.`);
      refreshBalance(); // after the batch (unpaid 402s don't move funds, but keeps it fresh)
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Run ONE full 3-leg round-trip, streaming each leg as it completes.
  async function oneRoundTrip(streamLegs: boolean) {
    if (!active) return false;
    if (streamLegs) { setLegs([]); setExpectedLegs(3); }
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

  // CALL & PAY — count=1: the 3-leg anatomy of one payment + rendered content.
  // count>1: PARALLEL paid round-trips with a LIVE settlement tally (no legs/content —
  // just the running settled count + amount, updating as each payment lands).
  async function callAndPay() {
    if (!active) return;
    reset();
    setBusy(true);
    try {
      if (count <= 1) {
        setStatus("1 · Requesting…");
        const ok = await oneRoundTrip(true);
        setStatus(ok ? "200 — paid, settled, and served. Balance will tick down." : "Payment didn't complete — is the wallet funded with Base Sepolia USDC?");
        refreshBalance();
        return;
      }

      // Parallel paid round-trips → a live PER-UA funnel (requested → paid → settled),
      // STEP 1 — plan: allocate exactly `count` payments across the selected clients
      // (round-robin), so the per-UA rows are known before any request fires.
      const pk = active.privateKey;
      const uas = selectedUAs.length ? selectedUAs : DEFAULT_USER_AGENTS;
      const target = Math.max(1, count);
      const planList: string[] = Array.from({ length: target }, (_, k) => uas[k % uas.length]);
      const funnel: Record<string, PayStage> = {};
      for (const ua of uas) funnel[ua] = { planned: 0, requested: 0, paid: 0, settled: 0 };
      for (const ua of planList) funnel[ua].planned += 1;

      // STEP 2 — render the plan up front (rows with their planned counts, 0 progress).
      setPayTally({ target, byClient: { ...funnel } });
      setStatus(`Planned ${target} payments across ${Object.values(funnel).filter((f) => f.planned > 0).length} clients — bursting…`);
      let settled = 0;

      // STEP 3 — burst, updating each row live on every leg (request → sign → settle).
      const payOne = async (ua: string) => {
        await sleep(Math.random() * 700);
        try {
          // ~600ms dwell between legs so each unit is visibly amber (requested) →
          // purple (paid) → green (settled) instead of snapping straight to green.
          await payRoundTrip(url, pk, (leg) => {
            const f = funnel[ua];
            if (leg.title.startsWith("1")) f.requested += 1;
            else if (leg.title.startsWith("2")) f.paid += 1;
            else if (leg.title.startsWith("3") && leg.ok) { f.settled += 1; settled += 1; }
            setPayTally({ target, byClient: { ...funnel } });
          }, 600);
        } catch {
          /* leg funnel already reflects how far it got */
        }
        setStatus(`Settled ${settled}/${target}…`);
        refreshBalance();
      };

      // Continuous jittered stream: keep ~2–6 paid round-trips in flight at all
      // times, topping up as each settles, so the funnel advances smoothly instead
      // of waiting for whole batches to drain.
      await runPool({ total: planList.length, min: 2, max: 6, runAt: (i) => payOne(planList[i]) });
      setStatus(`Done — ${settled}/${target} payments settled on Base Sepolia. Balance ticked down.`);
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
            <a href="https://www.x402.org/" target="_blank" rel="noreferrer">x402 protocol</a>: call a route →
            <b> 402</b> → pay from a browser wallet → WAF settles on Base Sepolia and serves JSON/Markdown/HTML.
          </p>
        </div>
        <div className="topbar-wallet">
          <WalletPicker wallets={wallets} active={active} balances={balances} onUse={use} onRegenerate={regenerate} onRemove={remove} />
        </div>
      </header>

      {/* REQUEST */}
      <section className="card">
        <div className="reqbar">
          <select className="route-select" value={routePath} onChange={(e) => { setRoutePath(e.target.value); reset(); }}>
            {config.routes.map((r) => <option key={r.path} value={r.path}>{r.path} · {r.label}</option>)}
          </select>
          <span className="perua">×<input type="number" min={1} max={200} value={count} onChange={(e) => setCount(parseInt(e.target.value || "1", 10))} /></span>
          <button onClick={call} disabled={busy}>Call</button>
          <button className="secondary" onClick={callAndPay} disabled={busy || !active}>Call &amp; pay</button>
          <span className="grow" />
          <a href={config.wafTrafficUrl} target="_blank" rel="noreferrer" className="link">WAF traffic ↗</a>
          <a href={config.wafMonetizationUrl} target="_blank" rel="noreferrer" className="link">revenue ↗</a>
        </div>
        {count > 1 && (
          <div className="ualist">
            <span className="ualabel">clients:</span>
            {allUAs.map((u) => (
              <label key={u} className="ua" title={u}>
                <input type="checkbox" checked={selectedUAs.includes(u)} onChange={() => toggleUA(u)} />
                <span>{u.length > 40 ? u.slice(0, 37) + "…" : u}</span>
              </label>
            ))}
            <span className="addua"><input placeholder="add UA…" value={newUa} onChange={(e) => setNewUa(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addUa()} /></span>
          </div>
        )}
      </section>

      {/* 3 · RESULT: legs side by side, then the rendered content */}
      <section className="card">
        <div className="hint resp-status">{status || "Pick a route, then Call (402) or Call & pay (full round-trip)."}</div>
        {(legs.length > 0 || expectedLegs > 0) && (
          <div className="legs">
            {Array.from({ length: Math.max(legs.length, expectedLegs) }).map((_, i) => {
              const leg = legs[i];
              if (leg) {
                return (
                  <div key={i} className={`leg ${leg.ok ? "ok" : "bad"}`}>
                    <div className="leg-head">
                      {leg.title}
                      {leg.status != null && <span className={`pill ${leg.status === 402 ? "b402" : leg.status === 200 ? "b200" : ""}`}>{leg.status}</span>}
                    </div>
                    <pre className="leg-body">{leg.detail}</pre>
                  </div>
                );
              }
              // pending leg → loader placeholder
              const inFlight = i === legs.length; // the very next leg is running now
              return (
                <div key={i} className="leg pending">
                  <div className="leg-head">
                    {LEG_TITLES[i] ?? `${i + 1} · …`}
                    {inFlight && <span className="spinner" />}
                  </div>
                  <div className="leg-body skeleton">
                    <span /><span /><span />
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
              <span className="tally-count">{tally.total}<span className="of"> / {tally.target}</span></span>
              <span className="tally-label">unpaid requests · every one → <span className="pill b402">402</span></span>
            </div>
            {Object.entries(tally.byClient).filter(([, e]) => e.n > 0 || tally.total < tally.target).map(([ua, e]) => {
              const max = Math.max(1, ...Object.values(tally.byClient).map((x) => x.n));
              return (
                <div key={ua} className="bar-row">
                  <span className="bar-name" title={ua}>{shortUA(ua)}</span>
                  <span className="bar-track"><span className="bar-fill" style={{ width: `${(e.n / max) * 100}%` }} /></span>
                  <span className="bar-n">{e.n}</span>
                </div>
              );
            })}
          </div>
        )}
        {payTally && (
          <div className="tally">
            <div className="tally-legend">
              <span><i className="seg req" /> requested (402)</span>
              <span><i className="seg paid" /> paid (signed)</span>
              <span><i className="seg set" /> settled (200)</span>
            </div>
            {Object.entries(payTally.byClient).filter(([, f]) => f.planned > 0).map(([ua, f]) => {
              // Three layers, each anchored LEFT, width = its CUMULATIVE count over the
              // planned total (settled ⊆ paid ⊆ requested). Stacked by z-index: amber
              // (requested) behind, purple (paid) over it, green (settled) on top. Each
              // band grows LEFT→RIGHT as that stage advances, and because the cumulative
              // counts differ you see distinct green|purple|amber|empty bands. The grey
              // track behind is the planned (pending) total — visible from frame 1.
              const d = Math.max(1, f.planned);
              const pct = (n: number) => `${(Math.max(0, n) / d) * 100}%`;
              return (
                <div key={ua} className="bar-row">
                  <span className="bar-name" title={ua}>{shortUA(ua)}</span>
                  <span className="bar-track stacked" title={`planned ${f.planned} · requested ${f.requested} · paid ${f.paid} · settled ${f.settled}`}>
                    <span className="seg req" style={{ width: pct(f.requested) }} />
                    <span className="seg paid" style={{ width: pct(f.paid) }} />
                    <span className="seg set" style={{ width: pct(f.settled) }} />
                  </span>
                  <span className="bar-n">{f.settled}/{f.planned}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
