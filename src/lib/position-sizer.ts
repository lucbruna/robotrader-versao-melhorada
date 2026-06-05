// Advanced position sizing — produces a recommended trade size that
// combines multiple risk-aware signals:
//
//   1. Base risk budget  — % of equity at risk per trade
//   2. Drawdown adjustment — shrink size linearly as account DD grows
//   3. Kelly fraction    — cap size at fractional-Kelly from observed edge
//   4. Conviction boost  — scale by signal confidence & confluence
//   5. Volatility regime — reduce size in HIGH/EXTREME volatility
//   6. Portfolio cap     — total open risk can't exceed portfolioRiskPct
//
// The output is a transparent breakdown so the user (and audit logs) can
// see exactly why a given size was chosen.

import type { LocalSignal } from "./indicators";
import type { BacktestStats } from "./backtest";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PositionSizerConfig = {
  /** Baseline risk per trade, % of equity. Default 1. */
  baseRiskPct: number;
  /** Hard floor — risk never drops below this. Default 0.25. */
  minRiskPct: number;
  /** Hard ceiling — risk never exceeds this. Default 3. */
  maxRiskPct: number;
  /** Kelly fraction. 0 = ignore Kelly. 1 = full Kelly. Default 0.25 (1/4 Kelly). */
  kellyFraction: number;
  /** Drawdown at which to halve the position. Default 15. */
  ddHalfSizePct: number;
  /** Drawdown at which to stop trading entirely. Default 30. */
  ddStopOutPct: number;
  /** Multiplier range from conviction (confidence 0..100 → 0.5..1.5). */
  convictionMinMult: number; // default 0.5
  convictionMaxMult: number; // default 1.5
  /** Max total open risk across all positions, % of equity. Default 6. */
  portfolioRiskPct: number;
  /** Volatility regime factor table. Default: LOW=1, NORMAL=1, HIGH=0.7, EXTREME=0.4. */
  volRegimeMult: Record<"LOW" | "NORMAL" | "HIGH" | "EXTREME", number>;
};

export const DEFAULT_SIZER: PositionSizerConfig = {
  baseRiskPct: 1.0,
  minRiskPct: 0.25,
  maxRiskPct: 3.0,
  kellyFraction: 0.25,
  ddHalfSizePct: 15,
  ddStopOutPct: 30,
  convictionMinMult: 0.5,
  convictionMaxMult: 1.5,
  portfolioRiskPct: 6.0,
  volRegimeMult: {
    LOW: 1.1,
    NORMAL: 1.0,
    HIGH: 0.7,
    EXTREME: 0.4,
  },
};

export type ProposedTrade = {
  side: "BUY" | "SELL";
  entry: number;
  stop: number;
  target: number;
  /** Optional: trade R:R (reward/risk). Computed from stop/target if absent. */
  rr?: number;
};

export type SizerInput = {
  equity: number;
  /** Current peak equity for DD calc. */
  peakEquity: number;
  /** Current signal (provides confidence). */
  signal?: Pick<LocalSignal, "confidence" | "action"> | null;
  /** Confluence score 0..100 (optional). */
  confluenceScore?: number | null;
  /** Current volatility regime from snapshot.volRegime. */
  volRegime: "LOW" | "NORMAL" | "HIGH" | "EXTREME";
  /** Backtest stats (optional, used to compute Kelly). */
  backtestStats?: Pick<
    BacktestStats,
    "winRate" | "avgWinUsd" | "avgLossUsd" | "profitFactor"
  > | null;
  /** Existing open positions to compute portfolio risk. */
  existingPositions?: Array<{ riskUsd: number }>;
};

export type SizerFactor = {
  label: string;
  /** Multiplier applied (1 = no change). */
  mult: number;
  /** Human-readable detail. */
  detail: string;
};

export type SizerResult = {
  /** Final risk in USD. */
  riskUsd: number;
  /** Final risk as % of equity. */
  riskPct: number;
  /** Position size in units of the symbol. */
  qty: number;
  /** Notional in USD. */
  qtyUsd: number;
  /** Stop distance in price units. */
  risk: number;
  /** Suggested leverage (entry × qty / equity). */
  leverage: number;
  /** Breakdown of how the size was determined. */
  factors: SizerFactor[];
  /** True if drawdown stopped out the trade. */
  stoppedByDD: boolean;
  /** True if portfolio risk cap would have been exceeded. */
  cappedByPortfolio: boolean;
  /** One-line rationale. */
  rationale: string;
};

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

export function recommendSize(
  trade: ProposedTrade,
  input: SizerInput,
  config: PositionSizerConfig = DEFAULT_SIZER,
): SizerResult {
  const risk = Math.abs(trade.entry - trade.stop);
  const factors: SizerFactor[] = [];
  let riskPct = config.baseRiskPct;
  let stoppedByDD = false;
  let cappedByPortfolio = false;

  if (risk <= 0) {
    return emptyResult(
      trade,
      input.equity,
      "stop coincide com entrada — sem risco",
    );
  }

  // 1) Drawdown adjustment
  const ddPct =
    input.peakEquity > 0
      ? Math.max(
          0,
          ((input.peakEquity - input.equity) / input.peakEquity) * 100,
        )
      : 0;
  if (ddPct >= config.ddStopOutPct) {
    riskPct = 0;
    stoppedByDD = true;
    factors.push({
      label: "Drawdown",
      mult: 0,
      detail: `DD ${ddPct.toFixed(1)}% ≥ ${config.ddStopOutPct}% → bloqueado`,
    });
  } else if (ddPct > 0) {
    // Linear scale from 1.0 (no DD) down to 0.5 (at ddHalfSizePct)
    const ddMult = clamp(1 - 0.5 * (ddPct / config.ddHalfSizePct), 0.25, 1.0);
    riskPct *= ddMult;
    factors.push({
      label: "Drawdown",
      mult: ddMult,
      detail: `DD ${ddPct.toFixed(1)}% → ${(ddMult * 100).toFixed(0)}% do base`,
    });
  } else {
    factors.push({
      label: "Drawdown",
      mult: 1,
      detail: "sem drawdown",
    });
  }

  // 2) Kelly fraction (cap, not multiply)
  if (input.backtestStats && config.kellyFraction > 0) {
    const stats = input.backtestStats;
    const winRate = stats.winRate;
    const avgWin = Math.abs(stats.avgWinUsd);
    const avgLoss = Math.abs(stats.avgLossUsd);
    if (avgLoss > 0 && winRate > 0 && winRate < 1) {
      // Kelly % = W - (1-W)/R  where R = avgWin/avgLoss
      const payoff = avgWin / avgLoss;
      const kellyPctRaw = (winRate - (1 - winRate) / payoff) * 100;
      const kellyPct = Math.max(0, kellyPctRaw * config.kellyFraction);
      if (kellyPct > 0 && kellyPct < riskPct) {
        factors.push({
          label: "Kelly",
          mult: kellyPct / riskPct,
          detail: `Kelly ${kellyPctRaw.toFixed(2)}% × ${config.kellyFraction} = ${kellyPct.toFixed(2)}%`,
        });
        riskPct = kellyPct;
      } else if (kellyPct > 0) {
        factors.push({
          label: "Kelly",
          mult: 1,
          detail: `Kelly ${kellyPct.toFixed(2)}% ≥ base — sem efeito`,
        });
      }
    }
  }

  // 3) Conviction boost
  if (input.signal) {
    const conf = clamp(input.signal.confidence, 0, 100);
    const t = conf / 100;
    const convMult =
      config.convictionMinMult +
      (config.convictionMaxMult - config.convictionMinMult) * t;
    riskPct *= convMult;
    factors.push({
      label: "Convicção",
      mult: convMult,
      detail: `conf ${conf.toFixed(0)}% → ${convMult.toFixed(2)}×`,
    });
  } else {
    factors.push({
      label: "Convicção",
      mult: 1,
      detail: "sem sinal",
    });
  }

  // 4) Volatility regime
  const volMult = config.volRegimeMult[input.volRegime] ?? 1;
  riskPct *= volMult;
  factors.push({
    label: "Volatilidade",
    mult: volMult,
    detail: `regime ${input.volRegime}`,
  });

  // 5) Clamp to [minRiskPct, maxRiskPct]
  const clamped = clamp(riskPct, config.minRiskPct, config.maxRiskPct);
  if (clamped !== riskPct) {
    factors.push({
      label: "Clamp",
      mult: clamped / riskPct,
      detail: `limitado a [${config.minRiskPct}, ${config.maxRiskPct}]%`,
    });
  }
  riskPct = clamped;

  // 6) Portfolio risk cap
  const existingRisk = (input.existingPositions ?? []).reduce(
    (s, p) => s + p.riskUsd,
    0,
  );
  const existingRiskPct =
    input.equity > 0 ? (existingRisk / input.equity) * 100 : 0;
  const remainingRiskPct = Math.max(
    0,
    config.portfolioRiskPct - existingRiskPct,
  );
  if (riskPct > remainingRiskPct) {
    factors.push({
      label: "Portfolio",
      mult: remainingRiskPct / riskPct,
      detail: `livre ${remainingRiskPct.toFixed(2)}% (cap ${config.portfolioRiskPct}%)`,
    });
    riskPct = remainingRiskPct;
    cappedByPortfolio = true;
  } else {
    factors.push({
      label: "Portfolio",
      mult: 1,
      detail: `${existingRiskPct.toFixed(2)}% usado de ${config.portfolioRiskPct}%`,
    });
  }

  // Final values
  const riskUsd = input.equity * (riskPct / 100);
  const qty = riskUsd / risk;
  const qtyUsd = qty * trade.entry;
  const leverage = input.equity > 0 ? qtyUsd / input.equity : 0;

  // Rationale
  const topFactor = factors
    .filter((f) => f.mult !== 1)
    .sort((a, b) => Math.abs(Math.log(b.mult)) - Math.abs(Math.log(a.mult)))[0];
  const rationale = stoppedByDD
    ? "Bloqueado por drawdown excessivo"
    : topFactor
      ? `${topFactor.label}: ${topFactor.detail}`
      : "Tamanho base sem ajustes";

  return {
    riskUsd,
    riskPct,
    qty,
    qtyUsd,
    risk,
    leverage,
    factors,
    stoppedByDD,
    cappedByPortfolio,
    rationale,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function emptyResult(
  trade: ProposedTrade,
  equity: number,
  reason: string,
): SizerResult {
  return {
    riskUsd: 0,
    riskPct: 0,
    qty: 0,
    qtyUsd: 0,
    risk: Math.abs(trade.entry - trade.stop),
    leverage: 0,
    factors: [{ label: "Inválido", mult: 0, detail: reason }],
    stoppedByDD: false,
    cappedByPortfolio: false,
    rationale: reason,
  };
}
