import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Crosshair,
  TrendingUp,
  TrendingDown,
  Minus,
  Waves,
  RefreshCw,
  Filter,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DEFAULT_SYMBOLS, INTERVALS, type Interval } from "@/lib/binance";
import { scanSymbols, type ScanResult, type ScanRow } from "@/lib/scanner";
import type { Regime } from "@/lib/regime";

export const Route = createFileRoute("/scanner")({
  component: ScannerPage,
});

const REGIME_ICON: Record<Regime, typeof TrendingUp> = {
  BULL_TREND: TrendingUp,
  BEAR_TREND: TrendingDown,
  RANGE: Minus,
  VOLATILE: Waves,
};

const REGIME_LABEL: Record<Regime, string> = {
  BULL_TREND: "Alta",
  BEAR_TREND: "Baixa",
  RANGE: "Range",
  VOLATILE: "Volátil",
};

const REGIME_TONE: Record<Regime, "bull" | "bear" | "muted" | "warn"> = {
  BULL_TREND: "bull",
  BEAR_TREND: "bear",
  RANGE: "muted",
  VOLATILE: "warn",
};

type DirFilter = "ALL" | "LONG" | "SHORT";
type RegimeFilter = "ALL" | Regime;

function ScannerPage() {
  const navigate = useNavigate();
  const [interval, setInterval] = useState<Interval>("1h");
  const [symbols, setSymbols] = useState<string[]>(DEFAULT_SYMBOLS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  const [dirFilter, setDirFilter] = useState<DirFilter>("ALL");
  const [regimeFilter, setRegimeFilter] = useState<RegimeFilter>("ALL");
  const [minOpp, setMinOpp] = useState(0);

  const [sortKey, setSortKey] = useState<keyof ScanRow>("opportunity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  async function handleRun() {
    setRunning(true);
    setError(null);
    setProgress(`Escaneando ${symbols.length} símbolos…`);
    try {
      const r = await scanSymbols({ symbols, interval, concurrency: 4 });
      setResult(r);
      setProgress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro");
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (symbols.length > 0 && !result && !running) {
      void handleRun();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (!result) return [];
    let rows = [...result.rows];
    if (dirFilter !== "ALL")
      rows = rows.filter((r) => r.direction === dirFilter);
    if (regimeFilter !== "ALL")
      rows = rows.filter((r) => r.regime === regimeFilter);
    if (minOpp > 0) rows = rows.filter((r) => r.opportunity >= minOpp);
    rows.sort((a, b) => {
      const av = a[sortKey] as number | string;
      const bv = b[sortKey] as number | string;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return rows;
  }, [result, dirFilter, regimeFilter, minOpp, sortKey, sortDir]);

  function toggleSort(key: keyof ScanRow) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("desc");
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
            <Crosshair className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">
              Market <span className="text-primary">Scanner</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Ranking multi-símbolo · sinal · regime · confluence
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={interval}
            onChange={(e) => setInterval(e.target.value as Interval)}
            disabled={running}
            className="rounded-md border border-input bg-background px-2 py-1 text-xs"
          >
            {INTERVALS.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
          <Button onClick={handleRun} disabled={running} size="sm">
            {running ? (
              <>
                <RefreshCw className="mr-1 size-3 animate-spin" /> Escaneando…
              </>
            ) : (
              <>
                <RefreshCw className="mr-1 size-3" /> Re-escanear
              </>
            )}
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[1fr_320px]">
        {/* Table */}
        <main className="flex min-h-0 flex-col overflow-hidden">
          {!result && !running && (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="text-center">
                <Crosshair className="mx-auto mb-2 size-10 opacity-30" />
                <div className="text-sm">Iniciando scanner…</div>
              </div>
            </div>
          )}
          {progress && (
            <div className="flex items-center gap-2 border-b border-border bg-sidebar p-3 text-[11px] text-muted-foreground">
              <RefreshCw className="size-3 animate-spin" /> {progress}
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 border-b border-border bg-bear/10 p-3 text-[11px] text-bear">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {error}
            </div>
          )}
          {result && (
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              <table className="w-full text-[11px]">
                <thead className="sticky top-0 z-10 bg-sidebar text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <Th>#</Th>
                    <Th>
                      <button
                        onClick={() => toggleSort("symbol")}
                        className="flex items-center gap-1"
                      >
                        Símbolo
                        {sortKey === "symbol" &&
                          (sortDir === "asc" ? (
                            <ChevronUp className="size-3" />
                          ) : (
                            <ChevronDown className="size-3" />
                          ))}
                      </button>
                    </Th>
                    <Th className="text-right">Preço</Th>
                    <Th>
                      <button
                        onClick={() => toggleSort("change24h")}
                        className="flex items-center gap-1"
                      >
                        24h%
                        {sortKey === "change24h" &&
                          (sortDir === "asc" ? (
                            <ChevronUp className="size-3" />
                          ) : (
                            <ChevronDown className="size-3" />
                          ))}
                      </button>
                    </Th>
                    <Th>Regime</Th>
                    <Th>Direção</Th>
                    <Th>
                      <button
                        onClick={() => toggleSort("signal")}
                        className="flex items-center gap-1"
                      >
                        Sinal
                        {sortKey === "signal" &&
                          (sortDir === "asc" ? (
                            <ChevronUp className="size-3" />
                          ) : (
                            <ChevronDown className="size-3" />
                          ))}
                      </button>
                    </Th>
                    <Th>
                      <button
                        onClick={() => toggleSort("confluence")}
                        className="flex items-center gap-1"
                      >
                        Conf.
                        {sortKey === "confluence" &&
                          (sortDir === "asc" ? (
                            <ChevronUp className="size-3" />
                          ) : (
                            <ChevronDown className="size-3" />
                          ))}
                      </button>
                    </Th>
                    <Th>
                      <button
                        onClick={() => toggleSort("opportunity")}
                        className="flex items-center gap-1"
                      >
                        Opp.
                        {sortKey === "opportunity" &&
                          (sortDir === "asc" ? (
                            <ChevronUp className="size-3" />
                          ) : (
                            <ChevronDown className="size-3" />
                          ))}
                      </button>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r, i) => {
                    const RegimeIcon = REGIME_ICON[r.regime] ?? Minus;
                    return (
                      <tr
                        key={r.symbol}
                        className="cursor-pointer border-t border-border/40 hover:bg-accent/30"
                        onClick={() => navigate({ to: "/" })}
                        title={`Abrir ${r.symbol} no painel`}
                      >
                        <td className="px-2 py-1.5 text-muted-foreground tabular">
                          {i + 1}
                        </td>
                        <td className="px-2 py-1.5 font-medium">{r.symbol}</td>
                        <td className="px-2 py-1.5 text-right tabular">
                          {r.price < 1
                            ? r.price.toFixed(4)
                            : r.price.toFixed(2)}
                        </td>
                        <td
                          className={`px-2 py-1.5 text-right tabular ${r.change24h >= 0 ? "text-bull" : "text-bear"}`}
                        >
                          {r.change24h >= 0 ? "+" : ""}
                          {r.change24h.toFixed(2)}%
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge
                            className={
                              r.regime === "BULL_TREND"
                                ? "bg-bull/20 text-bull"
                                : r.regime === "BEAR_TREND"
                                  ? "bg-bear/20 text-bear"
                                  : r.regime === "VOLATILE"
                                    ? "bg-warn/20 text-warn"
                                    : "bg-muted text-muted-foreground"
                            }
                          >
                            <RegimeIcon className="mr-1 size-2.5" />
                            {REGIME_LABEL[r.regime]} {r.regimeConfidence}%
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5">
                          <Badge
                            variant="outline"
                            className={
                              r.direction === "LONG"
                                ? "border-bull text-bull"
                                : r.direction === "SHORT"
                                  ? "border-bear text-bear"
                                  : "text-muted-foreground"
                            }
                          >
                            {r.direction}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5">
                          <span
                            className={
                              r.signal.action === "BUY"
                                ? "text-bull"
                                : r.signal.action === "SELL"
                                  ? "text-bear"
                                  : "text-muted-foreground"
                            }
                          >
                            {r.signal.action}{" "}
                            <span className="tabular text-muted-foreground">
                              {r.signal.confidence}%
                            </span>
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <ConfCell
                            score={r.confluence.score}
                            tone={r.confluence.tone}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <OppCell value={r.opportunity} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && result && (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Nenhum símbolo corresponde aos filtros.
                </div>
              )}
            </div>
          )}
        </main>

        {/* Filters & aggregate */}
        <aside className="flex flex-col gap-3 overflow-y-auto border-l border-border bg-sidebar p-3 scrollbar-thin">
          {result && <AggregateCard r={result} />}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Filter className="size-3.5 text-primary" /> Filtros
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                  Direção
                </label>
                <div className="flex gap-1">
                  {(["ALL", "LONG", "SHORT"] as const).map((d) => (
                    <button
                      key={d}
                      onClick={() => setDirFilter(d)}
                      className={`flex-1 rounded-md border px-2 py-1 text-xs ${
                        dirFilter === d
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-[10px] uppercase tracking-wider text-muted-foreground">
                  Regime
                </label>
                <div className="grid grid-cols-2 gap-1">
                  {(
                    [
                      "ALL",
                      "BULL_TREND",
                      "BEAR_TREND",
                      "RANGE",
                      "VOLATILE",
                    ] as const
                  ).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRegimeFilter(r)}
                      className={`rounded-md border px-2 py-1 text-xs ${
                        regimeFilter === r
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {r === "ALL" ? "Todos" : REGIME_LABEL[r]}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                  <span>Opportunity ≥ {minOpp}</span>
                  <span>
                    {filtered.length}/{result?.rows.length ?? 0}
                  </span>
                </label>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={minOpp}
                  onChange={(e) => setMinOpp(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </CardContent>
          </Card>

          {result && result.errors.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm text-bear">
                  <AlertTriangle className="size-3.5" /> Erros (
                  {result.errors.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-32 space-y-1 overflow-y-auto text-[10px] scrollbar-thin">
                  {result.errors.map((e) => (
                    <div key={e.symbol} className="text-bear/80">
                      {e.symbol}: {e.error}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function Th({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <th className={`px-2 py-2 text-left font-medium ${className}`}>
      {children}
    </th>
  );
}

function ConfCell({
  score,
  tone,
}: {
  score: number;
  tone: ScanRow["confluence"]["tone"];
}) {
  const color =
    tone === "bullish"
      ? "text-bull"
      : tone === "bearish"
        ? "text-bear"
        : "text-muted-foreground";
  return (
    <div className="flex items-center gap-1.5">
      <div className="relative h-1 w-12 overflow-hidden rounded-full bg-accent">
        <div
          className={`absolute inset-y-0 left-0 ${
            tone === "bullish"
              ? "bg-bull"
              : tone === "bearish"
                ? "bg-bear"
                : "bg-muted-foreground"
          }`}
          style={{ width: `${score}%` }}
        />
      </div>
      <span className={`tabular ${color}`}>{score}</span>
    </div>
  );
}

function OppCell({ value }: { value: number }) {
  const color =
    value >= 70
      ? "text-bull"
      : value >= 50
        ? "text-primary"
        : value >= 30
          ? "text-muted-foreground"
          : "text-bear/70";
  return (
    <div className="flex items-center gap-1">
      <div className="relative h-1.5 w-14 overflow-hidden rounded-full bg-accent">
        <div
          className={`absolute inset-y-0 left-0 ${
            value >= 70
              ? "bg-bull"
              : value >= 50
                ? "bg-primary"
                : value >= 30
                  ? "bg-muted-foreground"
                  : "bg-bear"
          }`}
          style={{ width: `${value}%` }}
        />
      </div>
      <span className={`tabular text-[10px] font-medium ${color}`}>
        {value}
      </span>
    </div>
  );
}

function AggregateCard({ r }: { r: ScanResult }) {
  const a = r.aggregate;
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Visão Geral</CardTitle>
        <CardDescription>
          {a.scanned} símbolos · {(r.durationMs / 1000).toFixed(1)}s ·{" "}
          {r.config.interval}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-[11px]">
        <Row label="Opp. média" value={a.avgOpportunity.toFixed(1)} />
        <Row
          label="Setups LONG"
          value={`${a.longSetups}`}
          tone={a.longSetups > 0 ? "bull" : "muted"}
        />
        <Row
          label="Setups SHORT"
          value={`${a.shortSetups}`}
          tone={a.shortSetups > 0 ? "bear" : "muted"}
        />
        <Row label="Neutros" value={`${a.neutral}`} tone="muted" />
        <div className="my-1 border-t border-border/50" />
        <Row label="Em alta" value={`${a.bullishRegimes}`} tone="bull" />
        <Row label="Em baixa" value={`${a.bearishRegimes}`} tone="bear" />
        <Row label="Em range" value={`${a.rangingRegimes}`} tone="muted" />
        <Row label="Volátil" value={`${a.volatileRegimes}`} tone="warn" />
      </CardContent>
    </Card>
  );
}

function Row({
  label,
  value,
  tone = "muted",
}: {
  label: string;
  value: string;
  tone?: "bull" | "bear" | "muted" | "warn";
}) {
  const color =
    tone === "bull"
      ? "text-bull"
      : tone === "bear"
        ? "text-bear"
        : tone === "warn"
          ? "text-warn"
          : "text-foreground";
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={`tabular font-medium ${color}`}>{value}</span>
    </div>
  );
}
