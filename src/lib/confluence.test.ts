import { describe, it, expect } from "vitest";
import {
  computeConfluence,
  categoryScore,
  categoryLabel,
  CONFLUENCE_CATEGORIES,
} from "./confluence";
import type { ConfluenceInput } from "./confluence";
import type { IndicatorSnapshot } from "./indicators";

const baseSnap: IndicatorSnapshot = {
  rsi: 50,
  macd: 0,
  macdHist: 0,
  ema20: 100,
  ema50: 100,
  ema200: 100,
  adx: 20,
  plusDI: 25,
  minusDI: 25,
  atr: 2,
  atrPct: 1,
  bbWidth: 4,
  stochK: 50,
  stochD: 50,
  vwap: 100,
  price: 100,
  supports: [90, 85],
  resistances: [110, 115],
  bbUpper: 105,
  bbLower: 95,
  bbMid: 100,
  ema20Slope: 0,
  macdSignal: 0,
  obv: 0,
  obvSlope: 0,
  structure: "RANGE",
  volRegime: "NORMAL",
  high24h: 110,
  low24h: 90,
  rangePos: 0.5,
};

const baseInput: ConfluenceInput = { snap: baseSnap };

describe("confluence", () => {
  it("returns a valid confluence result shape", () => {
    const c = computeConfluence(baseInput);
    expect(c).toBeDefined();
    expect(typeof c.score).toBe("number");
    expect(["bullish", "bearish", "neutral"]).toContain(c.tone);
    expect(typeof c.confidence).toBe("number");
    expect(c.confidence).toBeGreaterThanOrEqual(0);
    expect(c.confidence).toBeLessThanOrEqual(100);
    expect(c.factors.length).toBeGreaterThan(0);
  });

  it("score is bounded [0, 100]", () => {
    const c = computeConfluence(baseInput);
    expect(c.score).toBeGreaterThanOrEqual(0);
    expect(c.score).toBeLessThanOrEqual(100);
  });

  it("bullish inputs produce a bullish or neutral tone", () => {
    const c = computeConfluence({
      snap: {
        ...baseSnap,
        rsi: 65,
        ema20: 110,
        ema50: 100,
        ema200: 100,
        ema20Slope: 0.5,
        macd: 1,
        macdHist: 0.5,
        macdSignal: 0.5,
        adx: 40,
        plusDI: 40,
        minusDI: 15,
        stochK: 80,
        stochD: 70,
        vwap: 99,
        price: 110,
        structure: "UP",
      },
    });
    expect(["bullish", "neutral"]).toContain(c.tone);
  });

  it("categoryScore returns valid scores for every category", () => {
    const c = computeConfluence(baseInput);
    const allScores = CONFLUENCE_CATEGORIES.map((cat) => categoryScore(c, cat));
    expect(allScores.length).toBe(CONFLUENCE_CATEGORIES.length);
    for (const s of allScores) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });

  it("categoryLabel returns a non-empty string for every category", () => {
    for (const cat of CONFLUENCE_CATEGORIES) {
      const label = categoryLabel(cat);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("CONFLUENCE_CATEGORIES contains the expected core categories", () => {
    expect(CONFLUENCE_CATEGORIES).toContain("trend");
    expect(CONFLUENCE_CATEGORIES).toContain("momentum");
    expect(CONFLUENCE_CATEGORIES).toContain("volatility");
  });
});

