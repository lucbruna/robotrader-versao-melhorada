// Performance metrics for closed paper trades.
// All functions are pure and side-effect free.

export type ClosedTrade = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  entry: number;
  exit: number;
  qty: number;
  pnl: number; // signed USD
  openedAt: number;
  closedAt: number;
  reason?: string;
};

export type Metrics = {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number; // 0..100
  totalPnl: number;
  avgWin: number;
  avgLoss: number; // negative
  profitFactor: number; // |sum wins| / |sum losses| (Inf if no losses)
  payoffRatio: number; // |avg win| / |avg loss|
  expectancy: number; // avg pnl per trade
  maxDrawdown: number; // max peak-to-trough drop in USD
  maxDrawdownPct: number; // 0..100
  sharpe: number; // annualized (252), assumes 1 trade = 1 period
  bestTrade: number;
  worstTrade: number;
  currentStreak: number; // signed: + wins, - losses
  longestWinStreak: number;
  longestLoseStreak: number;
  avgTradeDurationMs: number;
  bySymbol: Record<string, { trades: number; pnl: number; winRate: number }>;
  byReason: Record<string, { trades: number; pnl: number }>;
};

export function emptyMetrics(): Metrics {
  return {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    totalPnl: 0,
    avgWin: 0,
    avgLoss: 0,
    profitFactor: 0,
    payoffRatio: 0,
    expectancy: 0,
    maxDrawdown: 0,
    maxDrawdownPct: 0,
    sharpe: 0,
    bestTrade: 0,
    worstTrade: 0,
    currentStreak: 0,
    longestWinStreak: 0,
    longestLoseStreak: 0,
    avgTradeDurationMs: 0,
    bySymbol: {},
    byReason: {},
  };
}

export function computeMetrics(
  trades: ClosedTrade[],
  initialEquity: number,
): Metrics {
  if (trades.length === 0) return emptyMetrics();
  const m = emptyMetrics();
  m.totalTrades = trades.length;

  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  const winsArr: number[] = [];
  const lossesArr: number[] = [];
  let equity = initialEquity;
  let peak = initialEquity;
  let maxDd = 0;
  let maxDdPct = 0;
  let curStreak = 0;
  let curSign = 0;
  let longestWin = 0;
  let longestLose = 0;
  let totalDuration = 0;
  const returns: number[] = [];

  for (const t of sorted) {
    m.totalPnl += t.pnl;
    if (t.pnl > 0) {
      m.wins++;
      winsArr.push(t.pnl);
      if (curSign > 0) curStreak++;
      else {
        curStreak = 1;
        curSign = 1;
      }
      longestWin = Math.max(longestWin, curStreak);
    } else if (t.pnl < 0) {
      m.losses++;
      lossesArr.push(t.pnl);
      if (curSign < 0) curStreak++;
      else {
        curStreak = 1;
        curSign = -1;
      }
      longestLose = Math.max(longestLose, curStreak);
    }
    m.bestTrade = Math.max(m.bestTrade, t.pnl);
    m.worstTrade = Math.min(m.worstTrade, t.pnl);
    totalDuration += t.closedAt - t.openedAt;

    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDd) maxDd = dd;
    if (peak > 0) {
      const ddPct = (dd / peak) * 100;
      if (ddPct > maxDdPct) maxDdPct = ddPct;
    }
    returns.push(t.pnl / Math.max(equity - t.pnl, 1));

    // bySymbol
    const sym = m.bySymbol[t.symbol] ?? { trades: 0, pnl: 0, winRate: 0 };
    sym.trades++;
    sym.pnl += t.pnl;
    m.bySymbol[t.symbol] = sym;

    // byReason
    const reason = t.reason ?? "Unknown";
    const rs = m.byReason[reason] ?? { trades: 0, pnl: 0 };
    rs.trades++;
    rs.pnl += t.pnl;
    m.byReason[reason] = rs;
  }

  m.winRate = (m.wins / m.totalTrades) * 100;
  m.avgWin = winsArr.length
    ? winsArr.reduce((s, v) => s + v, 0) / winsArr.length
    : 0;
  m.avgLoss = lossesArr.length
    ? lossesArr.reduce((s, v) => s + v, 0) / lossesArr.length
    : 0;
  const sumWins = winsArr.reduce((s, v) => s + v, 0);
  const sumLosses = Math.abs(lossesArr.reduce((s, v) => s + v, 0));
  m.profitFactor =
    sumLosses > 0 ? sumWins / sumLosses : sumWins > 0 ? Infinity : 0;
  m.payoffRatio = Math.abs(m.avgLoss) > 0 ? m.avgWin / Math.abs(m.avgLoss) : 0;
  m.expectancy = m.totalPnl / m.totalTrades;
  m.maxDrawdown = maxDd;
  m.maxDrawdownPct = maxDdPct;
  m.currentStreak = curSign > 0 ? curStreak : -curStreak;
  m.longestWinStreak = longestWin;
  m.longestLoseStreak = longestLose;
  m.avgTradeDurationMs = totalDuration / m.totalTrades;

  // Sharpe — assume 252 trading days, 1 trade = 1 sample
  if (returns.length > 1) {
    const mean = returns.reduce((s, v) => s + v, 0) / returns.length;
    const variance =
      returns.reduce((s, v) => s + (v - mean) ** 2, 0) / (returns.length - 1);
    const sd = Math.sqrt(variance);
    m.sharpe = sd > 0 ? (mean / sd) * Math.sqrt(252) : 0;
  }

  // bySymbol winRate
  for (const sym of Object.keys(m.bySymbol)) {
    const symTrades = sorted.filter((t) => t.symbol === sym);
    const symWins = symTrades.filter((t) => t.pnl > 0).length;
    m.bySymbol[sym].winRate = (symWins / symTrades.length) * 100;
  }

  return m;
}

// Equity curve: array of { t, equity } for sparkline
export function equityCurve(
  trades: ClosedTrade[],
  initialEquity: number,
): { t: number; equity: number }[] {
  const sorted = [...trades].sort((a, b) => a.closedAt - b.closedAt);
  const out: { t: number; equity: number }[] = [];
  let eq = initialEquity;
  out.push({ t: 0, equity: eq });
  for (const t of sorted) {
    eq += t.pnl;
    out.push({ t: t.closedAt, equity: eq });
  }
  return out;
}

// Daily PnL aggregation (for daily loss limit)
export function dailyPnl(trades: ClosedTrade[], todayStart: number): number {
  return trades
    .filter((t) => t.closedAt >= todayStart)
    .reduce((s, t) => s + t.pnl, 0);
}
