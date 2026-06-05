// Market regime detector — classifies the current market state into one of
// four buckets and tracks regime transitions with hysteresis to prevent
// flicker on noisy single-bar readings.
//
// Regimes:
//   BULL_TREND  — ema stack up, ADX strong, +DI dominant, HH/HL structure
//   BEAR_TREND  — ema stack down, ADX strong, -DI dominant, LH/LL structure
//   RANGE       — ADX weak, no clear trend, volatility normal
//   VOLATILE    — ATR regime HIGH/EXTREME (overrides trend)
//
// Confidence: 0..100, agreement-weighted across the dimensions.

import type { Candle, IndicatorSnapshot } from "./indicators";
import {
  adx,
  atr,
  bollinger,
  ema,
  marketStructure,
  obv,
  rsi,
  volatilityRegime,
  vwap,
} from "./indicators";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Regime = "BULL_TREND" | "BEAR_TREND" | "RANGE" | "VOLATILE";

export type RegimeConfidence = {
  /** 0..100 — weighted agreement across dimensions */
  overall: number;
  trend: number; // 0..100
  volatility: number; // 0..100
  momentum: number; // 0..100
  structure: number; // 0..100
};

export type RegimeSnapshot = {
  regime: Regime;
  previous: Regime;
  confidence: RegimeConfidence;
  /** Per-dimension raw readings (for the UI breakdown). */
  diagnostics: {
    emaStack: "BULL" | "BEAR" | "MIXED";
    adx: number | null;
    plusDI: number | null;
    minusDI: number | null;
    atrPct: number | null;
    bbWidth: number | null;
    rsi: number | null;
    structure: "UP" | "DOWN" | "RANGE";
  };
  /** Counter — how many consecutive bars the current regime has been held. */
  barsInRegime: number;
  /** ISO timestamp of the source candle. */
  time: number;
};

export type RegimeHistoryPoint = {
  time: number;
  regime: Regime;
  confidence: number;
};

// ---------------------------------------------------------------------------
// Live classification (single snapshot)
// ---------------------------------------------------------------------------

export function classifyRegime(snap: IndicatorSnapshot): RegimeSnapshot {
  const diagnostics = extractDiagnostics(snap);

  // --- Dimensions (each 0..100) ---
  let trend = 50; // 50 = neutral, >50 = bullish bias, <50 = bearish bias
  let momentum = 50;
  let structureScore = 50;
  let volatilityScore = 50;
  let regime: Regime;

  // 1) Trend dimension — EMA stack + ADX + DI
  const adxVal = diagnostics.adx ?? 0;
  const diDom =
    diagnostics.plusDI !== null && diagnostics.minusDI !== null
      ? diagnostics.plusDI - diagnostics.minusDI
      : 0;

  if (diagnostics.emaStack === "BULL") trend += 25;
  else if (diagnostics.emaStack === "BEAR") trend -= 25;
  if (adxVal > 25)
    trend += Math.sign(diDom) * Math.min(25, (adxVal - 25) * 0.8);
  trend = clamp(trend, 0, 100);

  // 2) Momentum — RSI
  if (diagnostics.rsi !== null) {
    if (diagnostics.rsi > 55) momentum = 50 + (diagnostics.rsi - 55) * 1.5;
    else if (diagnostics.rsi < 45) momentum = 50 - (45 - diagnostics.rsi) * 1.5;
  }
  momentum = clamp(momentum, 0, 100);

  // 3) Structure — HH/HL
  if (diagnostics.structure === "UP") structureScore = 80;
  else if (diagnostics.structure === "DOWN") structureScore = 20;
  structureScore = clamp(structureScore, 0, 100);

  // 4) Volatility — ATR%
  if (diagnostics.atrPct !== null) {
    if (diagnostics.atrPct > 0.04) volatilityScore = 90;
    else if (diagnostics.atrPct > 0.02) volatilityScore = 70;
    else if (diagnostics.atrPct < 0.005) volatilityScore = 30;
    else if (diagnostics.atrPct < 0.01) volatilityScore = 40;
  }
  volatilityScore = clamp(volatilityScore, 0, 100);

  // --- Regime decision ---
  // Volatility overrides everything if ATR% is extreme
  if (
    snap.volRegime === "EXTREME" ||
    (diagnostics.atrPct !== null && diagnostics.atrPct > 0.06)
  ) {
    regime = "VOLATILE";
  } else if (trend >= 65 && structureScore >= 60) {
    regime = "BULL_TREND";
  } else if (trend <= 35 && structureScore <= 40) {
    regime = "BEAR_TREND";
  } else if (
    adxVal < 20 &&
    snap.volRegime !== "HIGH" &&
    (diagnostics.bbWidth === null || diagnostics.bbWidth < 0.04)
  ) {
    regime = "RANGE";
  } else if (Math.abs(trend - 50) > 15) {
    // Mild directional bias
    regime = trend > 50 ? "BULL_TREND" : "BEAR_TREND";
  } else {
    regime = "RANGE";
  }

  // --- Confidence: weighted agreement ---
  const agree =
    0.4 * Math.abs(trend - 50) * 2 + // trend conviction
    0.25 * Math.abs(structureScore - 50) * 2 +
    0.2 * Math.abs(momentum - 50) * 2 +
    0.15 * Math.abs(volatilityScore - 50) * 2;
  const overall = clamp(agree, 0, 100);

  return {
    regime,
    previous: regime, // overridden by hysteresis wrapper
    confidence: {
      overall,
      trend: Math.round(Math.abs(trend - 50) * 2),
      volatility: Math.round(Math.abs(volatilityScore - 50) * 2),
      momentum: Math.round(Math.abs(momentum - 50) * 2),
      structure: Math.round(Math.abs(structureScore - 50) * 2),
    },
    diagnostics,
    barsInRegime: 1,
    time: snap.price > 0 ? Math.floor(Date.now() / 1000) : 0,
  };
}

function extractDiagnostics(snap: IndicatorSnapshot) {
  let emaStack: "BULL" | "BEAR" | "MIXED" = "MIXED";
  if (snap.ema20 !== null && snap.ema50 !== null && snap.ema200 !== null) {
    if (snap.ema20 > snap.ema50 && snap.ema50 > snap.ema200) emaStack = "BULL";
    else if (snap.ema20 < snap.ema50 && snap.ema50 < snap.ema200)
      emaStack = "BEAR";
  }
  return {
    emaStack,
    adx: snap.adx,
    plusDI: snap.plusDI,
    minusDI: snap.minusDI,
    atrPct: snap.atrPct,
    bbWidth: snap.bbWidth,
    rsi: snap.rsi,
    structure: snap.structure,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ---------------------------------------------------------------------------
// Hysteresis: require N consecutive bars of new regime before switching
// ---------------------------------------------------------------------------

const HYSTERESIS_BARS = 3;

/**
 * Run classifyRegime on a series of candles and apply hysteresis to avoid
 * regime flicker. Returns the history (one entry per bar) and the final
 * state. The latest entry is the current regime.
 */
export function regimeHistory(
  candles: Candle[],
  opts: { historyBars?: number; hysteresisBars?: number } = {},
): { history: RegimeHistoryPoint[]; current: RegimeSnapshot | null } {
  const hyst = opts.hysteresisBars ?? HYSTERESIS_BARS;
  const limit = opts.historyBars ?? candles.length;
  if (candles.length < 60) return { history: [], current: null };

  // Pre-compute indicator series once
  const closes = candles.map((c) => c.close);
  const r = rsi(closes);
  const a = atr(candles, 14);
  const b = bollinger(closes);
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const e200 = ema(closes, 200);
  const adxData = adx(candles, 14);
  const vw = vwap(candles);
  const obvArr = obv(candles);
  void vw;
  void obvArr;

  const start = Math.max(50, candles.length - limit);
  let current: Regime = "RANGE";
  let candidate: Regime | null = null;
  let candidateCount = 0;
  let barsInRegime = 0;
  const history: RegimeHistoryPoint[] = [];

  for (let i = start; i < candles.length; i++) {
    const c = candles[i];
    const structure = marketStructure(
      candles.slice(Math.max(0, i - 29), i + 1),
      30,
    );
    const volRegime = volatilityRegime(candles.slice(0, i + 1), 14, 50);

    const lookback24h = Math.min(i + 1, 96);
    const slice24h = candles.slice(i - lookback24h + 1, i + 1);
    const high24h = Math.max(...slice24h.map((k) => k.high));
    const low24h = Math.min(...slice24h.map((k) => k.low));
    const range24h = high24h - low24h;
    const price = c.close;
    const rangePos = range24h > 0 ? (price - low24h) / range24h : 0.5;

    const atrVal = a[i];
    const bbU = b.upper[i];
    const bbL = b.lower[i];
    const bbM = b.mid[i];
    const bbWidth =
      bbU !== null && bbL !== null && bbM !== null && bbM !== 0
        ? ((bbU as number) - (bbL as number)) / (bbM as number)
        : null;

    const ema20Slope =
      e20[i] !== null && e20[i - 3] !== null && (e20[i - 3] as number) !== 0
        ? (((e20[i] as number) - (e20[i - 3] as number)) /
            (e20[i - 3] as number)) *
          100
        : null;

    const obvSlope =
      i >= 5 && obvArr[i - 5] !== 0 ? Math.sign(obvArr[i] - obvArr[i - 5]) : 0;

    const snap: IndicatorSnapshot = {
      rsi: r[i] ?? null,
      macd: null,
      macdSignal: null,
      macdHist: null,
      ema20: e20[i] ?? null,
      ema50: e50[i] ?? null,
      ema200: e200[i] ?? null,
      ema20Slope,
      adx: adxData.adx[i] ?? null,
      plusDI: adxData.plusDI[i] ?? null,
      minusDI: adxData.minusDI[i] ?? null,
      atr: atrVal,
      atrPct: atrVal !== null && price > 0 ? (atrVal as number) / price : null,
      bbUpper: bbU,
      bbLower: bbL,
      bbMid: bbM,
      bbWidth,
      stochK: null,
      stochD: null,
      vwap: null,
      obv: null,
      obvSlope,
      structure,
      volRegime,
      supports: [],
      resistances: [],
      high24h,
      low24h,
      rangePos,
      price,
    };

    const raw = classifyRegime(snap);

    if (raw.regime === current) {
      candidate = null;
      candidateCount = 0;
      barsInRegime++;
    } else {
      if (candidate === raw.regime) {
        candidateCount++;
      } else {
        candidate = raw.regime;
        candidateCount = 1;
      }
      if (candidateCount >= hyst) {
        current = raw.regime;
        candidate = null;
        candidateCount = 0;
        barsInRegime = 1;
      } else {
        barsInRegime++;
      }
    }

    history.push({
      time: c.time,
      regime: current,
      confidence: raw.confidence.overall,
    });
  }

  const last = history[history.length - 1];
  const currentSnap: RegimeSnapshot | null = last
    ? {
        regime: last.regime,
        previous: last.regime,
        confidence: {
          overall: last.confidence,
          trend: 0,
          volatility: 0,
          momentum: 0,
          structure: 0,
        },
        diagnostics: {
          emaStack: "MIXED",
          adx: null,
          plusDI: null,
          minusDI: null,
          atrPct: null,
          bbWidth: null,
          rsi: null,
          structure: "RANGE",
        },
        barsInRegime,
        time: last.time,
      }
    : null;

  return { history, current: currentSnap };
}
