// Technical indicators — pure functions over OHLC arrays
// All indicators are pure: deterministic and side-effect free.

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      let s = 0;
      for (let j = i - period + 1; j <= i; j++) s += values[j];
      prev = s / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gains = 0,
    losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gains += d;
    else losses -= d;
  }
  let avgG = gains / period,
    avgL = losses / period;
  out[period] = 100 - 100 / (1 + (avgL === 0 ? 100 : avgG / avgL));
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = 100 - 100 / (1 + (avgL === 0 ? 100 : avgG / avgL));
  }
  return out;
}

export function macd(
  values: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): {
  macd: (number | null)[];
  signal: (number | null)[];
  hist: (number | null)[];
} {
  const eFast = ema(values, fast);
  const eSlow = ema(values, slow);
  const macdLine = values.map((_, i) =>
    eFast[i] !== null && eSlow[i] !== null
      ? (eFast[i] as number) - (eSlow[i] as number)
      : null,
  );
  const valid = macdLine.map((v) => (v === null ? 0 : v));
  const sigArr = ema(valid, signal).map((v, i) =>
    macdLine[i] === null ? null : v,
  );
  const hist = macdLine.map((v, i) =>
    v !== null && sigArr[i] !== null ? v - (sigArr[i] as number) : null,
  );
  return { macd: macdLine, signal: sigArr, hist };
}

export function bollinger(
  values: number[],
  period = 20,
  mult = 2,
): {
  upper: (number | null)[];
  mid: (number | null)[];
  lower: (number | null)[];
} {
  const mid = sma(values, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1 || mid[i] === null) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let sq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sq += (values[j] - (mid[i] as number)) ** 2;
    }
    const sd = Math.sqrt(sq / period);
    upper.push((mid[i] as number) + mult * sd);
    lower.push((mid[i] as number) - mult * sd);
  }
  return { upper, mid, lower };
}

// Average True Range — true range considers gaps via previous close
export function atr(candles: Candle[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period + 1) return out;
  const tr: number[] = new Array(candles.length).fill(0);
  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const c = candles[i];
    tr[i] = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose),
    );
  }
  // Wilder smoothing
  let sum = 0;
  for (let i = 1; i <= period; i++) sum += tr[i];
  out[period] = sum / period;
  for (let i = period + 1; i < candles.length; i++) {
    const prev = out[i - 1] as number;
    out[i] = (prev * (period - 1) + tr[i]) / period;
  }
  return out;
}

// Average Directional Index — trend strength (0-100)
export function adx(
  candles: Candle[],
  period = 14,
): {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
} {
  const len = candles.length;
  const adxArr: (number | null)[] = new Array(len).fill(null);
  const plus: (number | null)[] = new Array(len).fill(null);
  const minus: (number | null)[] = new Array(len).fill(null);
  if (len < period * 2 + 1)
    return { adx: adxArr, plusDI: plus, minusDI: minus };

  const trArr: number[] = new Array(len).fill(0);
  const plusDM: number[] = new Array(len).fill(0);
  const minusDM: number[] = new Array(len).fill(0);

  for (let i = 1; i < len; i++) {
    const cur = candles[i];
    const prev = candles[i - 1];
    const up = cur.high - prev.high;
    const down = prev.low - cur.low;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    trArr[i] = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
  }

  // Wilder smoothing of TR, +DM, -DM
  let trSum = 0,
    pSum = 0,
    mSum = 0;
  for (let i = 1; i <= period; i++) {
    trSum += trArr[i];
    pSum += plusDM[i];
    mSum += minusDM[i];
  }

  let trS = trSum;
  let pS = pSum;
  let mS = mSum;
  const dx: number[] = new Array(len).fill(0);
  for (let i = period + 1; i < len; i++) {
    trS = trS - trS / period + trArr[i];
    pS = pS - pS / period + plusDM[i];
    mS = mS - mS / period + minusDM[i];
    const pdi = trS === 0 ? 0 : (100 * pS) / trS;
    const mdi = trS === 0 ? 0 : (100 * mS) / trS;
    const dxv = pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
    dx[i] = dxv;
    if (i === period * 2) {
      let dxSum = 0;
      for (let j = period + 1; j <= i; j++) dxSum += dx[j];
      adxArr[i] = dxSum / period;
    } else if (i > period * 2) {
      adxArr[i] = ((adxArr[i - 1] as number) * (period - 1) + dxv) / period;
    }
    plus[i] = pdi;
    minus[i] = mdi;
  }
  return { adx: adxArr, plusDI: plus, minusDI: minus };
}

// Stochastic Oscillator (K, D)
export function stochastic(
  candles: Candle[],
  kPeriod = 14,
  dPeriod = 3,
): { k: (number | null)[]; d: (number | null)[] } {
  const len = candles.length;
  const kArr: (number | null)[] = new Array(len).fill(null);
  const dArr: (number | null)[] = new Array(len).fill(null);
  for (let i = kPeriod - 1; i < len; i++) {
    let hh = -Infinity,
      ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (candles[j].high > hh) hh = candles[j].high;
      if (candles[j].low < ll) ll = candles[j].low;
    }
    const range = hh - ll;
    kArr[i] = range === 0 ? 50 : ((candles[i].close - ll) / range) * 100;
  }
  const validK = kArr.map((v) => (v === null ? 0 : v));
  const smaK = sma(validK, dPeriod);
  for (let i = 0; i < len; i++) {
    dArr[i] = kArr[i] === null ? null : smaK[i];
  }
  return { k: kArr, d: dArr };
}

// Volume-Weighted Average Price — session anchored (resets daily approximation: use rolling window)
export function vwap(candles: Candle[], window = 96): (number | null)[] {
  const out: (number | null)[] = new Array(candles.length).fill(null);
  let cumPV = 0;
  let cumV = 0;
  const buf: { pv: number; v: number }[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const typical = (c.high + c.low + c.close) / 3;
    const pv = typical * c.volume;
    cumPV += pv;
    cumV += c.volume;
    buf.push({ pv, v: c.volume });
    if (buf.length > window) {
      const old = buf.shift()!;
      cumPV -= old.pv;
      cumV -= old.v;
    }
    out[i] = cumV === 0 ? null : cumPV / cumV;
  }
  return out;
}

// On-Balance Volume — cumulative volume flow
export function obv(candles: Candle[]): number[] {
  const out: number[] = new Array(candles.length).fill(0);
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) {
      out[i] = out[i - 1] + candles[i].volume;
    } else if (candles[i].close < candles[i - 1].close) {
      out[i] = out[i - 1] - candles[i].volume;
    } else {
      out[i] = out[i - 1];
    }
  }
  return out;
}

// Detect swing highs/lows (pivot points) for S/R levels
export function pivots(
  candles: Candle[],
  left = 2,
  right = 2,
): {
  highs: { time: number; price: number }[];
  lows: { time: number; price: number }[];
} {
  const highs: { time: number; price: number }[] = [];
  const lows: { time: number; price: number }[] = [];
  for (let i = left; i < candles.length - right; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ time: candles[i].time, price: candles[i].high });
    if (isLow) lows.push({ time: candles[i].time, price: candles[i].low });
  }
  return { highs, lows };
}

// Cluster nearby pivots into S/R zones (merge levels within tolerance%)
export function supportResistance(
  candles: Candle[],
  lookback = 100,
  tolerancePct = 0.003,
): { supports: number[]; resistances: number[] } {
  const slice = candles.slice(-lookback);
  const { highs, lows } = pivots(slice, 2, 2);
  const price = slice[slice.length - 1]?.close ?? 0;
  if (price === 0) return { supports: [], resistances: [] };

  const cluster = (arr: { price: number }[]) => {
    const sorted = arr.map((a) => a.price).sort((a, b) => b - a);
    const out: number[] = [];
    for (const p of sorted) {
      if (out.length === 0) {
        out.push(p);
        continue;
      }
      const last = out[out.length - 1];
      if (Math.abs(p - last) / last < tolerancePct) {
        out[out.length - 1] = (last + p) / 2;
      } else {
        out.push(p);
      }
    }
    return out;
  };

  const supports = cluster(lows)
    .filter((p) => p < price)
    .slice(0, 3);
  const resistances = cluster(highs)
    .filter((p) => p > price)
    .slice(0, 3);
  return { supports, resistances };
}

// Market structure: HH/HL (uptrend) vs LH/LL (downtrend) over last N swings
export function marketStructure(
  candles: Candle[],
  lookback = 30,
): "UP" | "DOWN" | "RANGE" {
  const slice = candles.slice(-lookback);
  const { highs, lows } = pivots(slice, 2, 2);
  if (highs.length < 2 || lows.length < 2) return "RANGE";
  const lastHighs = highs.slice(-2);
  const lastLows = lows.slice(-2);
  const hh = lastHighs[1].price > lastHighs[0].price;
  const hl = lastLows[1].price > lastLows[0].price;
  const lh = lastHighs[1].price < lastHighs[0].price;
  const ll = lastLows[1].price < lastLows[0].price;
  if (hh && hl) return "UP";
  if (lh && ll) return "DOWN";
  return "RANGE";
}

// Volatility regime classification
export function volatilityRegime(
  candles: Candle[],
  atrPeriod = 14,
  avgPeriod = 50,
): "LOW" | "NORMAL" | "HIGH" | "EXTREME" {
  const a = atr(candles, atrPeriod);
  const last = a[a.length - 1];
  if (last === null) return "NORMAL";
  const validAtrs = a.filter((v): v is number => v !== null).slice(-avgPeriod);
  if (validAtrs.length < avgPeriod / 2) return "NORMAL";
  const avg = validAtrs.reduce((s, v) => s + v, 0) / validAtrs.length;
  const ratio = last / avg;
  if (ratio < 0.6) return "LOW";
  if (ratio < 1.2) return "NORMAL";
  if (ratio < 2) return "HIGH";
  return "EXTREME";
}

// Full snapshot — single source of truth for downstream consumers
export type IndicatorSnapshot = {
  // Trend
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  ema20Slope: number | null; // % change per bar
  adx: number | null;
  plusDI: number | null;
  minusDI: number | null;
  // Volatility
  atr: number | null;
  atrPct: number | null; // ATR as % of price
  bbUpper: number | null;
  bbLower: number | null;
  bbMid: number | null;
  bbWidth: number | null; // (upper-lower)/mid
  // Momentum / Volume
  stochK: number | null;
  stochD: number | null;
  vwap: number | null;
  obv: number | null;
  obvSlope: number; // -1, 0, or 1 (sign of OBV change over last N bars)
  // Structure
  structure: "UP" | "DOWN" | "RANGE";
  volRegime: "LOW" | "NORMAL" | "HIGH" | "EXTREME";
  supports: number[];
  resistances: number[];
  // Range
  high24h: number | null;
  low24h: number | null;
  rangePos: number | null; // 0..1 — where price sits in 24h range
  price: number;
};

export function snapshot(candles: Candle[]): IndicatorSnapshot {
  const closes = candles.map((c) => c.close);
  const i = candles.length - 1;
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
  const sr = supportResistance(candles, 100, 0.003);
  const structure = marketStructure(candles, 30);
  const volRegime = volatilityRegime(candles, 14, 50);

  // 24h range (proxy: use candles available — at least 96 for 15m)
  const lookback24h = Math.min(candles.length, 96);
  const slice24h = candles.slice(-lookback24h);
  const high24h = Math.max(...slice24h.map((c) => c.high));
  const low24h = Math.min(...slice24h.map((c) => c.low));
  const range24h = high24h - low24h;
  const price = closes[i];
  const rangePos = range24h > 0 ? (price - low24h) / range24h : 0.5;

  // EMA20 slope (% per bar, smoothed)
  const ema20Slope =
    e20[i] !== null && e20[i - 3] !== null && (e20[i - 3] as number) !== 0
      ? (((e20[i] as number) - (e20[i - 3] as number)) /
          (e20[i - 3] as number)) *
        100
      : null;

  // OBV slope
  const obvSlope =
    obvArr.length > 5 && obvArr[i - 5] !== 0
      ? Math.sign(obvArr[i] - obvArr[i - 5])
      : 0;

  return {
    rsi: r[i] ?? null,
    macd: m.macd[i] ?? null,
    macdSignal: m.signal[i] ?? null,
    macdHist: m.hist[i] ?? null,
    ema20: e20[i] ?? null,
    ema50: e50[i] ?? null,
    ema200: e200[i] ?? null,
    ema20Slope,
    adx: adxData.adx[i] ?? null,
    plusDI: adxData.plusDI[i] ?? null,
    minusDI: adxData.minusDI[i] ?? null,
    atr: a[i] ?? null,
    atrPct: a[i] !== null && price > 0 ? (a[i] as number) / price : null,
    bbUpper: b.upper[i] ?? null,
    bbLower: b.lower[i] ?? null,
    bbMid: b.mid[i] ?? null,
    bbWidth:
      b.upper[i] !== null && b.lower[i] !== null && b.mid[i]
        ? ((b.upper[i] as number) - (b.lower[i] as number)) /
          (b.mid[i] as number)
        : null,
    stochK: st.k[i] ?? null,
    stochD: st.d[i] ?? null,
    vwap: vw[i] ?? null,
    obv: obvArr[i] ?? null,
    obvSlope,
    structure,
    volRegime,
    supports: sr.supports,
    resistances: sr.resistances,
    high24h,
    low24h,
    rangePos,
    price,
  };
}

export type LocalSignal = {
  action: "BUY" | "SELL" | "HOLD";
  score: number; // -100..100
  confidence: number; // 0..100 — agreement across factors
  reasons: string[];
  warnings: string[]; // caution flags
};

// Heuristic local signal — fast, no AI call needed
// Weights tuned to favour trend-following with mean-reversion on extremes
export function localSignal(s: IndicatorSnapshot): LocalSignal {
  let score = 0;
  const reasons: string[] = [];
  const warnings: string[] = [];

  // === RSI (mean reversion bias) ===
  if (s.rsi !== null) {
    if (s.rsi < 25) {
      score += 30;
      reasons.push(`RSI ${s.rsi.toFixed(1)} sobrevendido extremo`);
    } else if (s.rsi < 35) {
      score += 20;
      reasons.push(`RSI ${s.rsi.toFixed(1)} sobrevendido`);
    } else if (s.rsi > 75) {
      score -= 30;
      reasons.push(`RSI ${s.rsi.toFixed(1)} sobrecomprado extremo`);
    } else if (s.rsi > 65) {
      score -= 20;
      reasons.push(`RSI ${s.rsi.toFixed(1)} sobrecomprado`);
    } else if (s.rsi > 55) {
      score += 5;
    } else if (s.rsi < 45) {
      score -= 5;
    }
  }

  // === MACD momentum ===
  if (s.macdHist !== null) {
    if (s.macdHist > 0) {
      score += 12;
      reasons.push("MACD histograma positivo");
    } else {
      score -= 12;
      reasons.push("MACD histograma negativo");
    }
  }
  if (s.macd !== null && s.macdSignal !== null) {
    const cross = s.macd - s.macdSignal;
    if (
      Math.abs(cross) > 0 &&
      Math.sign(cross) === Math.sign(s.macdHist ?? 0)
    ) {
      score += Math.sign(cross) * 6;
      reasons.push(
        `MACD ${cross > 0 ? "acima" : "abaixo"} do sinal (confirmação)`,
      );
    }
  }

  // === Trend (EMA stack) ===
  if (s.ema20 !== null && s.ema50 !== null) {
    if (s.ema20 > s.ema50) {
      score += 12;
      reasons.push("EMA20 > EMA50 (tend. alta)");
    } else {
      score -= 12;
      reasons.push("EMA20 < EMA50 (tend. baixa)");
    }
  }
  if (s.ema50 !== null && s.ema200 !== null) {
    if (s.ema50 > s.ema200) {
      score += 8;
      reasons.push("Golden trend (EMA50>EMA200)");
    } else {
      score -= 8;
      reasons.push("Death trend (EMA50<EMA200)");
    }
  }
  if (s.ema20Slope !== null) {
    if (s.ema20Slope > 0.1) {
      score += 6;
    } else if (s.ema20Slope < -0.1) {
      score -= 6;
    }
  }

  // === ADX trend strength (confirmation) ===
  if (s.adx !== null) {
    if (s.adx >= 25) {
      // strong trend — amplify direction signal
      const dir =
        s.plusDI !== null && s.minusDI !== null
          ? Math.sign(s.plusDI - s.minusDI)
          : 0;
      if (dir !== 0) {
        score += dir * 8;
        reasons.push(
          `ADX ${s.adx.toFixed(0)} (tend. ${dir > 0 ? "alta" : "baixa"} forte)`,
        );
      }
    } else if (s.adx < 20) {
      warnings.push("ADX fraco — mercado lateral");
    }
  }

  // === Bollinger (mean reversion) ===
  if (s.bbUpper !== null && s.bbLower !== null && s.bbWidth !== null) {
    if (s.price < s.bbLower) {
      score += 10;
      reasons.push("Preço abaixo da Banda inferior");
    } else if (s.price > s.bbUpper) {
      score -= 10;
      reasons.push("Preço acima da Banda superior");
    }
    if (s.bbWidth < 0.02) {
      warnings.push("Bandas apertadas — possível breakout");
    }
  }

  // === Stochastic (extreme crosses) ===
  if (s.stochK !== null && s.stochD !== null) {
    if (s.stochK < 20 && s.stochD < 20) {
      score += 8;
      reasons.push("Estocástico sobrevendido");
    } else if (s.stochK > 80 && s.stochD > 80) {
      score -= 8;
      reasons.push("Estocástico sobrecomprado");
    }
  }

  // === VWAP (intraday bias) ===
  if (s.vwap !== null) {
    const vwapDist = ((s.price - s.vwap) / s.vwap) * 100;
    if (vwapDist > 0.5) {
      score += 6;
      reasons.push(`Preço ${vwapDist.toFixed(2)}% acima do VWAP`);
    } else if (vwapDist < -0.5) {
      score -= 6;
      reasons.push(`Preço ${Math.abs(vwapDist).toFixed(2)}% abaixo do VWAP`);
    }
  }

  // === OBV trend ===
  if (s.obvSlope > 0) {
    score += 4;
    reasons.push("Volume comprador (OBV)");
  } else if (s.obvSlope < 0) {
    score -= 4;
    reasons.push("Volume vendedor (OBV)");
  }

  // === Market structure (heavy weight) ===
  if (s.structure === "UP") {
    score += 10;
    reasons.push("Estrutura de mercado em alta (HH/HL)");
  } else if (s.structure === "DOWN") {
    score -= 10;
    reasons.push("Estrutura de mercado em baixa (LH/LL)");
  }

  // === Volatility regime warning ===
  if (s.volRegime === "EXTREME") {
    warnings.push("Volatilidade EXTREMA — reduzir tamanho");
  } else if (s.volRegime === "HIGH") {
    warnings.push("Volatilidade alta");
  }

  // === Range position warning ===
  if (s.rangePos !== null) {
    if (s.rangePos > 0.95) {
      warnings.push("Preço no topo do range 24h — possível pullback");
    } else if (s.rangePos < 0.05) {
      warnings.push("Preço no fundo do range 24h — possível bounce");
    }
  }

  // === S/R proximity ===
  for (const r of s.resistances) {
    if (Math.abs(s.price - r) / r < 0.005) {
      warnings.push("Próximo de resistência importante");
      score -= 3;
    }
  }
  for (const sp of s.supports) {
    if (Math.abs(s.price - sp) / sp < 0.005) {
      warnings.push("Próximo de suporte importante");
      score += 3;
    }
  }

  // === Clamp + decide ===
  const clamped = Math.max(-100, Math.min(100, score));
  const action: LocalSignal["action"] =
    clamped >= 25 ? "BUY" : clamped <= -25 ? "SELL" : "HOLD";

  // Confidence = how decisive is the signal (0..100)
  const confidence = Math.min(100, Math.abs(clamped));

  return { action, score: clamped, confidence, reasons, warnings };
}
