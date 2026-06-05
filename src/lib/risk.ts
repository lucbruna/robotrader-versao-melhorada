// Centralized risk engine: position sizing, stop/TP calculations, exposure guard.
// All math is pure so it can be unit-tested without React.

import type { Candle, IndicatorSnapshot } from "./indicators";
import { atr as atrFn, bollinger } from "./indicators";

export type Side = "BUY" | "SELL";

export type RiskSettings = {
  riskPerTradePct: number; // % of equity to risk per trade (e.g. 1 = 1%)
  maxPositions: number; // max concurrent open positions across all symbols
  maxDailyLossPct: number; // % of equity — kill switch if daily PnL <= -X
  maxDrawdownPct: number; // % of initial equity — kill switch
  atrMultiplierSL: number; // stop distance = k * ATR (e.g. 1.5)
  atrMultiplierTP: number; // TP distance = k * ATR (e.g. 2.5) — default R:R 1:1.67
  trailingActivationRR: number; // move SL to BE after R-multiple reached (e.g. 1.0)
  trailingDistanceATR: number; // trail by k * ATR (e.g. 1.0)
  breakevenAfterRR: number; // SL -> entry after this R-multiple (e.g. 0.5)
  feePct: number; // round-trip fee/slippage estimate (e.g. 0.1 = 0.1%)
  minRR: number; // minimum R:R to consider a trade (e.g. 1.2)
  cooldownMs: number; // minimum seconds between trades on same symbol
};

export const DEFAULT_RISK: RiskSettings = {
  riskPerTradePct: 1,
  maxPositions: 3,
  maxDailyLossPct: 5,
  maxDrawdownPct: 20,
  atrMultiplierSL: 1.5,
  atrMultiplierTP: 2.5,
  trailingActivationRR: 1.5,
  trailingDistanceATR: 1.0,
  breakevenAfterRR: 0.8,
  feePct: 0.1,
  minRR: 1.3,
  cooldownMs: 60_000,
};

export type StopPlan = {
  stop: number;
  target: number;
  risk: number; // abs distance entry - stop
  reward: number; // abs distance target - entry
  rr: number; // reward / risk
  qty: number; // suggested position size in units of symbol
  qtyUsd: number; // notional USD
  riskUsd: number; // amount at risk in USD
  reason: string;
};

// Compute a stop/TP plan for a new trade.
// Priority: AI-provided levels > ATR-based > Bollinger-based > % fallback.
export function planTrade(args: {
  side: Side;
  entry: number;
  snapshot: IndicatorSnapshot;
  equity: number;
  settings: RiskSettings;
  aiStop?: number;
  aiTP?: number;
  aiConfidence?: number;
}): StopPlan {
  const {
    side,
    entry,
    snapshot: s,
    equity,
    settings,
    aiStop,
    aiTP,
    aiConfidence,
  } = args;

  // 1) Base stop distance from ATR (volatility-aware)
  let stopDist =
    s.atr !== null && s.atr > 0
      ? s.atr * settings.atrMultiplierSL
      : entry * 0.02; // 2% fallback

  // 2) Stop placement: AI > structure-aware > flat %
  let stop: number;
  if (aiStop && aiStop > 0) {
    // Use AI stop but ensure minimum distance
    const dist = Math.abs(entry - aiStop);
    if (dist >= stopDist * 0.5) {
      stopDist = dist;
      stop = aiStop;
    } else {
      stop = side === "BUY" ? entry - stopDist : entry + stopDist;
    }
  } else if (side === "BUY" && s.supports.length > 0) {
    // Place stop just below nearest support
    const nearest = s.supports[0];
    const candidate = nearest * 0.998;
    const dist = entry - candidate;
    if (dist > stopDist * 0.5 && dist < stopDist * 3) {
      stop = candidate;
      stopDist = dist;
    } else {
      stop = entry - stopDist;
    }
  } else if (side === "SELL" && s.resistances.length > 0) {
    const nearest = s.resistances[0];
    const candidate = nearest * 1.002;
    const dist = candidate - entry;
    if (dist > stopDist * 0.5 && dist < stopDist * 3) {
      stop = candidate;
      stopDist = dist;
    } else {
      stop = entry + stopDist;
    }
  } else {
    stop = side === "BUY" ? entry - stopDist : entry + stopDist;
  }

  // 3) TP: AI > ATR > symmetric
  let target: number;
  if (aiTP && aiTP > 0) {
    target = aiTP;
  } else {
    const tpDist = stopDist * settings.atrMultiplierTP;
    target = side === "BUY" ? entry + tpDist : entry - tpDist;
  }
  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  const rr = risk > 0 ? reward / risk : 0;

  // 4) Position sizing — risk-based
  const riskUsd = (equity * settings.riskPerTradePct) / 100;
  // Volatility adjustment: reduce size in extreme vol
  const volFactor =
    s.volRegime === "EXTREME"
      ? 0.5
      : s.volRegime === "HIGH"
        ? 0.75
        : s.volRegime === "LOW"
          ? 1.1
          : 1.0;
  // Confidence adjustment: if AI is highly confident, allow up to 1.2x
  const confFactor =
    aiConfidence !== undefined ? 0.7 + Math.min(aiConfidence, 100) / 250 : 1.0;
  const adjustedRisk = riskUsd * volFactor * confFactor;
  const qty = risk > 0 ? adjustedRisk / risk : 0;
  const qtyUsd = qty * entry;

  const reason = `SL ${stop.toFixed(2)} (${settings.atrMultiplierSL}×ATR), TP ${target.toFixed(2)} (RR ${rr.toFixed(2)})`;

  return {
    stop,
    target,
    risk,
    reward,
    rr,
    qty,
    qtyUsd,
    riskUsd: adjustedRisk,
    reason,
  };
}

// Check if a new trade is allowed by exposure / drawdown guard
export function canOpenTrade(args: {
  openPositions: number;
  settings: RiskSettings;
  equity: number;
  initialEquity: number;
  dailyPnl: number; // signed USD
  lastTradeAt: number;
  symbol: string;
  lastTradeBySymbol: Record<string, number>;
  killSwitch?: boolean; // manual kill
}): { allowed: boolean; reason?: string } {
  const {
    openPositions,
    settings,
    equity,
    initialEquity,
    dailyPnl,
    lastTradeAt,
    symbol,
    lastTradeBySymbol,
    killSwitch,
  } = args;

  if (killSwitch) return { allowed: false, reason: "Kill switch ativado" };
  if (openPositions >= settings.maxPositions) {
    return {
      allowed: false,
      reason: `Máx ${settings.maxPositions} posições abertas`,
    };
  }
  const drawdown = ((equity - initialEquity) / initialEquity) * 100;
  if (drawdown <= -settings.maxDrawdownPct) {
    return {
      allowed: false,
      reason: `Drawdown máximo atingido (${drawdown.toFixed(1)}%)`,
    };
  }
  const dailyPct = initialEquity > 0 ? (dailyPnl / initialEquity) * 100 : 0;
  if (dailyPct <= -settings.maxDailyLossPct) {
    return {
      allowed: false,
      reason: `Perda diária máxima atingida (${dailyPct.toFixed(1)}%)`,
    };
  }
  const now = Date.now();
  const lastForSymbol = lastTradeBySymbol[symbol] ?? 0;
  if (now - lastForSymbol < settings.cooldownMs) {
    return {
      allowed: false,
      reason: `Cooldown ativo (${Math.round((settings.cooldownMs - (now - lastForSymbol)) / 1000)}s)`,
    };
  }
  if (now - lastTradeAt < 5_000) {
    return { allowed: false, reason: "Cooldown global" };
  }
  return { allowed: true };
}

// Update a position's stop/TP based on current price and trailing rules
// Returns the new effective stop (may have been moved to breakeven or trailed)
export function updateStops(args: {
  side: Side;
  entry: number;
  initialStop: number;
  initialTP: number;
  currentPrice: number;
  atr: number | null;
  highWaterMark: number; // best price since entry (for BUY: highest, SELL: lowest)
  settings: RiskSettings;
}): { stop: number; target: number; reason: string } {
  const {
    side,
    entry,
    initialStop,
    initialTP,
    currentPrice,
    atr,
    highWaterMark,
    settings,
  } = args;
  let stop = initialStop;
  let reason = "Estático";
  const target = initialTP;

  const risk = Math.abs(entry - initialStop);
  if (risk <= 0) return { stop, target, reason };

  const atrDist = atr !== null && atr > 0 ? atr : risk * 0.5;
  const moveFromEntry =
    side === "BUY" ? currentPrice - entry : entry - currentPrice;
  const rMultiple = moveFromEntry / risk;

  // Move to breakeven after threshold
  if (rMultiple >= settings.breakevenAfterRR) {
    const beStop = side === "BUY" ? entry * 1.0005 : entry * 0.9995; // small profit to cover fees
    if (side === "BUY" && beStop > stop) {
      stop = beStop;
      reason = "Breakeven";
    } else if (side === "SELL" && beStop < stop) {
      stop = beStop;
      reason = "Breakeven";
    }
  }

  // Trailing stop after activation
  if (rMultiple >= settings.trailingActivationRR && atr !== null) {
    const trailDist = atrDist * settings.trailingDistanceATR;
    if (side === "BUY") {
      const newStop = highWaterMark - trailDist;
      if (newStop > stop) {
        stop = newStop;
        reason = `Trailing +${(newStop - initialStop).toFixed(2)}`;
      }
    } else {
      const newStop = highWaterMark + trailDist;
      if (newStop < stop) {
        stop = newStop;
        reason = `Trailing -${(initialStop - newStop).toFixed(2)}`;
      }
    }
  }

  return { stop, target, reason };
}

// Estimate net PnL after fees (paper-trade)
export function netPnl(args: {
  entry: number;
  exit: number;
  qty: number;
  side: Side;
  feePct: number;
}): number {
  const { entry, exit, qty, side, feePct } = args;
  const gross = (exit - entry) * qty * (side === "BUY" ? 1 : -1);
  const feeCost = (entry * qty + exit * qty) * (feePct / 100);
  return gross - feeCost;
}

// ATR from raw candles (utility export so callers don't import indicators twice)
export function computeAtr(candles: Candle[], period = 14): (number | null)[] {
  return atrFn(candles, period);
}

// Volatility-adjusted take profit (used by bot when AI doesn't supply one)
export function volatilityTarget(args: {
  side: Side;
  entry: number;
  atr: number;
  multiplier: number;
  bb?: { upper: number | null; lower: number | null };
}): number {
  const dist = args.atr * args.multiplier;
  const base = args.side === "BUY" ? args.entry + dist : args.entry - dist;
  if (args.bb) {
    if (args.side === "BUY" && args.bb.upper && args.bb.upper > args.entry) {
      return Math.min(base, args.bb.upper * 0.998);
    }
    if (args.side === "SELL" && args.bb.lower && args.bb.lower < args.entry) {
      return Math.max(base, args.bb.lower * 1.002);
    }
  }
  return base;
}

// Helper: re-export for convenience
export { bollinger };
