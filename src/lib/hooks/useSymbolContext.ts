// #15 — Shared hooks for symbol-level derived context (confluence + regime).
//
// These hooks let any component access the multi-factor confluence score
// and the live regime classification without each component re-implementing
// the fetch + compute pipeline. Right now both ConfluenceGauge and
// AISignalPanel can call useConfluence() and get the same result.
//
// We deliberately do NOT use a global store (zustand, context) here —
// the data lifetime matches the component tree (Dashboard), and the fetches
// are cheap (5 futures calls + a 25-bar OI history) and cached for 30s.
// TanStack Query could be used later for true cross-mount caching.

import { useEffect, useMemo, useState } from "react";
import type { IndicatorSnapshot } from "@/lib/indicators";
import type { Ticker24h } from "@/lib/binance";
import {
  fetchLongShortRatio,
  fetchOpenInterest,
  fetchOpenInterestHist,
  fetchPremiumIndex,
  fetchTakerBuySellRatio,
  type LongShortRatio,
  type OpenInterest,
  type PremiumIndex,
  type TakerRatio,
} from "@/lib/futures-data";
import { computeConfluence, type Confluence } from "@/lib/confluence";
import { classifyRegime, type RegimeSnapshot } from "@/lib/regime";

const REFRESH_MS = 30_000;

/**
 * Multi-factor confluence score (0-100, with tone + breakdown).
 * Fetches the 5 futures endpoints (premium, OI, OI history, long/short,
 * taker) on mount and refreshes every 30s.
 */
export function useConfluence(
  symbol: string,
  snap: IndicatorSnapshot | null,
  ticker: Ticker24h | null,
): { confluence: Confluence | null; loading: boolean } {
  const [premium, setPremium] = useState<PremiumIndex | null>(null);
  const [oi, setOi] = useState<OpenInterest | null>(null);
  const [oiChange24h, setOiChange24h] = useState<number | null>(null);
  const [longShort, setLongShort] = useState<LongShortRatio | null>(null);
  const [taker, setTaker] = useState<TakerRatio | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const [p, o, oiHist, ls, tk] = await Promise.allSettled([
          fetchPremiumIndex(symbol),
          fetchOpenInterest(symbol),
          fetchOpenInterestHist(symbol, "1h", 25),
          fetchLongShortRatio(symbol, "1h", 1),
          fetchTakerBuySellRatio(symbol, "1h", 1),
        ]);
        if (!alive) return;
        if (p.status === "fulfilled") setPremium(p.value);
        if (o.status === "fulfilled") setOi(o.value);
        if (tk.status === "fulfilled") setTaker(tk.value[0] ?? null);
        if (ls.status === "fulfilled") setLongShort(ls.value[0] ?? null);
        if (oiHist.status === "fulfilled") {
          const h = oiHist.value;
          if (h.length >= 2) {
            const first = h[0]?.sumOpenInterestValue ?? 0;
            const last = h[h.length - 1]?.sumOpenInterestValue ?? 0;
            if (first > 0) setOiChange24h(((last - first) / first) * 100);
          }
        }
      } catch {
        /* silent — partial data is OK */
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol]);

  const confluence = useMemo(() => {
    if (!snap) return null;
    return computeConfluence({
      snap,
      ticker,
      premium,
      oi,
      oiChange24h,
      longShort,
      taker,
    });
  }, [snap, ticker, premium, oi, oiChange24h, longShort, taker]);

  return { confluence, loading };
}

/**
 * Live regime classification from a single snapshot — no fetches, pure
 * function. Recomputes whenever the snapshot changes.
 */
export function useRegimeLive(
  snap: IndicatorSnapshot | null,
): RegimeSnapshot | null {
  return useMemo(() => {
    if (!snap) return null;
    return classifyRegime(snap);
  }, [snap]);
}
