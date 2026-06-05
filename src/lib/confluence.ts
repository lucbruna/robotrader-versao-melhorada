// Confluence scoring — aggregates multiple independent signals into a
// single 0-100 score where 0 = max bearish, 50 = neutral, 100 = max bullish.
//
// Six weighted categories (totals 1.0):
//   - Trend      25%  (EMA alignment, slope, structure, ADX)
//   - Momentum   20%  (RSI, MACD hist, Stochastic)
//   - Volatility 15%  (BB position, ATR regime, VWAP)
//   - Volume     15%  (OBV slope, 24h volume change, taker buy/sell)
//   - Levels     15%  (distance to support/resistance, 24h range position)
//   - Derivatives 10% (funding rate, OI change, long/short ratio)
//
// Each category produces a value in [-1, +1]. Weights multiply it, the
// weighted sum is the directional score. We then map [-1, +1] -> [0, 100]
// for display. Confidence is the magnitude of the directional score
// (how far from neutral), independent of the dashboard's other signals.

import type { IndicatorSnapshot } from "./indicators";
import type { Ticker24h } from "./binance";
import {
  fundingTone,
  type LongShortRatio,
  type OpenInterest,
  type PremiumIndex,
  type TakerRatio,
} from "./futures-data";

export type FactorCategory =
  | "trend"
  | "momentum"
  | "volatility"
  | "volume"
  | "levels"
  | "derivatives";

export type FactorTone = "bullish" | "bearish" | "neutral";

export type Factor = {
  id: string;
  category: FactorCategory;
  label: string;
  /** [-1, +1] — contribution BEFORE category weight is applied */
  raw: number;
  /** tone for color coding */
  tone: FactorTone;
  /** short human-readable value (e.g. "RSI 62.4", "EMA alinhado ↑") */
  detail: string;
};

export type Confluence = {
  /** [0, 100] — neutral is 50 */
  score: number;
  /** [-1, +1] — directional bias (signed version of score) */
  signed: number;
  /** [0, 100] — magnitude / "how strong is the signal" (50 = no signal) */
  confidence: number;
  /** Overall tone derived from signed score */
  tone: FactorTone;
  /** Per-factor breakdown in display order */
  factors: Factor[];
  /** Top bullish reasons (descending by contribution) */
  topBullish: Factor[];
  /** Top bearish reasons (descending by |contribution|) */
  topBearish: Factor[];
};

const WEIGHTS: Record<FactorCategory, number> = {
  trend: 0.25,
  momentum: 0.2,
  volatility: 0.15,
  volume: 0.15,
  levels: 0.15,
  derivatives: 0.1,
};

export type ConfluenceInput = {
  snap: IndicatorSnapshot;
  ticker?: Ticker24h | null;
  premium?: PremiumIndex | null;
  oiChange24h?: number | null;
  oi?: OpenInterest | null;
  longShort?: LongShortRatio | null;
  taker?: TakerRatio | null;
};

export function computeConfluence(input: ConfluenceInput): Confluence {
  const factors: Factor[] = [
    ...trendFactors(input.snap),
    ...momentumFactors(input.snap),
    ...volatilityFactors(input.snap),
    ...volumeFactors(input.snap, input.taker),
    ...levelsFactors(input.snap),
    ...derivativesFactors(input),
  ];

  // Apply category weights and sum
  let weighted = 0;
  for (const f of factors) {
    weighted += f.raw * WEIGHTS[f.category];
  }
  // Clip to [-1, +1] just in case rounding overflows
  const signed = Math.max(-1, Math.min(1, weighted));
  const score = Math.round((signed + 1) * 50); // [0, 100]
  const confidence = Math.round(Math.abs(signed) * 100);
  const tone: FactorTone =
    signed > 0.05 ? "bullish" : signed < -0.05 ? "bearish" : "neutral";

  // Top factors per direction (limit 3 each, raw * weight = contribution)
  const bull = factors
    .filter((f) => f.raw > 0)
    .sort((a, b) => b.raw * WEIGHTS[b.category] - a.raw * WEIGHTS[a.category])
    .slice(0, 3);
  const bear = factors
    .filter((f) => f.raw < 0)
    .sort((a, b) => a.raw * WEIGHTS[a.category] - b.raw * WEIGHTS[b.category])
    .slice(0, 3);

  return {
    score,
    signed,
    confidence,
    tone,
    factors,
    topBullish: bull,
    topBearish: bear,
  };
}

// ---- Category builders ----

function trendFactors(s: IndicatorSnapshot): Factor[] {
  const out: Factor[] = [];

  // EMA alignment (20/50/200) — full bull stack or full bear stack
  if (s.ema20 != null && s.ema50 != null && s.ema200 != null) {
    const bull = s.ema20 > s.ema50 && s.ema50 > s.ema200;
    const bear = s.ema20 < s.ema50 && s.ema50 < s.ema200;
    out.push({
      id: "ema-align",
      category: "trend",
      label: "Alinhamento EMA",
      raw: bull ? 1 : bear ? -1 : 0,
      tone: bull ? "bullish" : bear ? "bearish" : "neutral",
      detail: bull ? "20 > 50 > 200 (↑)" : bear ? "20 < 50 < 200 (↓)" : "misto",
    });
  } else {
    out.push({
      id: "ema-align",
      category: "trend",
      label: "Alinhamento EMA",
      raw: 0,
      tone: "neutral",
      detail: "dados insuficientes",
    });
  }

  // EMA20 slope (% per bar)
  if (s.ema20Slope != null) {
    const raw = Math.max(-1, Math.min(1, s.ema20Slope * 50));
    out.push({
      id: "ema-slope",
      category: "trend",
      label: "EMA20 slope",
      raw,
      tone: raw > 0.1 ? "bullish" : raw < -0.1 ? "bearish" : "neutral",
      detail: `${s.ema20Slope >= 0 ? "+" : ""}${(s.ema20Slope * 100).toFixed(3)}%/bar`,
    });
  }

  // Structure
  out.push({
    id: "structure",
    category: "trend",
    label: "Estrutura",
    raw: s.structure === "UP" ? 0.8 : s.structure === "DOWN" ? -0.8 : 0,
    tone:
      s.structure === "UP"
        ? "bullish"
        : s.structure === "DOWN"
          ? "bearish"
          : "neutral",
    detail: s.structure,
  });

  // ADX with DI direction (only contributes when ADX > 20 — confirms trend)
  if (s.adx != null && s.plusDI != null && s.minusDI != null) {
    const strength = Math.min(1, Math.max(0, (s.adx - 15) / 35)); // 0..1, ramps 15..50
    const dir = s.plusDI > s.minusDI ? 1 : -1;
    out.push({
      id: "adx",
      category: "trend",
      label: "ADX + DI",
      raw: strength * dir,
      tone: dir > 0 ? "bullish" : "bearish",
      detail: `ADX ${s.adx.toFixed(1)} · ${dir > 0 ? "+DI" : "-DI"} ${dir > 0 ? s.plusDI.toFixed(1) : s.minusDI.toFixed(1)}`,
    });
  }
  return out;
}

function momentumFactors(s: IndicatorSnapshot): Factor[] {
  const out: Factor[] = [];

  if (s.rsi != null) {
    let raw = 0;
    let tone: FactorTone = "neutral";
    let detail = `RSI ${s.rsi.toFixed(1)}`;
    if (s.rsi < 25) {
      raw = 0.9;
      tone = "bullish";
      detail += " (sobrevendido extremo)";
    } else if (s.rsi < 40) {
      raw = 0.5;
      tone = "bullish";
      detail += " (sobrevendido)";
    } else if (s.rsi < 60) {
      raw = 0;
      detail += " (neutro)";
    } else if (s.rsi < 75) {
      raw = -0.2;
      tone = "neutral";
      detail += " (forte)";
    } else {
      raw = -0.7;
      tone = "bearish";
      detail += " (sobrecomprado)";
    }
    out.push({
      id: "rsi",
      category: "momentum",
      label: "RSI(14)",
      raw,
      tone,
      detail,
    });
  }

  if (s.macdHist != null && s.macd != null && s.macdSignal != null) {
    // Histogram sign + whether it's expanding
    const sign = Math.sign(s.macdHist);
    // Magnitude relative to price: clip at 1% of price
    const rel = Math.min(
      1,
      Math.abs(s.macdHist) / Math.max(s.price * 0.005, 1),
    );
    const raw = sign * rel;
    out.push({
      id: "macd",
      category: "momentum",
      label: "MACD hist",
      raw,
      tone: raw > 0.1 ? "bullish" : raw < -0.1 ? "bearish" : "neutral",
      detail: `${sign >= 0 ? "+" : ""}${s.macdHist.toFixed(4)} (${sign >= 0 ? "↑" : "↓"})`,
    });
  }

  if (s.stochK != null && s.stochD != null) {
    const cross = s.stochK - s.stochD;
    let raw = 0;
    let tone: FactorTone = "neutral";
    if (s.stochK < 20) {
      raw = 0.6;
      tone = "bullish";
    } else if (s.stochK > 80) {
      raw = -0.5;
      tone = "bearish";
    } else {
      raw = Math.max(-0.5, Math.min(0.5, cross / 20));
    }
    out.push({
      id: "stoch",
      category: "momentum",
      label: "Estocástico",
      raw,
      tone,
      detail: `K ${s.stochK.toFixed(1)} / D ${s.stochD.toFixed(1)}`,
    });
  }

  return out;
}

function volatilityFactors(s: IndicatorSnapshot): Factor[] {
  const out: Factor[] = [];

  if (
    s.bbUpper != null &&
    s.bbLower != null &&
    s.bbMid != null &&
    s.bbMid > 0
  ) {
    const range = s.bbUpper - s.bbLower;
    const pos = range > 0 ? (s.price - s.bbLower) / range : 0.5;
    // Centered around 0.5: <0.3 → buy dip, >0.7 → overbought
    const raw = (0.5 - pos) * 2; // [-1, +1]
    out.push({
      id: "bb-pos",
      category: "volatility",
      label: "Posição nas BB",
      raw: Math.max(-1, Math.min(1, raw)),
      tone: raw > 0.15 ? "bullish" : raw < -0.15 ? "bearish" : "neutral",
      detail: `${(pos * 100).toFixed(0)}% da banda`,
    });
  }

  // VWAP position
  if (s.vwap != null && s.vwap > 0) {
    const diff = (s.price - s.vwap) / s.vwap;
    const raw = Math.max(-1, Math.min(1, diff * 50));
    out.push({
      id: "vwap",
      category: "volatility",
      label: "VWAP",
      raw,
      tone: raw > 0.05 ? "bullish" : raw < -0.05 ? "bearish" : "neutral",
      detail: `${raw >= 0 ? "acima" : "abaixo"} ${(Math.abs(diff) * 100).toFixed(2)}%`,
    });
  }

  // ATR regime: extreme/high → reduce signal strength (we want to add a
  // slight "uncertainty" so it never crosses zero, just dampens)
  if (s.volRegime === "EXTREME" || s.volRegime === "HIGH") {
    out.push({
      id: "atr-regime",
      category: "volatility",
      label: "Regime vol.",
      raw: -0.2,
      tone: "bearish",
      detail: `${s.volRegime} (sinal mais ruidoso)`,
    });
  }
  return out;
}

function volumeFactors(
  s: IndicatorSnapshot,
  taker?: TakerRatio | null,
): Factor[] {
  const out: Factor[] = [];

  if (s.obvSlope !== 0) {
    out.push({
      id: "obv",
      category: "volume",
      label: "OBV slope",
      raw: s.obvSlope > 0 ? 0.7 : -0.7,
      tone: s.obvSlope > 0 ? "bullish" : "bearish",
      detail: s.obvSlope > 0 ? "compradores dominando" : "vendedores dominando",
    });
  }

  if (taker && isFinite(taker.buySellRatio) && taker.buySellRatio > 0) {
    const r = taker.buySellRatio;
    const raw = Math.max(-1, Math.min(1, (r - 1) * 2));
    out.push({
      id: "taker",
      category: "volume",
      label: "Taker buy/sell",
      raw,
      tone: raw > 0.1 ? "bullish" : raw < -0.1 ? "bearish" : "neutral",
      detail: `${r.toFixed(2)} (${raw >= 0 ? "buy > sell" : "sell > buy"})`,
    });
  }

  return out;
}

function levelsFactors(s: IndicatorSnapshot): Factor[] {
  const out: Factor[] = [];

  // Range position 0..1 (already provided by indicator snapshot)
  if (s.rangePos != null) {
    const raw = (0.5 - s.rangePos) * 2; // bottom = bullish
    out.push({
      id: "range-pos",
      category: "levels",
      label: "Posição no range 24h",
      raw: Math.max(-1, Math.min(1, raw)),
      tone: raw > 0.15 ? "bullish" : raw < -0.15 ? "bearish" : "neutral",
      detail: `${(s.rangePos * 100).toFixed(0)}% (low→high)`,
    });
  }

  // Distance to nearest support vs resistance
  if (s.supports.length > 0 && s.resistances.length > 0 && s.price > 0) {
    const nearestSupport = s.supports.reduce(
      (best, v) => (v < s.price && s.price - v < s.price - best ? v : best),
      s.supports[0],
    );
    const nearestResistance = s.resistances.reduce(
      (best, v) => (v > s.price && v - s.price < best - s.price ? v : best),
      s.resistances[0],
    );
    if (nearestSupport > 0 && nearestResistance > 0) {
      const distSup = ((s.price - nearestSupport) / s.price) * 100;
      const distRes = ((nearestResistance - s.price) / s.price) * 100;
      // Closer to support = bullish, closer to resistance = bearish
      const total = distSup + distRes || 1;
      const raw = (distSup - distRes) / total; // [-1, +1]
      out.push({
        id: "levels-dist",
        category: "levels",
        label: "Distância S/R",
        raw: Math.max(-1, Math.min(1, raw)),
        tone: raw > 0.1 ? "bullish" : raw < -0.1 ? "bearish" : "neutral",
        detail: `sup ${distSup.toFixed(2)}% · res ${distRes.toFixed(2)}%`,
      });
    }
  }
  return out;
}

function derivativesFactors(input: ConfluenceInput): Factor[] {
  const out: Factor[] = [];

  // Funding rate tone
  if (input.premium) {
    const tone = fundingTone(input.premium.lastFundingRate);
    // Negative rate (shorts pay) = bullish sentiment, positive = bearish
    const raw = tone === "bullish" ? 0.6 : tone === "bearish" ? -0.6 : 0;
    out.push({
      id: "funding",
      category: "derivatives",
      label: "Funding rate",
      raw,
      tone,
      detail: `${(input.premium.lastFundingRate * 100).toFixed(4)}% / 8h`,
    });
  }

  // OI change 24h
  if (input.oiChange24h != null) {
    // |change| > 2% starts to matter; cap at +/- 10% = +/- 0.8
    const raw = Math.max(-1, Math.min(1, input.oiChange24h / 12.5));
    out.push({
      id: "oi-change",
      category: "derivatives",
      label: "Δ OI 24h",
      raw,
      tone: raw > 0.1 ? "bullish" : raw < -0.1 ? "bearish" : "neutral",
      detail: `${input.oiChange24h >= 0 ? "+" : ""}${input.oiChange24h.toFixed(2)}%`,
    });
  }

  // Long/short ratio (top traders)
  if (input.longShort && isFinite(input.longShort.longShortRatio)) {
    const r = input.longShort.longShortRatio;
    // r=1 neutral, r=2 bullish (too crowded long → contrarian bearish)
    let raw = 0;
    let tone: FactorTone = "neutral";
    if (r > 1.7) {
      raw = -0.3; // contrarian: too long
      tone = "bearish";
    } else if (r > 1.2) {
      raw = 0.3;
      tone = "bullish";
    } else if (r < 0.6) {
      raw = 0.3; // contrarian: too short
      tone = "bullish";
    } else if (r < 0.85) {
      raw = -0.3;
      tone = "bearish";
    }
    out.push({
      id: "ls-ratio",
      category: "derivatives",
      label: "L/S top traders",
      raw,
      tone,
      detail: r.toFixed(2),
    });
  }
  return out;
}

// ---- Public helpers for the UI ----

export const CONFLUENCE_CATEGORIES: FactorCategory[] = [
  "trend",
  "momentum",
  "volatility",
  "volume",
  "levels",
  "derivatives",
];

export const CATEGORY_WEIGHTS = WEIGHTS;

export function categoryLabel(c: FactorCategory): string {
  return (
    {
      trend: "Tendência",
      momentum: "Momentum",
      volatility: "Volatilidade",
      volume: "Volume",
      levels: "Níveis",
      derivatives: "Derivativos",
    } as Record<FactorCategory, string>
  )[c];
}

export function categoryFactors(conf: Confluence, c: FactorCategory): Factor[] {
  return conf.factors.filter((f) => f.category === c);
}

export function categoryScore(conf: Confluence, c: FactorCategory): number {
  const factors = categoryFactors(conf, c);
  if (factors.length === 0) return 50;
  let sum = 0;
  for (const f of factors) sum += f.raw;
  const avg = sum / factors.length; // [-1, +1]
  return Math.round((avg + 1) * 50);
}
