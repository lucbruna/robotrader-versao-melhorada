// Monte Carlo simulation — bootstraps trades from a backtest to estimate the
// distribution of possible outcomes. Answers questions like:
//   - "If I replayed this strategy 1000 times with the same trade pool, how
//      often would I be profitable?"
//   - "What's the worst drawdown I should expect at the 95th percentile?"
//   - "What's the probability of ruin (>50% drawdown)?"
//
// Method: classic trade-resampling bootstrap. Each synthetic run draws N
// trades with replacement from the source trade list, applied in random
// order. We track the running equity, drawdown, and Sharpe for each path,
// then report percentiles + ruin probability.
//
// Limitations:
//   - Treats trades as i.i.d. (ignores serial correlation). For more
//     accurate results use block bootstrap (cfg.blockSize > 1).
//   - Does not model changing market regime, gap risk, or liquidity events.
//   - A small source pool (<30 trades) yields wide confidence bands.

import type { BacktestTrade } from "./backtest";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MonteCarloConfig = {
  /** Number of synthetic runs. Default 1000. */
  runs: number;
  /** Starting equity for every synthetic run. */
  initialEquity: number;
  /** Block size for block-bootstrap. 1 = pure i.i.d. (default). */
  blockSize?: number;
  /** Optional seed for the PRNG. Default = a stable per-call value. */
  seed?: number;
  /** Drawdown % considered "ruin". Default 50. */
  ruinDrawdownPct?: number;
};

export const DEFAULT_MONTE_CARLO: MonteCarloConfig = {
  runs: 1000,
  initialEquity: 10_000,
  blockSize: 1,
  ruinDrawdownPct: 50,
};

export type MonteCarloPath = {
  index: number;
  /** Final P&L in USD. */
  pnlUsd: number;
  /** Final P&L as % of initial equity. */
  pnlPct: number;
  /** Maximum drawdown observed along the synthetic path, in %. */
  maxDdPct: number;
  /** Annualised Sharpe of the per-trade return series. */
  sharpe: number;
  /** Number of trades in this path (same as source trade count). */
  trades: number;
  /** Synthetic equity curve (running equity, length = source trades + 1). */
  equity: number[];
  /** Whether this path crossed the ruin threshold at any point. */
  ruined: boolean;
};

export type PercentileStats = {
  p5: number;
  p25: number;
  p50: number;
  p75: number;
  p95: number;
  mean: number;
  std: number;
};

export type MonteCarloResult = {
  config: MonteCarloConfig;
  sourceTrades: number;
  /** All synthetic paths (length = config.runs). */
  paths: MonteCarloPath[];
  /** Per-metric percentile summaries. */
  percentiles: {
    pnlUsd: PercentileStats;
    pnlPct: PercentileStats;
    maxDdPct: PercentileStats;
    sharpe: PercentileStats;
  };
  /** Probability that final equity > initial equity. */
  probProfit: number;
  /** Probability that path crosses ruin threshold. */
  probRuin: number;
  /** Mean final P&L in USD. */
  expectedPnl: number;
  /** Mean final P&L as % of initial equity. */
  expectedPnlPct: number;
  /** Per-step percentile bands for the equity curve (used to draw envelope). */
  bands: { p5: number[]; p50: number[]; p95: number[] };
  /** Wall-clock duration of the run, in ms. */
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) — small, fast, good enough for bootstrap
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function runMonteCarlo(
  trades: BacktestTrade[],
  config: MonteCarloConfig = DEFAULT_MONTE_CARLO,
): MonteCarloResult {
  const t0 = performance.now();
  const cfg: MonteCarloConfig = { ...DEFAULT_MONTE_CARLO, ...config };
  const n = cfg.runs;
  const initial = cfg.initialEquity;
  const ruinPct = cfg.ruinDrawdownPct ?? 50;
  const blockSize = Math.max(1, cfg.blockSize ?? 1);
  const seed = cfg.seed ?? Math.floor(Math.random() * 0x7fffffff);
  const rand = mulberry32(seed);

  if (trades.length === 0) {
    return emptyResult(cfg, t0);
  }

  // Pre-extract pnlUsd for speed
  const pnls = trades.map((t) => t.pnlUsd);

  const paths: MonteCarloPath[] = [];
  let sumPnl = 0;
  let sumPnlPct = 0;
  let profitCount = 0;
  let ruinCount = 0;

  // For bands: we need every path to have the same length.
  // The synthetic equity has length = (blocks * blockSize) + 1, but for the
  // chart we want fixed length = sourceTrades + 1. We'll draw exactly
  // `sourceTrades` samples per path (so a single run uses a re-sampling
  // of size = sourceTrades). This preserves trade count distribution.
  const drawCount = pnls.length;

  for (let i = 0; i < n; i++) {
    const equity: number[] = new Array(drawCount + 1);
    equity[0] = initial;

    // Block bootstrap
    let cursor = 0;
    let cash = initial;
    let peak = initial;
    let maxDd = 0;
    let ruined = false;

    while (cursor < drawCount) {
      // Pick a random starting trade
      const start = Math.floor(rand() * pnls.length);
      const end = Math.min(drawCount, cursor + blockSize);
      const endTrade = Math.min(pnls.length, start + (end - cursor));
      for (let k = start; k < endTrade; k++) {
        cash += pnls[k];
        equity[cursor + (k - start) + 1] = cash;
        if (cash > peak) peak = cash;
        const dd = peak - cash;
        const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
        if (ddPct > maxDd) maxDd = ddPct;
        if (ddPct >= ruinPct) ruined = true;
      }
      cursor = end;
    }

    // Pad if block math didn't fill (shouldn't happen but defensive)
    while (equity.length < drawCount + 1) equity.push(cash);

    const pnlUsd = cash - initial;
    const pnlPct = initial > 0 ? (pnlUsd / initial) * 100 : 0;
    const sharpe = sharpeFromEquity(equity);

    paths.push({
      index: i,
      pnlUsd,
      pnlPct,
      maxDdPct: maxDd,
      sharpe,
      trades: drawCount,
      equity,
      ruined,
    });

    sumPnl += pnlUsd;
    sumPnlPct += pnlPct;
    if (pnlUsd > 0) profitCount++;
    if (ruined) ruinCount++;
  }

  const percentiles = {
    pnlUsd: percentileStats(paths.map((p) => p.pnlUsd)),
    pnlPct: percentileStats(paths.map((p) => p.pnlPct)),
    maxDdPct: percentileStats(paths.map((p) => p.maxDdPct)),
    sharpe: percentileStats(paths.map((p) => p.sharpe)),
  };

  // Bands: per-step percentile of the equity curve across all paths
  const bands = computeBands(paths);

  return {
    config: cfg,
    sourceTrades: trades.length,
    paths,
    percentiles,
    probProfit: profitCount / n,
    probRuin: ruinCount / n,
    expectedPnl: sumPnl / n,
    expectedPnlPct: sumPnlPct / n,
    bands,
    durationMs: performance.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// Stats helpers
// ---------------------------------------------------------------------------

export function percentileStats(values: number[]): PercentileStats {
  if (values.length === 0) {
    return { p5: 0, p25: 0, p50: 0, p75: 0, p95: 0, mean: 0, std: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const p = (q: number) =>
    sorted[
      Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)))
    ];
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance =
    values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
  return {
    p5: p(0.05),
    p25: p(0.25),
    p50: p(0.5),
    p75: p(0.75),
    p95: p(0.95),
    mean,
    std: Math.sqrt(variance),
  };
}

function sharpeFromEquity(equity: number[]): number {
  if (equity.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1];
    if (prev > 0) returns.push(equity[i] / prev - 1);
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  // Annualise using sqrt(N) where N is the number of trades (trading units)
  return (mean / sd) * Math.sqrt(returns.length);
}

function computeBands(paths: MonteCarloPath[]): {
  p5: number[];
  p50: number[];
  p95: number[];
} {
  if (paths.length === 0) return { p5: [], p50: [], p95: [] };
  const len = paths[0].equity.length;
  const p5 = new Array<number>(len);
  const p50 = new Array<number>(len);
  const p95 = new Array<number>(len);
  for (let t = 0; t < len; t++) {
    const slice = paths.map((p) => p.equity[t] ?? 0).sort((a, b) => a - b);
    p5[t] = slice[Math.floor(0.05 * slice.length)];
    p50[t] = slice[Math.floor(0.5 * slice.length)];
    p95[t] = slice[Math.floor(0.95 * slice.length)];
  }
  return { p5, p50, p95 };
}

function emptyResult(cfg: MonteCarloConfig, t0: number): MonteCarloResult {
  const empty: PercentileStats = {
    p5: 0,
    p25: 0,
    p50: 0,
    p75: 0,
    p95: 0,
    mean: 0,
    std: 0,
  };
  return {
    config: cfg,
    sourceTrades: 0,
    paths: [],
    percentiles: {
      pnlUsd: empty,
      pnlPct: empty,
      maxDdPct: empty,
      sharpe: empty,
    },
    probProfit: 0,
    probRuin: 0,
    expectedPnl: 0,
    expectedPnlPct: 0,
    bands: { p5: [], p50: [], p95: [] },
    durationMs: performance.now() - t0,
  };
}
