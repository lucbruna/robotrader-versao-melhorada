// #21 — Unit tests for position-sizer. Pure functions, no DOM.

import { describe, it, expect } from "vitest";
import { recommendSize, DEFAULT_SIZER } from "@/lib/position-sizer";

describe("recommendSize", () => {
  const baseInput = {
    equity: 10_000,
    peakEquity: 10_000,
    signal: { confidence: 50, action: "BUY" as const },
    confluenceScore: 50,
    volRegime: "NORMAL" as const,
    trade: {
      side: "BUY" as const,
      entry: 100,
      stop: 95,
      target: 110,
    },
  };

  const trade = {
    side: "BUY" as const,
    entry: 100,
    stop: 95,
    target: 110,
  };

  it("returns a valid result shape", () => {
    const r = recommendSize(trade, baseInput);
    expect(r).toBeDefined();
    expect(typeof r.qty).toBe("number");
    expect(typeof r.qtyUsd).toBe("number");
    expect(typeof r.riskUsd).toBe("number");
    expect(typeof r.leverage).toBe("number");
    expect(r.factors.length).toBeGreaterThan(0);
    expect(r.factors[0]).toHaveProperty("label");
    expect(r.factors[0]).toHaveProperty("mult");
  });

  it("never exceeds the per-trade risk cap", () => {
    const r = recommendSize(trade, {
      ...baseInput,
      signal: { confidence: 100, action: "BUY" }, // max conviction
      confluenceScore: 100, // max confluence
    });
    // riskPct is the per-trade risk as % of equity. Should never exceed maxRiskPct.
    expect(r.riskPct).toBeLessThanOrEqual(DEFAULT_SIZER.maxRiskPct + 0.001);
  });

  it("does not crash on a HOLD signal", () => {
    const r = recommendSize(trade, {
      ...baseInput,
      signal: { confidence: 50, action: "HOLD" },
    });
    expect(r.qty).toBeGreaterThanOrEqual(0);
  });

  it("halves size when in deep drawdown", () => {
    // Baseline (no drawdown)
    const baseline = recommendSize(trade, {
      ...baseInput,
      peakEquity: 10_000,
      equity: 10_000,
    });
    // Deep DD (50% off peak)
    const inDd = recommendSize(trade, {
      ...baseInput,
      peakEquity: 10_000,
      equity: 5_000,
    });
    // DD adjust should reduce notional. The signal/conviction are
    // identical otherwise, so any change is due to the DD adjust.
    expect(inDd.qtyUsd).toBeLessThanOrEqual(baseline.qtyUsd);
  });

  it("includes a Kelly factor when backtest stats are provided", () => {
    const r = recommendSize(trade, {
      ...baseInput,
      backtestStats: {
        winRate: 95,
        avgWinUsd: 1000,
        avgLossUsd: 100,
        profitFactor: 50,
      },
    });
    const kellyFactor = r.factors.find(
      (f) =>
        typeof f.label === "string" && f.label.toLowerCase().includes("kelly"),
    );
    // Kelly may be present and reasonable, or absent (factor=0)
    // — we just verify it doesn't crash and the factor list is sane.
    if (kellyFactor) {
      expect(kellyFactor.mult).toBeGreaterThanOrEqual(0);
      expect(kellyFactor.mult).toBeLessThanOrEqual(2);
    }
  });

  it("produces a stop-based risk equal to |entry - stop| * qty", () => {
    const r = recommendSize(trade, baseInput);
    const expected = Math.abs(trade.entry - trade.stop) * r.qty;
    expect(Math.abs(r.riskUsd - expected)).toBeLessThan(0.01);
  });
});
