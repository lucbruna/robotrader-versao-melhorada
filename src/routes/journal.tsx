import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookText,
  Download,
  Trash2,
  Plus,
  X,
  TrendingUp,
  TrendingDown,
  Target,
  Activity,
  Calendar,
  Filter,
  ChevronUp,
  ChevronDown,
  NotebookPen,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DEFAULT_SYMBOLS } from "@/lib/binance";
import {
  addTrade,
  clearAll,
  deleteTrade,
  exportCsv,
  filterTrades,
  getAllTrades,
  journalStats,
  updateTrade,
  type JournalFilter,
  type JournalTrade,
  type JournalStats,
} from "@/lib/trade-journal";
import type { Regime } from "@/lib/regime";

export const Route = createFileRoute("/journal")({
  component: JournalPage,
});

function JournalPage() {
  const [trades, setTrades] = useState<JournalTrade[]>([]);
  const [filter, setFilter] = useState<JournalFilter>({});
  const [editing, setEditing] = useState<JournalTrade | null>(null);
  const [adding, setAdding] = useState(false);
  const [sortKey, setSortKey] = useState<
    "entryTime" | "pnlUsd" | "pnlR" | "symbol"
  >("entryTime");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [initialEquity, setInitialEquity] = useState(10_000);

  function reload() {
    setTrades(getAllTrades());
  }

  useEffect(() => {
    reload();
  }, []);

  const filtered = useMemo(() => {
    // Use the in-memory `trades` list rather than re-reading storage so this
    // memo depends only on inputs we control.
    const rows = trades.filter((t) => {
      if (filter.symbol && t.symbol !== filter.symbol) return false;
      if (filter.fromTime && t.entryTime < filter.fromTime) return false;
      if (filter.toTime && t.entryTime > filter.toTime) return false;
      if (filter.side && t.side !== filter.side) return false;
      if (filter.source && t.source !== filter.source) return false;
      if (filter.openOnly && t.exitTime !== null) return false;
      return true;
    });
    rows.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return rows;
  }, [trades, filter, sortKey, sortDir]);

  const stats: JournalStats = useMemo(
    () => journalStats(trades, { initialEquity }),
    [trades, initialEquity],
  );

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function handleExport() {
    const csv = exportCsv(trades);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `journal-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleClear() {
    if (
      confirm("Apagar TODOS os trades do journal? Esta ação é irreversível.")
    ) {
      clearAll();
      reload();
    }
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-sidebar px-4 py-2.5">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Voltar ao painel"
          >
            <ArrowLeft className="size-3.5" />
          </Link>
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground glow-primary">
            <BookText className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">
              Trade <span className="text-primary">Journal</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Histórico persistente · análise · export CSV
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="mr-1 size-3" /> Novo trade
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleExport}
            disabled={trades.length === 0}
          >
            <Download className="mr-1 size-3" /> CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleClear}
            disabled={trades.length === 0}
            className="text-bear hover:bg-bear/10"
          >
            <Trash2 className="mr-1 size-3" /> Limpar
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_320px]">
        {/* Main: stats + calendar + table */}
        <main className="flex min-h-0 flex-col overflow-y-auto p-3 scrollbar-thin">
          {trades.length === 0 ? (
            <EmptyJournal onAdd={() => setAdding(true)} />
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                <StatCard
                  icon={stats.totalPnlUsd >= 0 ? TrendingUp : TrendingDown}
                  label="P&L Total"
                  value={`${stats.totalPnlUsd >= 0 ? "+" : ""}${stats.totalPnlUsd.toFixed(2)}`}
                  sub={`${stats.totalPnlPct >= 0 ? "+" : ""}${stats.totalPnlPct.toFixed(2)}%`}
                  tone={stats.totalPnlUsd >= 0 ? "bull" : "bear"}
                />
                <StatCard
                  icon={Target}
                  label="Win Rate"
                  value={`${(stats.winRate * 100).toFixed(1)}%`}
                  sub={`${stats.winners}W / ${stats.losers}L`}
                  tone={stats.winRate >= 0.5 ? "bull" : "muted"}
                />
                <StatCard
                  icon={Activity}
                  label="Profit Factor"
                  value={
                    isFinite(stats.profitFactor)
                      ? stats.profitFactor.toFixed(2)
                      : "∞"
                  }
                  sub={`expect ${stats.avgPnlUsd.toFixed(2)}`}
                  tone={stats.profitFactor >= 1.2 ? "bull" : "muted"}
                />
                <StatCard
                  icon={TrendingUp}
                  label="Melhor"
                  value={`+${stats.bestTradeUsd.toFixed(2)}`}
                  tone="bull"
                />
                <StatCard
                  icon={TrendingDown}
                  label="Pior"
                  value={stats.worstTradeUsd.toFixed(2)}
                  tone="bear"
                />
              </div>

              <Card className="mt-3">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Calendar className="size-3.5 text-primary" /> Heatmap
                    diário
                    <span className="text-[10px] font-normal text-muted-foreground">
                      últimos {stats.dailyPnl.length}d
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DailyHeatmap daily={stats.dailyPnl} />
                </CardContent>
              </Card>

              <Card className="mt-3">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Trades ({filtered.length}/{trades.length})
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <TradesTable
                    rows={filtered}
                    sortKey={sortKey}
                    sortDir={sortDir}
                    onSort={toggleSort}
                    onEdit={(t) => setEditing(t)}
                    onDelete={(id) => {
                      deleteTrade(id);
                      reload();
                    }}
                  />
                </CardContent>
              </Card>

              {stats.bySymbol.length > 0 && (
                <Card className="mt-3">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Por símbolo</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <BySymbolTable rows={stats.bySymbol} />
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </main>

        {/* Sidebar: filters */}
        <aside className="flex flex-col gap-3 overflow-y-auto border-l border-border bg-sidebar p-3 scrollbar-thin">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Filter className="size-3.5 text-primary" /> Filtros
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                  Símbolo
                </label>
                <select
                  value={filter.symbol ?? ""}
                  onChange={(e) =>
                    setFilter({
                      ...filter,
                      symbol: e.target.value || undefined,
                    })
                  }
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">Todos</option>
                  {DEFAULT_SYMBOLS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                  Lado
                </label>
                <select
                  value={filter.side ?? ""}
                  onChange={(e) =>
                    setFilter({
                      ...filter,
                      side: (e.target.value || undefined) as
                        | "BUY"
                        | "SELL"
                        | undefined,
                    })
                  }
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">Todos</option>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                  Origem
                </label>
                <select
                  value={filter.source ?? ""}
                  onChange={(e) =>
                    setFilter({
                      ...filter,
                      source: (e.target.value || undefined) as
                        | JournalTrade["source"]
                        | undefined,
                    })
                  }
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  <option value="">Todos</option>
                  <option value="live">Live</option>
                  <option value="backtest">Backtest</option>
                  <option value="manual">Manual</option>
                </select>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={filter.openOnly ?? false}
                  onChange={(e) =>
                    setFilter({
                      ...filter,
                      openOnly: e.target.checked || undefined,
                    })
                  }
                />
                Apenas abertos
              </label>
              <div className="pt-2">
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                  Equity inicial
                </label>
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={initialEquity}
                  onChange={(e) =>
                    setInitialEquity(Math.max(100, Number(e.target.value) || 0))
                  }
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
                />
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>

      {editing && (
        <TradeModal
          trade={editing}
          onClose={() => setEditing(null)}
          onSave={(t) => {
            if (t.id) {
              updateTrade(t.id, t);
            } else {
              addTrade(t);
            }
            setEditing(null);
            reload();
          }}
        />
      )}
      {adding && (
        <TradeModal
          trade={null}
          onClose={() => setAdding(false)}
          onSave={(t) => {
            addTrade(t);
            setAdding(false);
            reload();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  sub?: string;
  tone: "bull" | "bear" | "muted";
}) {
  const color =
    tone === "bull"
      ? "text-bull"
      : tone === "bear"
        ? "text-bear"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="p-3">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Icon className="size-3" /> {label}
        </div>
        <div className={`text-base font-bold tabular ${color}`}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function EmptyJournal({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <NotebookPen className="size-10 opacity-30" />
      <div className="text-sm">Journal vazio</div>
      <div className="max-w-md text-center text-[11px]">
        Registre trades manualmente ou importe resultados de backtest para
        acompanhar performance ao longo do tempo.
      </div>
      <Button onClick={onAdd} size="sm" variant="outline">
        <Plus className="mr-1 size-3" /> Adicionar primeiro trade
      </Button>
    </div>
  );
}

function DailyHeatmap({
  daily,
}: {
  daily: Array<{ date: string; pnl: number; trades: number }>;
}) {
  if (daily.length === 0) return null;
  // Group by week (columns) and weekday (rows)
  const weeks: Array<Array<(typeof daily)[number] | null>> = [];
  let currentWeek: Array<(typeof daily)[number] | null> = new Array(7).fill(
    null,
  );
  const firstDate = new Date(daily[0].date + "T00:00:00");
  const firstDayOfWeek = firstDate.getDay(); // 0=Sun
  // Pre-fill the first week with nulls up to the first day
  for (let i = 0; i < firstDayOfWeek; i++) currentWeek[i] = null;
  for (const d of daily) {
    if (currentWeek.filter((x) => x !== null).length === 7) {
      weeks.push(currentWeek);
      currentWeek = new Array(7).fill(null);
    }
    const dow = new Date(d.date + "T00:00:00").getDay();
    currentWeek[dow] = d;
  }
  if (currentWeek.some((x) => x !== null)) weeks.push(currentWeek);

  const maxAbs = Math.max(1, ...daily.map((d) => Math.abs(d.pnl)));

  return (
    <div className="overflow-x-auto scrollbar-thin">
      <div className="flex gap-1">
        {weeks.map((week, wi) => (
          <div key={wi} className="flex flex-col gap-1">
            {week.map((day, di) => {
              if (!day) {
                return <div key={di} className="size-3.5" />;
              }
              const intensity = Math.min(1, Math.abs(day.pnl) / maxAbs);
              const bg =
                day.pnl === 0
                  ? "var(--accent)"
                  : day.pnl > 0
                    ? `rgba(34, 197, 94, ${0.2 + intensity * 0.8})`
                    : `rgba(239, 68, 68, ${0.2 + intensity * 0.8})`;
              return (
                <div
                  key={di}
                  className="size-3.5 rounded-sm"
                  style={{ backgroundColor: bg }}
                  title={`${day.date}: ${day.pnl >= 0 ? "+" : ""}${day.pnl.toFixed(2)} (${day.trades} trades)`}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function Th({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-2 py-1.5 text-left font-medium ${className}`}>
      {children}
    </th>
  );
}

function TradesTable({
  rows,
  sortKey,
  sortDir,
  onSort,
  onEdit,
  onDelete,
}: {
  rows: JournalTrade[];
  sortKey: "entryTime" | "pnlUsd" | "pnlR" | "symbol";
  sortDir: "asc" | "desc";
  onSort: (k: "entryTime" | "pnlUsd" | "pnlR" | "symbol") => void;
  onEdit: (t: JournalTrade) => void;
  onDelete: (id: string) => void;
}) {
  const Icon = (k: string) => {
    if (sortKey !== k) return null;
    return sortDir === "asc" ? ChevronUp : ChevronDown;
  };
  function renderIcon(k: string) {
    const C = Icon(k);
    return C ? <C className="size-3" /> : null;
  }
  return (
    <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-sidebar text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <Th>Símbolo</Th>
            <Th>Side</Th>
            <Th>Status</Th>
            <Th className="text-right">Entry</Th>
            <Th className="text-right">Exit</Th>
            <Th className="text-right">Qty</Th>
            <Th className="text-right">P&L</Th>
            <Th className="text-right">R</Th>
            <Th>Origem</Th>
            <Th></Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const isWin = t.pnlUsd > 0;
            const isOpen = t.exitTime === null;
            return (
              <tr
                key={t.id}
                className="cursor-pointer border-t border-border/40 hover:bg-accent/30"
                onClick={() => onEdit(t)}
              >
                <td className="px-2 py-1.5 font-medium">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSort("symbol");
                    }}
                    className="flex items-center gap-1"
                  >
                    {t.symbol}
                    {renderIcon("symbol")}
                  </button>
                </td>
                <td className="px-2 py-1.5">
                  <Badge
                    className={
                      t.side === "BUY"
                        ? "bg-bull/20 text-bull"
                        : "bg-bear/20 text-bear"
                    }
                  >
                    {t.side}
                  </Badge>
                </td>
                <td className="px-2 py-1.5">
                  {isOpen ? (
                    <Badge
                      variant="outline"
                      className="text-primary border-primary"
                    >
                      aberto
                    </Badge>
                  ) : (
                    <span className="text-muted-foreground">
                      {t.exitReason}
                    </span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right tabular">
                  {t.entryPrice.toFixed(2)}
                </td>
                <td className="px-2 py-1.5 text-right tabular">
                  {t.exitPrice !== null ? t.exitPrice.toFixed(2) : "—"}
                </td>
                <td className="px-2 py-1.5 text-right tabular">
                  {t.qty < 0.001 ? t.qty.toFixed(6) : t.qty.toFixed(4)}
                </td>
                <td
                  className={`px-2 py-1.5 text-right tabular font-medium ${isWin ? "text-bull" : isOpen ? "text-muted-foreground" : "text-bear"}`}
                >
                  {isOpen ? "…" : `${isWin ? "+" : ""}${t.pnlUsd.toFixed(2)}`}
                </td>
                <td
                  className={`px-2 py-1.5 text-right tabular ${isWin ? "text-bull" : isOpen ? "text-muted-foreground" : "text-bear"}`}
                >
                  {isOpen ? "…" : `${isWin ? "+" : ""}${t.pnlR.toFixed(2)}R`}
                </td>
                <td className="px-2 py-1.5 text-muted-foreground">
                  {t.source}
                </td>
                <td className="px-2 py-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm("Excluir trade?")) onDelete(t.id);
                    }}
                    className="text-muted-foreground hover:text-bear"
                    title="Excluir"
                  >
                    <X className="size-3" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function BySymbolTable({
  rows,
}: {
  rows: Array<{ symbol: string; trades: number; pnl: number; winRate: number }>;
}) {
  return (
    <div className="max-h-48 overflow-y-auto scrollbar-thin">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-sidebar text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <Th>Símbolo</Th>
            <Th className="text-right">Trades</Th>
            <Th className="text-right">WR</Th>
            <Th className="text-right">P&L</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.symbol} className="border-t border-border/40">
              <td className="px-2 py-1.5 font-medium">{r.symbol}</td>
              <td className="px-2 py-1.5 text-right tabular">{r.trades}</td>
              <td className="px-2 py-1.5 text-right tabular">
                {(r.winRate * 100).toFixed(0)}%
              </td>
              <td
                className={`px-2 py-1.5 text-right tabular font-medium ${r.pnl >= 0 ? "text-bull" : "text-bear"}`}
              >
                {r.pnl >= 0 ? "+" : ""}
                {r.pnl.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TradeModal({
  trade,
  onClose,
  onSave,
}: {
  trade: JournalTrade | null;
  onClose: () => void;
  onSave: (t: Omit<JournalTrade, "id"> & { id?: string }) => void;
}) {
  const [symbol, setSymbol] = useState(trade?.symbol ?? "BTCUSDT");
  const [side, setSide] = useState<"BUY" | "SELL">(trade?.side ?? "BUY");
  const [entryPrice, setEntryPrice] = useState(trade?.entryPrice ?? 0);
  const [exitPrice, setExitPrice] = useState<number | "">(
    trade?.exitPrice ?? "",
  );
  const [qty, setQty] = useState(trade?.qty ?? 0);
  const [stop, setStop] = useState(trade?.stop ?? 0);
  const [target, setTarget] = useState(trade?.target ?? 0);
  const [fees, setFees] = useState(trade?.fees ?? 0);
  const [source, setSource] = useState<JournalTrade["source"]>(
    trade?.source ?? "manual",
  );
  const [exitReason, setExitReason] = useState<JournalTrade["exitReason"]>(
    trade?.exitReason ?? "MANUAL",
  );
  const [notes, setNotes] = useState(trade?.notes ?? "");
  const [confidence, setConfidence] = useState<number | "">(
    trade?.confidence ?? "",
  );
  const [confluence, setConfluence] = useState<number | "">(
    trade?.confluence ?? "",
  );
  const [regime, setRegime] = useState<Regime | "">(trade?.regime ?? "");
  const [entryTime, setEntryTime] = useState(
    trade?.entryTime
      ? new Date(trade.entryTime).toISOString().slice(0, 16)
      : nowIso(),
  );
  const [exitTime, setExitTime] = useState(
    trade?.exitTime ? new Date(trade.exitTime).toISOString().slice(0, 16) : "",
  );

  function handleSave() {
    const ep = typeof exitPrice === "number" ? exitPrice : null;
    const dir = side === "BUY" ? 1 : -1;
    const gross = ep !== null ? (ep - entryPrice) * dir * qty : 0;
    const totalFees =
      fees + (ep !== null ? (entryPrice + ep) * qty * 0.001 : 0);
    const pnlUsd = ep !== null ? gross - totalFees : 0;
    const risk = Math.abs(entryPrice - stop);
    const pnlR = risk > 0 && qty > 0 ? pnlUsd / (risk * qty) : 0;
    const payload: Omit<JournalTrade, "id"> & { id?: string } = {
      id: trade?.id,
      symbol,
      side,
      entryTime: new Date(entryTime).getTime(),
      exitTime: exitTime ? new Date(exitTime).getTime() : null,
      entryPrice,
      exitPrice: ep,
      qty,
      stop,
      target,
      pnlUsd,
      pnlR,
      fees: totalFees,
      source,
      exitReason: ep === null ? null : exitReason,
      notes,
      confidence: typeof confidence === "number" ? confidence : null,
      confluence: typeof confluence === "number" ? confluence : null,
      regime: regime === "" ? null : regime,
      score: null,
    };
    onSave(payload);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">
              {trade ? "Editar trade" : "Novo trade"}
            </CardTitle>
            <button
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <CardDescription>
            Preencha os dados do trade · campos opcionais marcados com —
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Símbolo">
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                {DEFAULT_SYMBOLS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Lado">
              <select
                value={side}
                onChange={(e) => setSide(e.target.value as "BUY" | "SELL")}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="BUY">BUY</option>
                <option value="SELL">SELL</option>
              </select>
            </Field>
            <Field label="Entry price">
              <input
                type="number"
                step="any"
                value={entryPrice}
                onChange={(e) => setEntryPrice(Number(e.target.value) || 0)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
              />
            </Field>
            <Field label="Exit price (— = aberto)">
              <input
                type="number"
                step="any"
                value={exitPrice}
                onChange={(e) =>
                  setExitPrice(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
              />
            </Field>
            <Field label="Qty">
              <input
                type="number"
                step="any"
                value={qty}
                onChange={(e) => setQty(Number(e.target.value) || 0)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
              />
            </Field>
            <Field label="Stop">
              <input
                type="number"
                step="any"
                value={stop}
                onChange={(e) => setStop(Number(e.target.value) || 0)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
              />
            </Field>
            <Field label="Target">
              <input
                type="number"
                step="any"
                value={target}
                onChange={(e) => setTarget(Number(e.target.value) || 0)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
              />
            </Field>
            <Field label="Fees USD">
              <input
                type="number"
                step="any"
                value={fees}
                onChange={(e) => setFees(Number(e.target.value) || 0)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
              />
            </Field>
            <Field label="Origem">
              <select
                value={source}
                onChange={(e) =>
                  setSource(e.target.value as JournalTrade["source"])
                }
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="manual">Manual</option>
                <option value="live">Live</option>
                <option value="backtest">Backtest</option>
              </select>
            </Field>
            <Field label="Exit reason">
              <select
                value={exitReason ?? ""}
                onChange={(e) =>
                  setExitReason(
                    (e.target.value || null) as JournalTrade["exitReason"],
                  )
                }
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                <option value="TP">TP</option>
                <option value="SL">SL</option>
                <option value="TRAIL">TRAIL</option>
                <option value="MANUAL">MANUAL</option>
                <option value="REVERSAL">REVERSAL</option>
              </select>
            </Field>
            <Field label="Entry time">
              <input
                type="datetime-local"
                value={entryTime}
                onChange={(e) => setEntryTime(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Exit time">
              <input
                type="datetime-local"
                value={exitTime}
                onChange={(e) => setExitTime(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              />
            </Field>
            <Field label="Confiança (—)">
              <input
                type="number"
                min={0}
                max={100}
                value={confidence}
                onChange={(e) =>
                  setConfidence(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
              />
            </Field>
            <Field label="Confluence (—)">
              <input
                type="number"
                min={0}
                max={100}
                value={confluence}
                onChange={(e) =>
                  setConfluence(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
              />
            </Field>
            <Field label="Regime (—)">
              <select
                value={regime}
                onChange={(e) =>
                  setRegime((e.target.value || "") as Regime | "")
                }
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
              >
                <option value="">—</option>
                <option value="BULL_TREND">BULL</option>
                <option value="BEAR_TREND">BEAR</option>
                <option value="RANGE">RANGE</option>
                <option value="VOLATILE">VOLATILE</option>
              </select>
            </Field>
          </div>
          <Field label="Notas">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={onClose}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleSave}>
              Salvar
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

function nowIso() {
  return new Date().toISOString().slice(0, 16);
}
