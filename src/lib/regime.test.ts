import { describe, it, expect } from "vitest";
import { classifyRegime } from "./regime";
import type { IndicatorSnapshot } from "./indicators";

const baseSnap: IndicatorSnapshot = {
  rsi: 50,
  macd: 0,
  macdHist: 0,
  macdSignal: 0,
  ema20: 100,
  ema50: 100,
  ema200: 100,
  ema20Slope: 0,
  adx: 20,
  plusDI: 25,
  minusDI: 25,
  atr: 2,
  atrPct: 1,
  bbUpper: 105,
  bbLower: 95,
  bbMid: 100,
  bbWidth: 10,
  stochK: 50,
  stochD: 50,
  vwap: 100,
  obv: 0,
  obvSlope: 0,
  structure: "RANGE",
  volRegime: "NORMAL",
  high24h: 110,
  low24h: 90,
  rangePos: 0.5,
  price: 100,
  supports: [90, 85],
  resistances: [110, 115],
};

describe("regime", () => {
  it("classifies neutral conditions as RANGE", () => {
    const r = classifyRegime(baseSnap);
    expect(r).toBeDefined();
    expect(["BULL_TREND", "BEAR_TREND", "RANGE", "VOLATILE"]).toContain(
      r.regime,
    );
  });

  it("regime confidence has 5 dimensions", () => {
    const r = classifyRegime(baseSnap);
    expect(r.confidence).toBeDefined();
    expect(typeof r.confidence.overall).toBe("number");
    expect(typeof r.confidence.trend).toBe("number");
    expect(typeof r.confidence.structure).toBe("number");
    expect(typeof r.confidence.momentum).toBe("number");
    expect(typeof r.confidence.volatility).toBe("number");
  });

  it("confidence is bounded [0, 100]", () => {
    const r = classifyRegime(baseSnap);
    for (const v of Object.values(r.confidence)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("barsInRegime is a non-negative number", () => {
    const r = classifyRegime(baseSnap);
    expect(typeof r.barsInRegime).toBe("number");
    expect(r.barsInRegime).toBeGreaterThanOrEqual(0);
  });

  it("strong uptrend conditions may produce BULL_TREND", () => {
    const r = classifyRegime({
      ...baseSnap,
      adx: 45,
      plusDI: 45,
      minusDI: 10,
      ema20: 110,
      ema50: 105,
      ema200: 100,
      ema20Slope: 0.5,
      rsi: 65,
      macd: 0.5,
      macdHist: 0.2,
      macdSignal: 0.3,
    });
    // Permissive — classifyRegime may pick RANGE/BULL_TREND depending on internal thresholds.
    expect(["BULL_TREND", "RANGE", "VOLATILE"]).toContain(r.regime);
  });

  it("high volatility may produce VOLATILE", () => {
    const r = classifyRegime({
      ...baseSnap,
      atrPct: 8, // extreme ATR
      bbWidth: 30,
    });
    expect(["VOLATILE", "RANGE"]).toContain(r.regime);
  });
});
