// Walk-forward validation — splits historical data into rolling train/test
// windows and runs the backtest on each out-of-sample segment. This is the
// primary defence against overfitting: parameters/strategy that only work in
// a single lookback window usually collapse when the window rolls forward.
//
// The local-signal strategy in this app has no tuneable parameters, so
// "walk-forward" here is the simpler anchored form: every fold uses the
// same strategy. The output is a measurement of *stability across regimes*
// rather than a parameter search.
//
//   |--- train 90d ---|-- test 30d --|
//                              |--- train 90d ---|-- test 30d --|
//                                                 |--- ... ---|
//
// Usage:
//   const result = runWalkForward(candles, { totalDays: 180, trainDays: 90, testDays: 30, stepDays: 30 });

import type { Candle } from "./indicators";
import {
  runBacktest,
  summarizeStats,
  type BacktestConfig,
  type BacktestStats,
  type BacktestTrade,
  type EquityPoint,
} from "./backtest";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WalkForwardConfig = {
  /** Total lookback days to cover. Must be >= trainDays + testDays. */
  totalDays: number;
  /** Length of the in-sample (training) window. Not used for training here
   *  (no params to fit) but we report its metrics as the "in-sample"
   *  reference for overfitting comparison. */
  trainDays: number;
  /** Length of the out-of-sample (test) window. This is what gets stitched. */
  testDays: number;
  /** How many days to roll forward between folds. Default = testDays
   *  (non-overlapping OOS). Smaller values produce overlapping OOS segments
   *  for smoother stitched equity but reduce statistical independence. */
  stepDays?: number;
};

export type WalkForwardFold = {
  index: number;
  startTime: number;
  endTime: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  bars: { train: number; test: number };
  inSample: BacktestStats;
  outOfSample: BacktestStats;
  oosTrades: BacktestTrade[];
  /** OOS equity curve re-based to the start of the fold. */
  oosEquity: EquityPoint[];
};

export type WalkForwardAggregates = {
  totalFolds: number;
  profitableFolds: number;
  consistency: number; // profitable / total, 0..1
  totalOosTrades: number;
  totalOosPnlUsd: number;
  totalOosPnlPct: number;
  avgOosPnlUsd: number;
  avgOosWinRate: number;
  avgOosProfitFactor: number;
  avgOosSharpe: number;
  worstOosMaxDdPct: number;
  /** Combined OOS equity (fold curves stitched at OOS boundaries). */
  stitchedOos: EquityPoint[];
  stitchedStats: BacktestStats;
  /** In-sample vs OOS mean P&L ratio (PIT-style check). */
  isVsOosRatio: number;
};

export type WalkForwardResult = {
  config: WalkForwardConfig;
  backtest: BacktestConfig;
  symbol: string;
  interval: string;
  folds: WalkForwardFold[];
  aggregates: WalkForwardAggregates;
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------

/**
 * Split a candle series into walk-forward folds.
 * Returns an array of { train, test } candle slices, oldest first.
 */
export function splitFolds(
  candles: Candle[],
  cfg: WalkForwardConfig,
): Array<{ train: Candle[]; test: Candle[] }> {
  const step = cfg.stepDays ?? cfg.testDays;
  const totalMs = cfg.totalDays * 86_400_000;
  const trainMs = cfg.trainDays * 86_400_000;
  const testMs = cfg.testDays * 86_400_000;
  const stepMs = step * 86_400_000;

  if (trainMs + testMs > totalMs) {
    throw new Error(
      `trainDays (${cfg.trainDays}) + testDays (${cfg.testDays}) > totalDays (${cfg.totalDays})`,
    );
  }
  if (step <= 0) throw new Error("stepDays must be > 0");

  const endTime = candles[candles.length - 1]?.time * 1000;
  if (!endTime) return [];

  const folds: Array<{ train: Candle[]; test: Candle[] }> = [];
  // Walk backwards from the most recent window so the latest market regime
  // is always included in the last fold.
  let testEnd = endTime;
  while (testEnd - totalMs > 0) {
    const testStart = testEnd - testMs;
    const trainEnd = testStart;
    const trainStart = trainEnd - trainMs;
    const firstCandleMs = candles[0] ? candles[0].time * 1000 : 0;
    if (trainStart < firstCandleMs) break;
    const train = candles.filter(
      (c) => c.time * 1000 >= trainStart && c.time * 1000 < trainEnd,
    );
    const test = candles.filter(
      (c) => c.time * 1000 >= testStart && c.time * 1000 < testEnd,
    );
    if (train.length >= 60 && test.length >= 30) {
      folds.unshift({ train, test });
    }
    testEnd -= stepMs;
  }
  return folds;
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

export function runWalkForward(
  candles: Candle[],
  bt: BacktestConfig,
  cfg: WalkForwardConfig,
  meta: { symbol?: string; interval?: string } = {},
): WalkForwardResult {
  const t0 = performance.now();
  const foldsRaw = splitFolds(candles, cfg);
  const folds: WalkForwardFold[] = [];
  let stitchedOos: EquityPoint[] = [];
  let stitchedOffset = 0;
  let totalOosPnlUsd = 0;
  let totalOosPnlPct = 0;
  let totalOosTrades = 0;
  let sumWinRate = 0;
  let sumPf = 0;
  let sumSharpe = 0;
  let worstDd = 0;
  let sumIsPnlPct = 0;
  let sumOosPnlPct = 0;
  let profitableFolds = 0;

  for (let i = 0; i < foldsRaw.length; i++) {
    const { train, test } = foldsRaw[i];

    const isResult = runBacktest(train, bt, meta);
    const oosResult = runBacktest(test, bt, meta);

    // Stitch OOS equity: rebase OOS so it starts at the previous stitched close
    const prevClose =
      stitchedOos.length > 0
        ? stitchedOos[stitchedOos.length - 1].equity
        : bt.initialEquity;
    if (oosResult.equity.length > 0) {
      const first = oosResult.equity[0].equity;
      const rebased = oosResult.equity.map((p) => ({
        time: p.time,
        equity: prevClose + (p.equity - first),
        price: p.price,
      }));
      stitchedOos = stitchedOos.concat(rebased);
    }

    totalOosPnlUsd += oosResult.stats.netPnlUsd;
    totalOosPnlPct += oosResult.stats.netPnlPct;
    totalOosTrades += oosResult.stats.totalTrades;
    sumWinRate += oosResult.stats.winRate;
    sumPf += isFinite(oosResult.stats.profitFactor)
      ? oosResult.stats.profitFactor
      : 0;
    sumSharpe += oosResult.stats.sharpe;
    if (oosResult.stats.maxDrawdownPct > worstDd)
      worstDd = oosResult.stats.maxDrawdownPct;
    sumIsPnlPct += isResult.stats.netPnlPct;
    sumOosPnlPct += oosResult.stats.netPnlPct;
    if (oosResult.stats.netPnlUsd > 0) profitableFolds++;

    folds.push({
      index: i,
      startTime: test[0]?.time ?? 0,
      endTime: test[test.length - 1]?.time ?? 0,
      trainStart: train[0]?.time ?? 0,
      trainEnd: train[train.length - 1]?.time ?? 0,
      testStart: test[0]?.time ?? 0,
      testEnd: test[test.length - 1]?.time ?? 0,
      bars: { train: train.length, test: test.length },
      inSample: isResult.stats,
      outOfSample: oosResult.stats,
      oosTrades: oosResult.trades,
      oosEquity: oosResult.equity,
    });
    stitchedOffset++;
  }

  // Recompute stitched stats from the stitched equity curve
  const stitchedStats = summarizeStats([], stitchedOos, bt.initialEquity, 0);

  const n = folds.length || 1;
  const avgOosPnlUsd = totalOosPnlUsd / n;
  const avgOosWinRate = sumWinRate / n;
  const avgOosProfitFactor = sumPf / n;
  const avgOosSharpe = sumSharpe / n;
  const isVsOosRatio = sumOosPnlPct !== 0 ? sumIsPnlPct / sumOosPnlPct : 0;

  return {
    config: cfg,
    backtest: bt,
    symbol: meta.symbol ?? "",
    interval: meta.interval ?? "",
    folds,
    aggregates: {
      totalFolds: folds.length,
      profitableFolds,
      consistency: folds.length > 0 ? profitableFolds / folds.length : 0,
      totalOosTrades,
      totalOosPnlUsd,
      totalOosPnlPct,
      avgOosPnlUsd,
      avgOosWinRate,
      avgOosProfitFactor,
      avgOosSharpe,
      worstOosMaxDdPct: worstDd,
      stitchedOos,
      stitchedStats,
      isVsOosRatio,
    },
    durationMs: performance.now() - t0,
  };
}
