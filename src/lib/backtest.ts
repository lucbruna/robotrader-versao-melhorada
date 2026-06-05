// Backtest engine — replays the local-signal strategy on historical candles
// and computes equity curve + risk metrics. Pure function, no I/O.
//
// Usage:
//   const candles = await fetchBacktestData("BTCUSDT", "1h", 90);
//   const result  = runBacktest(candles, { initialEquity: 10000, ...DEFAULT_RISK });
//
// The engine uses the same indicator stack as the live dashboard
// (see src/lib/indicators.ts) so behaviour matches the production signal.

import type { Candle, IndicatorSnapshot } from "./indicators";
import {
  adx,
  atr,
  bollinger,
  ema,
  localSignal,
  macd,
  marketStructure,
  obv,
  pivots,
  rsi,
  stochastic,
  supportResistance,
  volatilityRegime,
  vwap,
} from "./indicators";
import { fetchKlines } from "./binance";
import {
  DEFAULT_RISK,
  planTrade,
  type RiskSettings,
  type Side,
  type StopPlan,
} from "./risk";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BacktestConfig = RiskSettings & {
  initialEquity: number;
  /** Minimum signal score (|score|) to open a trade. Default 25. */
  minScore?: number;
  /** Minimum local-signal confidence to open a trade. Default 35. */
  minConfidence?: number;
  /** If true, force-close any open position at the end of the backtest. */
  closeAtEnd?: boolean;
  /** Trade only on bar close (no intrabar fills). Always true. */
  barCloseOnly?: true;
};

export const DEFAULT_BACKTEST: BacktestConfig = {
  ...DEFAULT_RISK,
  initialEquity: 10_000,
  minScore: 25,
  minConfidence: 35,
  closeAtEnd: true,
};

export type BacktestTrade = {
  side: Side;
  entryTime: number;
  entryPrice: number;
  exitTime: number | null;
  exitPrice: number | null;
  qty: number;
  stop: number;
  target: number;
  exitReason: "TP" | "SL" | "TRAIL" | "REVERSAL" | "END";
  pnlUsd: number;
  pnlR: number; // realized in R units (risk = entry - stop)
  duration: number; // ms
};

export type EquityPoint = {
  time: number;
  equity: number;
  price: number;
};

export type BacktestStats = {
  initialEquity: number;
  finalEquity: number;
  netPnlUsd: number;
  netPnlPct: number;
  totalTrades: number;
  winners: number;
  losers: number;
  winRate: number; // 0..1
  profitFactor: number; // sum(wins $) / abs(sum(losses $))
  avgWinUsd: number;
  avgLossUsd: number;
  avgRMultiple: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  sharpe: number; // annualised, assuming 252 daily bars or 365*24 hourly
  expectancy: number; // avg pnl per trade
  exposure: number; // fraction of bars in a position
  longestStreak: { kind: "W" | "L"; length: number };
};

export type BacktestResult = {
  config: BacktestConfig;
  symbol: string;
  interval: string;
  bars: number;
  startTime: number;
  endTime: number;
  trades: BacktestTrade[];
  equity: EquityPoint[];
  stats: BacktestStats;
  /** Wall-clock duration of the run in ms (engine only, excludes data fetch). */
  durationMs: number;
};

// ---------------------------------------------------------------------------
// Data fetch with pagination (Binance limit is 1000 candles per call)
// ---------------------------------------------------------------------------

const BINANCE_FUTURES_REST = "https://fapi.binance.com";

/**
 * Fetch historical candles for backtest. Pages through Binance's 1000-candle
 * limit using startTime to cover arbitrary lookbacks.
 */
export async function fetchBacktestData(
  symbol: string,
  interval: string,
  days: number,
  opts: { market?: "spot" | "futures" } = {},
): Promise<Candle[]> {
  const market = opts.market ?? "spot";
  const base =
    market === "futures"
      ? `${BINANCE_FUTURES_REST}/fapi/v1/klines`
      : "https://api.binance.com/api/v3/klines";
  const intervalMs = intervalToMs(interval);
  const endTime = Date.now();
  const startTime = endTime - days * 24 * 60 * 60 * 1000;
  const out: Candle[] = [];

  let cursor = startTime;
  // Hard cap to avoid runaway loops on bad inputs
  const maxPages =
    Math.ceil((days * 24 * 60 * 60 * 1000) / (intervalMs * 999)) + 2;

  for (let p = 0; p < maxPages; p++) {
    const url = `${base}?symbol=${symbol}&interval=${interval}&startTime=${cursor}&endTime=${endTime}&limit=1000`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance klines ${res.status}`);
    const data = (await res.json()) as unknown[][];
    if (data.length === 0) break;
    for (const k of data) {
      out.push({
        time: Math.floor((k[0] as number) / 1000),
        open: parseFloat(k[1] as string),
        high: parseFloat(k[2] as string),
        low: parseFloat(k[3] as string),
        close: parseFloat(k[4] as string),
        volume: parseFloat(k[5] as string),
      });
    }
    const last = data[data.length - 1];
    const lastOpen = last[0] as number;
    if (lastOpen >= endTime) break;
    cursor = lastOpen + intervalMs;
    if (data.length < 1000) break;
  }

  // De-dupe by time (Binance can return overlapping candles in rare cases)
  const seen = new Set<number>();
  const dedup: Candle[] = [];
  for (const c of out) {
    if (seen.has(c.time)) continue;
    seen.add(c.time);
    dedup.push(c);
  }
  dedup.sort((a, b) => a.time - b.time);
  return dedup;
}

function intervalToMs(interval: string): number {
  const m = /^(\d+)([mhdw])$/.exec(interval);
  if (!m) throw new Error(`Invalid interval ${interval}`);
  const n = parseInt(m[1], 10);
  const unit = m[2];
  const mult =
    unit === "m"
      ? 60_000
      : unit === "h"
        ? 3_600_000
        : unit === "d"
          ? 86_400_000
          : 604_800_000;
  return n * mult;
}

// ---------------------------------------------------------------------------
// Per-bar indicator cache — compute all series once, slice per bar
// ---------------------------------------------------------------------------

type IndicatorCache = {
  closes: number[];
  rsi: (number | null)[];
  macdLine: (number | null)[];
  macdSignal: (number | null)[];
  macdHist: (number | null)[];
  ema20: (number | null)[];
  ema50: (number | null)[];
  ema200: (number | null)[];
  atr: (number | null)[];
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
  stochK: (number | null)[];
  stochD: (number | null)[];
  vwap: (number | null)[];
  obv: number[];
  bbUpper: (number | null)[];
  bbLower: (number | null)[];
  bbMid: (number | null)[];
};

function precomputeIndicators(candles: Candle[]): IndicatorCache {
  const closes = candles.map((c) => c.close);
  const r = rsi(closes);
  const m = macd(closes);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const a = atr(candles, 14);
  const adxData = adx(candles, 14);
  const st = stochastic(candles, 14, 3);
  const vw = vwap(candles);
  const obvArr = obv(candles);
  const b = bollinger(closes);
  return {
    closes,
    rsi: r,
    macdLine: m.macd,
    macdSignal: m.signal,
    macdHist: m.hist,
    ema20: e20,
    ema50: e50,
    ema200: e200,
    atr: a,
    adx: adxData.adx,
    plusDI: adxData.plusDI,
    minusDI: adxData.minusDI,
    stochK: st.k,
    stochD: st.d,
    vwap: vw,
    obv: obvArr,
    bbUpper: b.upper,
    bbLower: b.lower,
    bbMid: b.mid,
  };
}

/**
 * Build an `IndicatorSnapshot` for bar `i` using the precomputed series.
 * For S/R and structure we use a trailing 100-bar window — same semantics as
 * the live `snapshot()` but computed against the truncated history.
 */
function snapshotAt(
  candles: Candle[],
  cache: IndicatorCache,
  i: number,
): IndicatorSnapshot | null {
  if (i < 50) return null; // warmup: indicators need ~50 bars
  const price = cache.closes[i];
  // Trailing slices for window-based helpers
  const trailing = candles.slice(Math.max(0, i - 199), i + 1);
  const { supports, resistances } = supportResistance(trailing, 100, 0.003);
  const structure = marketStructure(trailing, 30);
  const volRegime = volatilityRegime(trailing, 14, 50);

  const lookback24h = Math.min(candles.length, 96);
  const slice24h = candles.slice(Math.max(0, i - lookback24h + 1), i + 1);
  const high24h = Math.max(...slice24h.map((c) => c.high));
  const low24h = Math.min(...slice24h.map((c) => c.low));
  const range24h = high24h - low24h;
  const rangePos = range24h > 0 ? (price - low24h) / range24h : 0.5;

  const ema20Prev = cache.ema20[i - 3];
  const ema20Slope =
    cache.ema20[i] !== null && ema20Prev !== null && ema20Prev !== 0
      ? (((cache.ema20[i] as number) - ema20Prev) / ema20Prev) * 100
      : null;

  const obvSlope =
    i >= 5 && cache.obv[i - 5] !== 0
      ? Math.sign(cache.obv[i] - cache.obv[i - 5])
      : 0;

  return {
    rsi: cache.rsi[i] ?? null,
    macd: cache.macdLine[i] ?? null,
    macdSignal: cache.macdSignal[i] ?? null,
    macdHist: cache.macdHist[i] ?? null,
    ema20: cache.ema20[i] ?? null,
    ema50: cache.ema50[i] ?? null,
    ema200: cache.ema200[i] ?? null,
    ema20Slope,
    adx: cache.adx[i] ?? null,
    plusDI: cache.plusDI[i] ?? null,
    minusDI: cache.minusDI[i] ?? null,
    atr: cache.atr[i] ?? null,
    atrPct:
      cache.atr[i] !== null && price > 0
        ? (cache.atr[i] as number) / price
        : null,
    bbUpper: cache.bbUpper[i] ?? null,
    bbLower: cache.bbLower[i] ?? null,
    bbMid: cache.bbMid[i] ?? null,
    bbWidth:
      cache.bbUpper[i] !== null && cache.bbLower[i] !== null && cache.bbMid[i]
        ? ((cache.bbUpper[i] as number) - (cache.bbLower[i] as number)) /
          (cache.bbMid[i] as number)
        : null,
    stochK: cache.stochK[i] ?? null,
    stochD: cache.stochD[i] ?? null,
    vwap: cache.vwap[i] ?? null,
    obv: cache.obv[i] ?? null,
    obvSlope,
    structure,
    volRegime,
    supports,
    resistances,
    high24h,
    low24h,
    rangePos,
    price,
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

type OpenPosition = {
  side: Side;
  entryTime: number;
  entryPrice: number;
  stop: number;
  target: number;
  qty: number;
  riskUsd: number;
  /** Current trailing stop (>= original stop on long, <= original on short). */
  trail: number;
  /** Highest favorable price seen since entry (R-multiple gauge). */
  best: number;
  /** ATR at entry for trailing logic. */
  atrAtEntry: number;
};

export function runBacktest(
  candles: Candle[],
  config: BacktestConfig = DEFAULT_BACKTEST,
  meta: { symbol?: string; interval?: string } = {},
): BacktestResult {
  const t0 = performance.now();
  const cfg: BacktestConfig = { ...DEFAULT_BACKTEST, ...config };
  const minScore = cfg.minScore ?? 25;
  const minConfidence = cfg.minConfidence ?? 35;
  const feePct = cfg.feePct;
  const feeRate = feePct / 100;

  if (candles.length < 60) {
    return emptyResult(
      candles,
      cfg,
      meta,
      t0,
      "menos de 60 candles — aquecendo",
    );
  }

  const cache = precomputeIndicators(candles);
  const trades: BacktestTrade[] = [];
  const equity: EquityPoint[] = [];
  let cash = cfg.initialEquity;
  let pos: OpenPosition | null = null;
  let inBars = 0;
  let lastTradeTime = 0;
  let peakEquity = cfg.initialEquity;
  let maxDdUsd = 0;
  let maxDdPct = 0;
  const ratchet = cfg.maxDrawdownPct; // stop trading if account DD > this

  // We'll also use pivots on the recent trailing window to detect swing stops.
  // Pre-compute the pivot time-series is too expensive; do it on-demand only
  // when a position is open and we need to refine the trailing stop.

  for (let i = 50; i < candles.length; i++) {
    const c = candles[i];
    const price = c.close;
    let markToMarket = cash;
    if (pos)
      markToMarket = cash + pos.qty * price * (pos.side === "BUY" ? 1 : -1);

    // === Position management ===
    if (pos) {
      inBars++;
      const dir = pos.side === "BUY" ? 1 : -1;
      // Update best price
      if (dir === 1) {
        if (c.high > pos.best) pos.best = c.high;
      } else {
        if (c.low < pos.best) pos.best = c.low;
      }

      // Trailing stop: move to breakeven after breakevenAfterRR * R,
      // then trail by trailingDistanceATR * ATR.
      const r = Math.abs(pos.entryPrice - pos.stop);
      if (r > 0) {
        const favorable =
          dir === 1 ? pos.best - pos.entryPrice : pos.entryPrice - pos.best;
        const rr = favorable / r;
        if (rr >= cfg.breakevenAfterRR) {
          // Breakeven: stop at entry
          pos.trail = pos.entryPrice;
        }
        if (rr >= cfg.trailingActivationRR) {
          // Trail by ATR
          const trailDist = pos.atrAtEntry * cfg.trailingDistanceATR;
          if (dir === 1) {
            const newStop = pos.best - trailDist;
            if (newStop > pos.trail) pos.trail = newStop;
          } else {
            const newStop = pos.best + trailDist;
            if (newStop < pos.trail) pos.trail = newStop;
          }
        }
      }

      // Check exits — order: SL/Trail first, then TP, then reversal
      let exitPrice: number | null = null;
      let exitReason: BacktestTrade["exitReason"] | null = null;
      if (dir === 1) {
        if (c.low <= pos.trail) {
          exitPrice = pos.trail;
          exitReason = pos.trail > pos.stop ? "TRAIL" : "SL";
        } else if (c.high >= pos.target) {
          exitPrice = pos.target;
          exitReason = "TP";
        }
      } else {
        if (c.high >= pos.trail) {
          exitPrice = pos.trail;
          exitReason = pos.trail < pos.stop ? "TRAIL" : "SL";
        } else if (c.low <= pos.target) {
          exitPrice = pos.target;
          exitReason = "TP";
        }
      }

      if (exitPrice !== null && exitReason !== null) {
        const gross = (exitPrice - pos.entryPrice) * dir * pos.qty;
        const fees = (pos.entryPrice + exitPrice) * pos.qty * feeRate;
        const pnlUsd = gross - fees;
        const pnlR = pos.riskUsd > 0 ? pnlUsd / pos.riskUsd : 0;
        trades.push({
          side: pos.side,
          entryTime: pos.entryTime,
          entryPrice: pos.entryPrice,
          exitTime: c.time,
          exitPrice,
          qty: pos.qty,
          stop: pos.stop,
          target: pos.target,
          exitReason,
          pnlUsd,
          pnlR,
          duration: c.time - pos.entryTime,
        });
        cash += pnlUsd;
        pos = null;
        lastTradeTime = c.time;
      }
    }

    // === Entry logic — only if no position and risk gates allow ===
    if (!pos && c.time - lastTradeTime >= cfg.cooldownMs) {
      // Daily-loss check is approximated per-bar here (full daily tracking
      // would need a calendar; we use rolling equity DD as the proxy).
      if (ratchet >= 0 && maxDdPct > ratchet) {
        // Ratchet tripped — skip
      } else {
        const snap = snapshotAt(candles, cache, i);
        if (snap) {
          const sig = localSignal(snap);
          if (
            sig.action !== "HOLD" &&
            Math.abs(sig.score) >= minScore &&
            sig.confidence >= minConfidence
          ) {
            const side: Side = sig.action === "BUY" ? "BUY" : "SELL";
            const plan: StopPlan = planTrade({
              side,
              entry: price,
              snapshot: snap,
              equity: markToMarket,
              settings: cfg,
            });
            if (plan.rr >= cfg.minRR && plan.qty > 0 && plan.risk > 0) {
              pos = {
                side,
                entryTime: c.time,
                entryPrice: price,
                stop: plan.stop,
                target: plan.target,
                qty: plan.qty,
                riskUsd: plan.riskUsd,
                trail: plan.stop,
                best: price,
                atrAtEntry: snap.atr ?? price * 0.02,
              };
            }
          }
        }
      }
    }

    // Track equity curve & drawdown
    const eq = pos
      ? cash + pos.qty * price * (pos.side === "BUY" ? 1 : -1)
      : cash;
    equity.push({ time: c.time, equity: eq, price });
    if (eq > peakEquity) peakEquity = eq;
    const ddUsd = peakEquity - eq;
    const ddPct = peakEquity > 0 ? (ddUsd / peakEquity) * 100 : 0;
    if (ddUsd > maxDdUsd) maxDdUsd = ddUsd;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
  }

  // Force-close at end
  if (cfg.closeAtEnd && pos) {
    const last = candles[candles.length - 1];
    const dir = pos.side === "BUY" ? 1 : -1;
    const gross = (last.close - pos.entryPrice) * dir * pos.qty;
    const fees = (pos.entryPrice + last.close) * pos.qty * feeRate;
    const pnlUsd = gross - fees;
    const pnlR = pos.riskUsd > 0 ? pnlUsd / pos.riskUsd : 0;
    trades.push({
      side: pos.side,
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      exitTime: last.time,
      exitPrice: last.close,
      qty: pos.qty,
      stop: pos.stop,
      target: pos.target,
      exitReason: "END",
      pnlUsd,
      pnlR,
      duration: last.time - pos.entryTime,
    });
    cash += pnlUsd;
    pos = null;
  }

  const stats = summarizeStats(trades, equity, cfg.initialEquity, inBars);

  return {
    config: cfg,
    symbol: meta.symbol ?? "",
    interval: meta.interval ?? "",
    bars: candles.length,
    startTime: candles[0]?.time ?? 0,
    endTime: candles[candles.length - 1]?.time ?? 0,
    trades,
    equity,
    stats,
    durationMs: performance.now() - t0,
  };
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function summarizeStats(
  trades: BacktestTrade[],
  equity: EquityPoint[],
  initialEquity: number,
  inBars: number,
): BacktestStats {
  const finalEquity = equity.length
    ? equity[equity.length - 1].equity
    : initialEquity;
  const netPnlUsd = finalEquity - initialEquity;
  const netPnlPct = initialEquity > 0 ? (netPnlUsd / initialEquity) * 100 : 0;

  const winners = trades.filter((t) => t.pnlUsd > 0);
  const losers = trades.filter((t) => t.pnlUsd <= 0);
  const sumWins = winners.reduce((s, t) => s + t.pnlUsd, 0);
  const sumLosses = losers.reduce((s, t) => s + t.pnlUsd, 0);
  const winRate = trades.length > 0 ? winners.length / trades.length : 0;
  const profitFactor =
    sumLosses < 0 ? sumWins / Math.abs(sumLosses) : sumWins > 0 ? Infinity : 0;
  const avgWinUsd = winners.length > 0 ? sumWins / winners.length : 0;
  const avgLossUsd = losers.length > 0 ? sumLosses / losers.length : 0;
  const avgR =
    trades.length > 0
      ? trades.reduce((s, t) => s + t.pnlR, 0) / trades.length
      : 0;

  // Drawdown from equity curve
  let peak = initialEquity;
  let maxDdUsd = 0;
  let maxDdPct = 0;
  for (const p of equity) {
    if (p.equity > peak) peak = p.equity;
    const dd = peak - p.equity;
    const ddPct = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDdUsd) maxDdUsd = dd;
    if (ddPct > maxDdPct) maxDdPct = ddPct;
  }

  // Sharpe — daily returns derived from equity curve
  // Use a simple log-return approximation; assume 1 bar = 1 unit.
  // Annualisation factor is provided by the caller indirectly via interval
  // but for portability we use bars^0.5 with a 252x scale baseline. The
  // caller can interpret the value relative to the bar frequency.
  const sharpe = computeSharpe(equity);

  // Expectancy = (winRate * avgWin) - (lossRate * |avgLoss|)
  const expectancy =
    trades.length > 0 ? winRate * avgWinUsd + (1 - winRate) * avgLossUsd : 0;

  const exposure = equity.length > 0 ? inBars / equity.length : 0;

  // Streak
  let bestW = 0,
    bestL = 0,
    curW = 0,
    curL = 0;
  for (const t of trades) {
    if (t.pnlUsd > 0) {
      curW++;
      curL = 0;
      if (curW > bestW) bestW = curW;
    } else {
      curL++;
      curW = 0;
      if (curL > bestL) bestL = curL;
    }
  }
  const longestStreak =
    bestW >= bestL
      ? { kind: "W" as const, length: bestW }
      : { kind: "L" as const, length: bestL };

  return {
    initialEquity,
    finalEquity,
    netPnlUsd,
    netPnlPct,
    totalTrades: trades.length,
    winners: winners.length,
    losers: losers.length,
    winRate,
    profitFactor,
    avgWinUsd,
    avgLossUsd,
    avgRMultiple: avgR,
    maxDrawdownUsd: maxDdUsd,
    maxDrawdownPct: maxDdPct,
    sharpe,
    expectancy,
    exposure,
    longestStreak,
  };
}

function computeSharpe(equity: EquityPoint[]): number {
  if (equity.length < 2) return 0;
  const returns: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1].equity;
    if (prev > 0) returns.push(equity[i].equity / prev - 1);
  }
  if (returns.length < 2) return 0;
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  const sd = Math.sqrt(variance);
  if (sd === 0) return 0;
  // Annualise: scale by sqrt(252*24) ≈ sqrt(6048) for hourly bars; this is
  // a coarse approximation but gives a comparable ratio across intervals.
  const ann = Math.sqrt(252 * 24);
  return (mean / sd) * ann;
}

function emptyResult(
  candles: Candle[],
  cfg: BacktestConfig,
  meta: { symbol?: string; interval?: string },
  t0: number,
  reason: string,
): BacktestResult {
  return {
    config: cfg,
    symbol: meta.symbol ?? "",
    interval: meta.interval ?? "",
    bars: candles.length,
    startTime: candles[0]?.time ?? 0,
    endTime: candles[candles.length - 1]?.time ?? 0,
    trades: [],
    equity: [],
    stats: {
      initialEquity: cfg.initialEquity,
      finalEquity: cfg.initialEquity,
      netPnlUsd: 0,
      netPnlPct: 0,
      totalTrades: 0,
      winners: 0,
      losers: 0,
      winRate: 0,
      profitFactor: 0,
      avgWinUsd: 0,
      avgLossUsd: 0,
      avgRMultiple: 0,
      maxDrawdownUsd: 0,
      maxDrawdownPct: 0,
      sharpe: 0,
      expectancy: 0,
      exposure: 0,
      longestStreak: { kind: "W", length: 0 },
    },
    durationMs: performance.now() - t0,
  };
}

// Re-export fetchKlines for callers that want the raw loader
export { fetchKlines };

// Suppress unused import warning — `pivots` is intentionally not used here
// (caller may want to do swing analysis on top of the result).
void pivots;
