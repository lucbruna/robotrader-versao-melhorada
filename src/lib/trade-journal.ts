// Trade journal — persistent log of executed trades (live paper + manual
// entries). Storage is localStorage with versioned key so schema upgrades
// can migrate or wipe cleanly.
//
// Each trade captures: entry/exit times & prices, side, qty, P&L, R-multiple,
// source (live signal, backtest import, manual), and a snapshot of the
// decision context (confidence, confluence score, regime, score).
//
// Analytics are pure: derive daily/calendar aggregates from the log on
// demand. The user can export the entire journal as CSV for tax records.

import type { Regime } from "./regime";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type JournalTrade = {
  id: string; // uuid
  symbol: string;
  side: "BUY" | "SELL";
  entryTime: number; // ms epoch
  exitTime: number | null;
  entryPrice: number;
  exitPrice: number | null;
  qty: number;
  stop: number;
  target: number;
  pnlUsd: number;
  pnlR: number; // in R multiples
  fees: number;
  /** Origin of the trade. */
  source: "live" | "backtest" | "manual";
  /** Free-form notes. */
  notes: string;
  /** Decision context (all optional). */
  confidence: number | null;
  confluence: number | null;
  regime: Regime | null;
  score: number | null;
  /** Exit reason if closed. */
  exitReason: "TP" | "SL" | "TRAIL" | "MANUAL" | "REVERSAL" | null;
};

export type JournalStats = {
  total: number;
  open: number;
  closed: number;
  winners: number;
  losers: number;
  winRate: number;
  totalPnlUsd: number;
  totalPnlPct: number;
  avgPnlUsd: number;
  avgR: number;
  profitFactor: number;
  bestTradeUsd: number;
  worstTradeUsd: number;
  /** P&L per day for the last 365 days. */
  dailyPnl: Array<{ date: string; pnl: number; trades: number }>;
  /** Per-symbol totals. */
  bySymbol: Array<{
    symbol: string;
    trades: number;
    pnl: number;
    winRate: number;
  }>;
};

export type JournalFilter = {
  symbol?: string;
  fromTime?: number;
  toTime?: number;
  side?: "BUY" | "SELL";
  source?: JournalTrade["source"];
  openOnly?: boolean;
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const STORAGE_KEY = "robotrader.journal.v1";
const SCHEMA_VERSION = 1;

type Stored = { version: number; trades: JournalTrade[] };

function read(): Stored {
  if (typeof window === "undefined" || !window.localStorage) {
    return { version: SCHEMA_VERSION, trades: [] };
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: SCHEMA_VERSION, trades: [] };
    const parsed = JSON.parse(raw) as Stored;
    if (parsed.version !== SCHEMA_VERSION) {
      // Future schema migration goes here
      return { version: SCHEMA_VERSION, trades: [] };
    }
    if (!Array.isArray(parsed.trades)) {
      return { version: SCHEMA_VERSION, trades: [] };
    }
    return parsed;
  } catch {
    return { version: SCHEMA_VERSION, trades: [] };
  }
}

function write(state: Stored): void {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function getAllTrades(): JournalTrade[] {
  return read().trades;
}

export function addTrade(t: Omit<JournalTrade, "id">): JournalTrade {
  const state = read();
  const trade: JournalTrade = { ...t, id: makeId() };
  state.trades.unshift(trade);
  write(state);
  return trade;
}

export function updateTrade(
  id: string,
  patch: Partial<Omit<JournalTrade, "id">>,
): JournalTrade | null {
  const state = read();
  const idx = state.trades.findIndex((t) => t.id === id);
  if (idx < 0) return null;
  state.trades[idx] = { ...state.trades[idx], ...patch };
  write(state);
  return state.trades[idx];
}

export function deleteTrade(id: string): boolean {
  const state = read();
  const before = state.trades.length;
  state.trades = state.trades.filter((t) => t.id !== id);
  if (state.trades.length === before) return false;
  write(state);
  return true;
}

export function clearAll(): void {
  write({ version: SCHEMA_VERSION, trades: [] });
}

export function filterTrades(f: JournalFilter): JournalTrade[] {
  return getAllTrades().filter((t) => {
    if (f.symbol && t.symbol !== f.symbol) return false;
    if (f.fromTime && t.entryTime < f.fromTime) return false;
    if (f.toTime && t.entryTime > f.toTime) return false;
    if (f.side && t.side !== f.side) return false;
    if (f.source && t.source !== f.source) return false;
    if (f.openOnly && t.exitTime !== null) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

export function exportCsv(trades?: JournalTrade[]): string {
  const rows = trades ?? getAllTrades();
  const headers = [
    "id",
    "symbol",
    "side",
    "entryTime",
    "exitTime",
    "entryPrice",
    "exitPrice",
    "qty",
    "stop",
    "target",
    "pnlUsd",
    "pnlR",
    "fees",
    "source",
    "exitReason",
    "confidence",
    "confluence",
    "regime",
    "score",
    "notes",
  ];
  const lines = [headers.join(",")];
  for (const t of rows) {
    lines.push(
      [
        t.id,
        t.symbol,
        t.side,
        new Date(t.entryTime).toISOString(),
        t.exitTime ? new Date(t.exitTime).toISOString() : "",
        t.entryPrice,
        t.exitPrice ?? "",
        t.qty,
        t.stop,
        t.target,
        t.pnlUsd.toFixed(4),
        t.pnlR.toFixed(4),
        t.fees.toFixed(4),
        t.source,
        t.exitReason ?? "",
        t.confidence ?? "",
        t.confluence ?? "",
        t.regime ?? "",
        t.score ?? "",
        `"${(t.notes ?? "").replace(/"/g, '""')}"`,
      ].join(","),
    );
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export function journalStats(
  trades: JournalTrade[] = getAllTrades(),
  opts: { initialEquity?: number; days?: number } = {},
): JournalStats {
  const initialEquity = opts.initialEquity ?? 10_000;
  const days = opts.days ?? 365;
  const closed = trades.filter((t) => t.exitTime !== null);
  const open = trades.filter((t) => t.exitTime === null);
  const winners = closed.filter((t) => t.pnlUsd > 0);
  const losers = closed.filter((t) => t.pnlUsd <= 0);
  const totalPnlUsd = closed.reduce((s, t) => s + t.pnlUsd, 0);
  const winRate = closed.length > 0 ? winners.length / closed.length : 0;
  const sumWins = winners.reduce((s, t) => s + t.pnlUsd, 0);
  const sumLosses = losers.reduce((s, t) => s + t.pnlUsd, 0);
  const profitFactor =
    sumLosses < 0 ? sumWins / Math.abs(sumLosses) : sumWins > 0 ? Infinity : 0;
  const bestTradeUsd = closed.reduce(
    (m, t) => Math.max(m, t.pnlUsd),
    -Infinity,
  );
  const worstTradeUsd = closed.reduce(
    (m, t) => Math.min(m, t.pnlUsd),
    Infinity,
  );

  // Daily P&L for last N days
  const dailyPnl: JournalStats["dailyPnl"] = [];
  const today = startOfDay(Date.now());
  for (let d = days - 1; d >= 0; d--) {
    const dayStart = today - d * 86_400_000;
    const dayEnd = dayStart + 86_400_000;
    const dayTrades = closed.filter(
      (t) =>
        t.exitTime !== null && t.exitTime >= dayStart && t.exitTime < dayEnd,
    );
    const pnl = dayTrades.reduce((s, t) => s + t.pnlUsd, 0);
    dailyPnl.push({
      date: new Date(dayStart).toISOString().slice(0, 10),
      pnl,
      trades: dayTrades.length,
    });
  }

  // Per-symbol
  const bySymbolMap = new Map<
    string,
    { trades: number; pnl: number; wins: number }
  >();
  for (const t of closed) {
    const cur = bySymbolMap.get(t.symbol) ?? { trades: 0, pnl: 0, wins: 0 };
    cur.trades++;
    cur.pnl += t.pnlUsd;
    if (t.pnlUsd > 0) cur.wins++;
    bySymbolMap.set(t.symbol, cur);
  }
  const bySymbol = Array.from(bySymbolMap.entries())
    .map(([symbol, v]) => ({
      symbol,
      trades: v.trades,
      pnl: v.pnl,
      winRate: v.trades > 0 ? v.wins / v.trades : 0,
    }))
    .sort((a, b) => b.pnl - a.pnl);

  return {
    total: trades.length,
    open: open.length,
    closed: closed.length,
    winners: winners.length,
    losers: losers.length,
    winRate,
    totalPnlUsd,
    totalPnlPct: (totalPnlUsd / initialEquity) * 100,
    avgPnlUsd: closed.length > 0 ? totalPnlUsd / closed.length : 0,
    avgR:
      closed.length > 0
        ? closed.reduce((s, t) => s + t.pnlR, 0) / closed.length
        : 0,
    profitFactor,
    bestTradeUsd: isFinite(bestTradeUsd) ? bestTradeUsd : 0,
    worstTradeUsd: isFinite(worstTradeUsd) ? worstTradeUsd : 0,
    dailyPnl,
    bySymbol,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return (crypto as Crypto).randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
