// Multi-symbol market scanner — runs the local signal, regime detector and
// confluence score across a list of symbols in parallel and ranks them by
// opportunity. Used by the /scanner route to help the user pick which symbol
// to focus on next.

import {
  fetchKlines,
  fetchTicker24h,
  type Interval,
  type Ticker24h,
} from "./binance";
import {
  localSignal,
  snapshot,
  type Candle,
  type IndicatorSnapshot,
  type LocalSignal,
} from "./indicators";
import { classifyRegime, type Regime, type RegimeSnapshot } from "./regime";
import { computeConfluence, type Confluence } from "./confluence";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ScanRow = {
  symbol: string;
  interval: Interval;
  price: number;
  change24h: number;
  volume24h: number;
  quoteVolume24h: number;
  signal: LocalSignal;
  regime: RegimeSnapshot["regime"];
  regimeConfidence: number;
  confluence: Confluence;
  /** Combined opportunity score, 0..100. Higher = better setup. */
  opportunity: number;
  /** Direction: "LONG" | "SHORT" | "NEUTRAL" */
  direction: "LONG" | "SHORT" | "NEUTRAL";
  error: string | null;
};

export type ScanConfig = {
  symbols: string[];
  interval: Interval;
  /** Top N by 24h quote volume to include. Default = all. */
  topByVolume?: number;
  /** Concurrency limit for fetches. Default 4. */
  concurrency?: number;
};

export type ScanResult = {
  config: ScanConfig;
  rows: ScanRow[];
  errors: { symbol: string; error: string }[];
  durationMs: number;
  /** Aggregate stats across the scan. */
  aggregate: {
    scanned: number;
    longSetups: number;
    shortSetups: number;
    neutral: number;
    avgOpportunity: number;
    bullishRegimes: number;
    bearishRegimes: number;
    rangingRegimes: number;
    volatileRegimes: number;
  };
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function scanSymbols(config: ScanConfig): Promise<ScanResult> {
  const t0 = performance.now();
  const concurrency = config.concurrency ?? 4;
  let symbols = [...config.symbols];

  // Optionally pre-filter by 24h volume
  if (config.topByVolume && config.topByVolume < symbols.length) {
    try {
      const tickers = await mapWithLimit(symbols, concurrency, async (s) => {
        try {
          return await fetchTicker24h(s);
        } catch {
          return null;
        }
      });
      const valid = tickers.filter((t): t is Ticker24h => t !== null);
      valid.sort((a, b) => b.quoteVolume - a.quoteVolume);
      symbols = valid.slice(0, config.topByVolume).map((t) => t.symbol);
    } catch {
      /* keep original list */
    }
  }

  const { rows, errors } = await mapWithLimit(
    symbols,
    concurrency,
    async (symbol): Promise<ScanRow | { error: string; symbol: string }> => {
      try {
        return await scanOne(symbol, config.interval);
      } catch (e) {
        return {
          symbol,
          error: e instanceof Error ? e.message : "Erro",
        };
      }
    },
  ).then((results) => {
    const ok: ScanRow[] = [];
    const errs: { symbol: string; error: string }[] = [];
    for (const r of results) {
      if ("error" in r) {
        const e = r as { symbol: string; error: string };
        errs.push({ symbol: e.symbol, error: e.error ?? "Erro" });
      } else ok.push(r);
    }
    return { rows: ok, errors: errs };
  });

  // Rank by opportunity descending
  rows.sort((a, b) => b.opportunity - a.opportunity);

  const aggregate = {
    scanned: rows.length,
    longSetups: rows.filter((r) => r.direction === "LONG").length,
    shortSetups: rows.filter((r) => r.direction === "SHORT").length,
    neutral: rows.filter((r) => r.direction === "NEUTRAL").length,
    avgOpportunity:
      rows.length > 0
        ? rows.reduce((s, r) => s + r.opportunity, 0) / rows.length
        : 0,
    bullishRegimes: rows.filter((r) => r.regime === "BULL_TREND").length,
    bearishRegimes: rows.filter((r) => r.regime === "BEAR_TREND").length,
    rangingRegimes: rows.filter((r) => r.regime === "RANGE").length,
    volatileRegimes: rows.filter((r) => r.regime === "VOLATILE").length,
  };

  return {
    config,
    rows,
    errors,
    durationMs: performance.now() - t0,
    aggregate,
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

async function scanOne(symbol: string, interval: Interval): Promise<ScanRow> {
  const [klines, ticker] = await Promise.all([
    fetchKlines(symbol, interval, 200),
    fetchTicker24h(symbol),
  ]);
  const candles: Candle[] = klines.map((k) => ({
    time: k.time,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
  }));
  const snap: IndicatorSnapshot = snapshot(candles);
  const signal = localSignal(snap);
  const regimeSnap = classifyRegime(snap);
  const confluence = computeConfluence({ snap, ticker });

  // Direction from signal
  const direction: ScanRow["direction"] =
    signal.action === "BUY"
      ? "LONG"
      : signal.action === "SELL"
        ? "SHORT"
        : "NEUTRAL";

  // Opportunity score (0..100)
  // Weights: signal 40%, confluence 30%, regime conviction 20%, volume 10%
  const signalScore = Math.min(100, Math.abs(signal.score));
  const confScore = confluence.score;
  const regimeScore = regimeSnap.confidence.overall;
  // Volume score: rank-based — use log scale, normalized
  const volumeScore = Math.min(
    100,
    Math.log10(Math.max(1, ticker.quoteVolume)) * 8,
  );

  const opportunity = Math.round(
    signalScore * 0.4 + confScore * 0.3 + regimeScore * 0.2 + volumeScore * 0.1,
  );

  return {
    symbol,
    interval,
    price: ticker.lastPrice,
    change24h: ticker.priceChangePercent,
    volume24h: ticker.volume,
    quoteVolume24h: ticker.quoteVolume,
    signal,
    regime: regimeSnap.regime,
    regimeConfidence: regimeSnap.confidence.overall,
    confluence,
    opportunity,
    direction,
    error: null,
  };
}

async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return out;
}
