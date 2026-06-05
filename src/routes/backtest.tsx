import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import type { Candle } from "@/lib/indicators";
import {
  Activity,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  Repeat,
  Loader2,
  Play,
  TrendingUp,
  TrendingDown,
  Target,
  Percent,
  DollarSign,
  BarChart3,
  AlertTriangle,
  CheckCircle2,
  XCircle,
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
import {
  DEFAULT_BACKTEST,
  fetchBacktestData,
  runBacktest,
  type BacktestResult,
  type BacktestTrade,
} from "@/lib/backtest";
import { runWalkForward, type WalkForwardResult } from "@/lib/walk-forward";
import { DEFAULT_RISK } from "@/lib/risk";

export const Route = createFileRoute("/backtest")({
  component: BacktestPage,
});

const DAY_OPTIONS = [7, 30, 90, 180, 365];

function BacktestPage() {
  const [symbol, setSymbol] = useState<string>(DEFAULT_SYMBOLS[0] ?? "BTCUSDT");
  const [interval, setInterval] = useState<Interval>("1h");
  const [days, setDays] = useState<number>(90);
  const [initialEquity, setInitialEquity] = useState<number>(
    DEFAULT_BACKTEST.initialEquity,
  );
  const [minScore, setMinScore] = useState<number>(
    DEFAULT_BACKTEST.minScore ?? 25,
  );
  const [minConfidence, setMinConfidence] = useState<number>(
    DEFAULT_BACKTEST.minConfidence ?? 35,
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [progress, setProgress] = useState<string>("");
  const [tradesOpen, setTradesOpen] = useState(false);
  const [candles, setCandles] = useState<Candle[] | null>(null);

  // Walk-forward state
  const [wfTrainDays, setWfTrainDays] = useState(60);
  const [wfTestDays, setWfTestDays] = useState(20);
  const [wfStepDays, setWfStepDays] = useState(20);
  const [wfRunning, setWfRunning] = useState(false);
  const [wfResult, setWfResult] = useState<WalkForwardResult | null>(null);
  const [wfFoldsOpen, setWfFoldsOpen] = useState(false);

  async function handleRun() {
    setRunning(true);
    setError(null);
    setResult(null);
    setWfResult(null);
    setProgress("Buscando candles…");
    try {
      const c = await fetchBacktestData(symbol, interval, days);
      if (c.length < 60) {
        throw new Error(
          `Apenas ${c.length} candles recebidos — escolha mais dias.`,
        );
      }
      setProgress(`Calculando ${c.length} candles…`);
      // Defer to next tick so the progress label can render before the
      // synchronous engine blocks the main thread.
      await new Promise((r) => setTimeout(r, 16));
      const r = runBacktest(
        c,
        {
          ...DEFAULT_RISK,
          initialEquity,
          minScore,
          minConfidence,
        },
        { symbol, interval },
      );
      setResult(r);
      setCandles(c);
      setProgress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setRunning(false);
    }
  }

  async function handleWalkForward() {
    if (!candles) {
      setError("Rode primeiro um backtest para obter os candles.");
      return;
    }
    setWfRunning(true);
    setError(null);
    setProgress("Walk-forward: rolando janelas…");
    try {
      await new Promise((r) => setTimeout(r, 16));
      const r = runWalkForward(
        candles,
        {
          ...DEFAULT_RISK,
          initialEquity,
          minScore,
          minConfidence,
        },
        {
          totalDays: days,
          trainDays: wfTrainDays,
          testDays: wfTestDays,
          stepDays: wfStepDays,
        },
        { symbol, interval },
      );
      setWfResult(r);
      setProgress("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro desconhecido");
    } finally {
      setWfRunning(false);
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
            <FlaskConical className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">
              Backtest <span className="text-primary">Engine</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Replay da estratégia local sobre candles históricos
            </div>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[360px_1fr]">
        {/* Config panel */}
        <aside className="flex flex-col gap-3 overflow-y-auto border-r border-border bg-sidebar p-3 scrollbar-thin">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Configuração</CardTitle>
              <CardDescription>Período e parâmetros</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Field label="Símbolo">
                <select
                  value={symbol}
                  onChange={(e) => setSymbol(e.target.value)}
                  disabled={running}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  {DEFAULT_SYMBOLS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Intervalo">
                <select
                  value={interval}
                  onChange={(e) => setInterval(e.target.value as Interval)}
                  disabled={running}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                >
                  {INTERVALS.map((i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Período (dias)">
                <div className="flex flex-wrap gap-1.5">
                  {DAY_OPTIONS.map((d) => (
                    <button
                      key={d}
                      onClick={() => setDays(d)}
                      disabled={running}
                      className={`flex-1 rounded-md border px-2 py-1 text-xs ${
                        days === d
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-accent"
                      }`}
                    >
                      {d}d
                    </button>
                  ))}
                </div>
              </Field>

              <Field label="Capital inicial (USDT)">
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={initialEquity}
                  onChange={(e) =>
                    setInitialEquity(Math.max(100, Number(e.target.value) || 0))
                  }
                  disabled={running}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
                />
              </Field>

              <div className="grid grid-cols-2 gap-2">
                <Field label="Score mín.">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={minScore}
                    onChange={(e) =>
                      setMinScore(
                        Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      )
                    }
                    disabled={running}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
                  />
                </Field>
                <Field label="Conf. mín.">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={minConfidence}
                    onChange={(e) =>
                      setMinConfidence(
                        Math.max(0, Math.min(100, Number(e.target.value) || 0)),
                      )
                    }
                    disabled={running}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
                  />
                </Field>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Risco (defaults)</CardTitle>
              <CardDescription>Configurado em src/lib/risk.ts</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 text-[11px]">
                <RiskRow
                  label="Risco / trade"
                  value={`${DEFAULT_RISK.riskPerTradePct}%`}
                />
                <RiskRow
                  label="Stop ATR"
                  value={`${DEFAULT_RISK.atrMultiplierSL}×`}
                />
                <RiskRow
                  label="TP ATR"
                  value={`${DEFAULT_RISK.atrMultiplierTP}×`}
                />
                <RiskRow label="Fee" value={`${DEFAULT_RISK.feePct}%`} />
                <RiskRow
                  label="R:R mínimo"
                  value={`${DEFAULT_RISK.minRR.toFixed(1)}`}
                />
                <RiskRow
                  label="Max DD"
                  value={`${DEFAULT_RISK.maxDrawdownPct}%`}
                />
              </div>
            </CardContent>
          </Card>

          <Button
            onClick={handleRun}
            disabled={running}
            className="w-full"
            size="lg"
          >
            {running ? (
              <>
                <Loader2 className="mr-1.5 size-4 animate-spin" /> Rodando…
              </>
            ) : (
              <>
                <Play className="mr-1.5 size-4" /> Rodar Backtest
              </>
            )}
          </Button>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Repeat className="size-3.5 text-primary" /> Walk-Forward
              </CardTitle>
              <CardDescription>Janelas rolantes · OOS agregado</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Field label="Train (d)">
                  <input
                    type="number"
                    min={10}
                    value={wfTrainDays}
                    onChange={(e) =>
                      setWfTrainDays(Math.max(10, Number(e.target.value) || 0))
                    }
                    disabled={wfRunning}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
                  />
                </Field>
                <Field label="Test (d)">
                  <input
                    type="number"
                    min={5}
                    value={wfTestDays}
                    onChange={(e) =>
                      setWfTestDays(Math.max(5, Number(e.target.value) || 0))
                    }
                    disabled={wfRunning}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
                  />
                </Field>
                <Field label="Step (d)">
                  <input
                    type="number"
                    min={1}
                    value={wfStepDays}
                    onChange={(e) =>
                      setWfStepDays(Math.max(1, Number(e.target.value) || 0))
                    }
                    disabled={wfRunning}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular"
                  />
                </Field>
              </div>
              <Button
                onClick={handleWalkForward}
                disabled={wfRunning || !candles}
                variant="outline"
                className="w-full"
                size="default"
              >
                {wfRunning ? (
                  <>
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />{" "}
                    Calculando…
                  </>
                ) : (
                  <>
                    <Repeat className="mr-1.5 size-3.5" /> Rodar Walk-Forward
                  </>
                )}
              </Button>
              {!candles && (
                <div className="text-[10px] text-muted-foreground">
                  Rode um backtest primeiro para popular os candles.
                </div>
              )}
            </CardContent>
          </Card>

          {progress && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-background p-2 text-[11px] text-muted-foreground">
              <Activity className="size-3 animate-pulse" /> {progress}
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 rounded-md border border-bear/40 bg-bear/10 p-2 text-[11px] text-bear">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {error}
            </div>
          )}
        </aside>

        {/* Results */}
        <main className="flex min-h-0 flex-col overflow-y-auto p-3 scrollbar-thin">
          {!result && !running && <EmptyState />}
          {result && (
            <ResultsView
              result={result}
              tradesOpen={tradesOpen}
              setTradesOpen={setTradesOpen}
            />
          )}
          {wfResult && (
            <WalkForwardView
              wf={wfResult}
              foldsOpen={wfFoldsOpen}
              setFoldsOpen={setWfFoldsOpen}
            />
          )}
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

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

function RiskRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular text-foreground">{value}</span>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <FlaskConical className="size-10 opacity-30" />
      <div className="text-sm">
        Configure à esquerda e clique em "Rodar Backtest"
      </div>
      <div className="max-w-md text-center text-[11px]">
        O motor replay a estratégia de sinal local sobre candles históricos e
        calcula equity, drawdown, win rate, Sharpe e fator de lucro.
      </div>
    </div>
  );
}

function ResultsView({
  result,
  tradesOpen,
  setTradesOpen,
}: {
  result: BacktestResult;
  tradesOpen: boolean;
  setTradesOpen: (v: boolean) => void;
}) {
  const s = result.stats;
  const isProfit = s.netPnlUsd >= 0;

  return (
    <div className="space-y-3">
      {/* Top stats */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          icon={isProfit ? TrendingUp : TrendingDown}
          label="P&L Líquido"
          value={`${isProfit ? "+" : ""}${s.netPnlUsd.toFixed(2)} USDT`}
          sub={`${isProfit ? "+" : ""}${s.netPnlPct.toFixed(2)}%`}
          tone={isProfit ? "bull" : "bear"}
        />
        <StatCard
          icon={Target}
          label="Win Rate"
          value={`${(s.winRate * 100).toFixed(1)}%`}
          sub={`${s.winners}W / ${s.losers}L · ${s.totalTrades} trades`}
          tone={s.winRate >= 0.5 ? "bull" : "muted"}
        />
        <StatCard
          icon={BarChart3}
          label="Profit Factor"
          value={s.profitFactor === Infinity ? "∞" : s.profitFactor.toFixed(2)}
          sub={`expect ${s.expectancy.toFixed(2)} USDT/trade`}
          tone={
            s.profitFactor >= 1.2
              ? "bull"
              : s.profitFactor < 1
                ? "bear"
                : "muted"
          }
        />
        <StatCard
          icon={TrendingDown}
          label="Max Drawdown"
          value={`-${s.maxDrawdownPct.toFixed(2)}%`}
          sub={`-${s.maxDrawdownUsd.toFixed(0)} USDT`}
          tone="bear"
        />
        <StatCard
          icon={Activity}
          label="Sharpe (anual.)"
          value={s.sharpe.toFixed(2)}
          sub={`avg R ${s.avgRMultiple.toFixed(2)}`}
          tone={s.sharpe >= 1 ? "bull" : s.sharpe < 0 ? "bear" : "muted"}
        />
        <StatCard
          icon={Percent}
          label="Exposição"
          value={`${(s.exposure * 100).toFixed(1)}%`}
          sub="tempo em posição"
          tone="muted"
        />
        <StatCard
          icon={DollarSign}
          label="Equity final"
          value={`${s.finalEquity.toFixed(0)} USDT`}
          sub={`inicial ${s.initialEquity.toFixed(0)}`}
          tone={isProfit ? "bull" : "bear"}
        />
        <StatCard
          icon={s.longestStreak.kind === "W" ? CheckCircle2 : XCircle}
          label="Maior sequência"
          value={`${s.longestStreak.length} ${s.longestStreak.kind === "W" ? "wins" : "losses"}`}
          sub="consecutivos"
          tone={s.longestStreak.kind === "W" ? "bull" : "bear"}
        />
      </div>

      {/* Equity curve */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Curva de Equity</CardTitle>
          <CardDescription>
            {result.bars} candles · {result.symbol} {result.interval} · engine{" "}
            {result.durationMs.toFixed(0)}ms
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EquityCurve points={result.equity} initial={s.initialEquity} />
        </CardContent>
      </Card>

      {/* Trades */}
      <Card>
        <CardHeader className="pb-2">
          <button
            onClick={() => setTradesOpen(!tradesOpen)}
            className="flex w-full items-center justify-between text-left"
          >
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                Trades ({result.trades.length})
                {tradesOpen ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
              </CardTitle>
              <CardDescription>
                {tradesOpen
                  ? "Lista completa, mais recentes primeiro"
                  : "Clique para expandir"}
              </CardDescription>
            </div>
          </button>
        </CardHeader>
        {tradesOpen && (
          <CardContent className="p-0">
            {result.trades.length > 0 ? (
              <TradesTable trades={result.trades} />
            ) : (
              <div className="p-3 text-xs text-muted-foreground">
                Nenhum trade executado no período.
              </div>
            )}
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: typeof Activity;
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

function EquityCurve({
  points,
  initial,
}: {
  points: { time: number; equity: number; price: number }[];
  initial: number;
}) {
  if (points.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
        Sem dados de equity
      </div>
    );
  }
  const w = 800;
  const h = 200;
  const padL = 56;
  const padR = 12;
  const padT = 12;
  const padB = 24;

  const equities = points.map((p) => p.equity);
  const minE = Math.min(...equities, initial);
  const maxE = Math.max(...equities, initial);
  const rangeE = maxE - minE || 1;
  const t0 = points[0].time;
  const tN = points[points.length - 1].time;
  const dt = tN - t0 || 1;

  const x = (t: number) => padL + ((t - t0) / dt) * (w - padL - padR);
  const y = (e: number) => padT + (1 - (e - minE) / rangeE) * (h - padT - padB);

  const path = points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${x(p.time).toFixed(2)} ${y(p.equity).toFixed(2)}`,
    )
    .join(" ");

  const initialY = y(initial);
  const last = points[points.length - 1];
  const isProfit = last.equity >= initial;
  const stroke = isProfit ? "var(--bull)" : "var(--bear)";

  // 4 horizontal grid lines
  const gridYs = [0, 0.25, 0.5, 0.75, 1].map(
    (f) => padT + f * (h - padT - padB),
  );
  const gridLabels = gridYs.map((gy) => {
    const e = maxE - ((gy - padT) / (h - padT - padB)) * rangeE;
    return { gy, label: e.toFixed(0) };
  });

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-48 w-full"
      preserveAspectRatio="none"
    >
      {gridYs.map((gy, i) => (
        <line
          key={i}
          x1={padL}
          y1={gy}
          x2={w - padR}
          y2={gy}
          stroke="var(--border)"
          strokeWidth="0.5"
          strokeDasharray="2 4"
          opacity="0.5"
        />
      ))}
      {gridLabels.map(({ gy, label }, i) => (
        <text
          key={i}
          x={padL - 4}
          y={gy + 3}
          textAnchor="end"
          style={{ fontSize: 9, fill: "var(--muted-foreground)" }}
        >
          {label}
        </text>
      ))}
      <line
        x1={padL}
        y1={initialY}
        x2={w - padR}
        y2={initialY}
        stroke="var(--muted-foreground)"
        strokeWidth="0.5"
        strokeDasharray="4 2"
        opacity="0.6"
      />
      <path
        d={path}
        fill="none"
        stroke={stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Fill below */}
      <path
        d={`${path} L ${x(last.time)} ${h - padB} L ${x(t0)} ${h - padB} Z`}
        fill={stroke}
        opacity="0.1"
      />
    </svg>
  );
}

function TradesTable({ trades }: { trades: BacktestTrade[] }) {
  const reversed = useMemo(() => [...trades].reverse(), [trades]);
  return (
    <div className="max-h-96 overflow-y-auto scrollbar-thin">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-sidebar text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left">#</th>
            <th className="px-2 py-1.5 text-left">Side</th>
            <th className="px-2 py-1.5 text-right">Entry</th>
            <th className="px-2 py-1.5 text-right">Exit</th>
            <th className="px-2 py-1.5 text-right">Stop</th>
            <th className="px-2 py-1.5 text-right">Target</th>
            <th className="px-2 py-1.5 text-center">Saída</th>
            <th className="px-2 py-1.5 text-right">P&L USD</th>
            <th className="px-2 py-1.5 text-right">R</th>
            <th className="px-2 py-1.5 text-right">Duração</th>
          </tr>
        </thead>
        <tbody>
          {reversed.map((t, i) => {
            const isWin = t.pnlUsd > 0;
            return (
              <tr
                key={`${t.entryTime}-${i}`}
                className="border-t border-border/40 hover:bg-accent/30"
              >
                <td className="px-2 py-1 text-muted-foreground tabular">
                  {trades.length - i}
                </td>
                <td className="px-2 py-1">
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
                <td className="px-2 py-1 text-right tabular">
                  {t.entryPrice.toFixed(2)}
                </td>
                <td className="px-2 py-1 text-right tabular">
                  {t.exitPrice !== null ? t.exitPrice.toFixed(2) : "—"}
                </td>
                <td className="px-2 py-1 text-right tabular text-muted-foreground">
                  {t.stop.toFixed(2)}
                </td>
                <td className="px-2 py-1 text-right tabular text-muted-foreground">
                  {t.target.toFixed(2)}
                </td>
                <td className="px-2 py-1 text-center">
                  <span
                    className={
                      t.exitReason === "TP"
                        ? "text-bull"
                        : t.exitReason === "SL"
                          ? "text-bear"
                          : t.exitReason === "TRAIL"
                            ? "text-primary"
                            : "text-muted-foreground"
                    }
                  >
                    {t.exitReason}
                  </span>
                </td>
                <td
                  className={`px-2 py-1 text-right tabular font-medium ${isWin ? "text-bull" : "text-bear"}`}
                >
                  {isWin ? "+" : ""}
                  {t.pnlUsd.toFixed(2)}
                </td>
                <td
                  className={`px-2 py-1 text-right tabular ${isWin ? "text-bull" : "text-bear"}`}
                >
                  {isWin ? "+" : ""}
                  {t.pnlR.toFixed(2)}R
                </td>
                <td className="px-2 py-1 text-right tabular text-muted-foreground">
                  {formatDuration(t.duration)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

// ---------------------------------------------------------------------------
// Walk-Forward view
// ---------------------------------------------------------------------------

function WalkForwardView({
  wf,
  foldsOpen,
  setFoldsOpen,
}: {
  wf: WalkForwardResult;
  foldsOpen: boolean;
  setFoldsOpen: (v: boolean) => void;
}) {
  const a = wf.aggregates;
  const overfitRatio = a.isVsOosRatio;
  const overfitWarning =
    overfitRatio > 2 || (a.consistency < 0.4 && a.totalFolds >= 3);

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2">
        <Repeat className="size-4 text-primary" />
        <h2 className="text-sm font-semibold tracking-tight">Walk-Forward</h2>
        <span className="text-[10px] text-muted-foreground">
          {wf.config.trainDays}d train · {wf.config.testDays}d test · step{" "}
          {wf.config.stepDays ?? wf.config.testDays}d
        </span>
      </div>

      {overfitWarning && (
        <div className="flex items-start gap-2 rounded-md border border-warn/40 bg-warn/10 p-2 text-[11px] text-warn">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          <div>
            <div className="font-medium">Possível overfitting detectado</div>
            <div className="text-warn/80">
              {a.consistency < 0.4
                ? `Apenas ${(a.consistency * 100).toFixed(0)}% das janelas OOS foram lucrativas. `
                : ""}
              {overfitRatio > 2
                ? `P&L in-sample é ${overfitRatio.toFixed(1)}× o OOS — degradação significativa. `
                : ""}
              Considere revisar regras ou aumentar o universo de símbolos.
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard
          icon={CheckCircle2}
          label="Consistência"
          value={`${(a.consistency * 100).toFixed(0)}%`}
          sub={`${a.profitableFolds}/${a.totalFolds} janelas OOS lucrativas`}
          tone={
            a.consistency >= 0.6
              ? "bull"
              : a.consistency < 0.4
                ? "bear"
                : "muted"
          }
        />
        <StatCard
          icon={a.totalOosPnlUsd >= 0 ? TrendingUp : TrendingDown}
          label="P&L OOS total"
          value={`${a.totalOosPnlUsd >= 0 ? "+" : ""}${a.totalOosPnlUsd.toFixed(0)} USDT`}
          sub={`${a.totalOosPnlPct >= 0 ? "+" : ""}${a.totalOosPnlPct.toFixed(2)}% · ${a.totalOosTrades} trades`}
          tone={a.totalOosPnlUsd >= 0 ? "bull" : "bear"}
        />
        <StatCard
          icon={BarChart3}
          label="PF médio OOS"
          value={
            isFinite(a.avgOosProfitFactor)
              ? a.avgOosProfitFactor.toFixed(2)
              : "∞"
          }
          sub={`win rate médio ${(a.avgOosWinRate * 100).toFixed(1)}%`}
          tone={
            a.avgOosProfitFactor >= 1.2
              ? "bull"
              : a.avgOosProfitFactor < 1
                ? "bear"
                : "muted"
          }
        />
        <StatCard
          icon={Activity}
          label="Sharpe médio OOS"
          value={a.avgOosSharpe.toFixed(2)}
          sub={`Pior DD: -${a.worstOosMaxDdPct.toFixed(2)}%`}
          tone={
            a.avgOosSharpe >= 1 ? "bull" : a.avgOosSharpe < 0 ? "bear" : "muted"
          }
        />
        <StatCard
          icon={Target}
          label="P&L médio / fold"
          value={`${a.avgOosPnlUsd >= 0 ? "+" : ""}${a.avgOosPnlUsd.toFixed(0)} USDT`}
          sub="out-of-sample"
          tone={a.avgOosPnlUsd >= 0 ? "bull" : "bear"}
        />
        <StatCard
          icon={TrendingDown}
          label="DD combinado OOS"
          value={`-${a.stitchedStats.maxDrawdownPct.toFixed(2)}%`}
          sub={`-${a.stitchedStats.maxDrawdownUsd.toFixed(0)} USDT`}
          tone="bear"
        />
        <StatCard
          icon={a.isVsOosRatio > 2 ? AlertTriangle : CheckCircle2}
          label="IS / OOS"
          value={`${a.isVsOosRatio.toFixed(2)}×`}
          sub={a.isVsOosRatio > 2 ? "overfitting" : "saudável"}
          tone={
            a.isVsOosRatio > 2
              ? "bear"
              : a.isVsOosRatio > 1.5
                ? "muted"
                : "bull"
          }
        />
        <StatCard
          icon={Loader2}
          label="Tempo"
          value={`${(wf.durationMs / 1000).toFixed(1)}s`}
          sub={`${a.totalFolds} folds processados`}
          tone="muted"
        />
      </div>

      {/* Stitched OOS equity */}
      {a.stitchedOos.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Equity OOS Costurada</CardTitle>
            <CardDescription>
              Janelas OOS encadeadas — performance fora-da-amostra
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EquityCurve
              points={a.stitchedOos}
              initial={wf.backtest.initialEquity}
            />
          </CardContent>
        </Card>
      )}

      {/* Per-fold table */}
      <Card>
        <CardHeader className="pb-2">
          <button
            onClick={() => setFoldsOpen(!foldsOpen)}
            className="flex w-full items-center justify-between text-left"
          >
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                Folds ({wf.folds.length})
                {foldsOpen ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
              </CardTitle>
              <CardDescription>
                In-sample vs out-of-sample por janela
              </CardDescription>
            </div>
          </button>
        </CardHeader>
        {foldsOpen && (
          <CardContent className="p-0">
            <FoldsTable folds={wf.folds} />
          </CardContent>
        )}
      </Card>
    </div>
  );
}

function FoldsTable({
  folds,
}: {
  folds: import("@/lib/walk-forward").WalkForwardFold[];
}) {
  return (
    <div className="max-h-80 overflow-y-auto scrollbar-thin">
      <table className="w-full text-[11px]">
        <thead className="sticky top-0 bg-sidebar text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-2 py-1.5 text-left">#</th>
            <th className="px-2 py-1.5 text-left">Período OOS</th>
            <th className="px-2 py-1.5 text-right">Bars</th>
            <th className="px-2 py-1.5 text-right">IS P&L%</th>
            <th className="px-2 py-1.5 text-right">OOS P&L%</th>
            <th className="px-2 py-1.5 text-right">OOS WR</th>
            <th className="px-2 py-1.5 text-right">OOS PF</th>
            <th className="px-2 py-1.5 text-right">OOS DD%</th>
            <th className="px-2 py-1.5 text-right">OOS Trades</th>
            <th className="px-2 py-1.5 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {folds.map((f) => {
            const oos = f.outOfSample;
            const is = f.inSample;
            const isWin = oos.netPnlUsd > 0;
            const ratio =
              is.netPnlPct !== 0 ? Math.abs(oos.netPnlPct / is.netPnlPct) : 0;
            return (
              <tr
                key={f.index}
                className="border-t border-border/40 hover:bg-accent/30"
              >
                <td className="px-2 py-1 text-muted-foreground tabular">
                  {f.index + 1}
                </td>
                <td className="px-2 py-1 text-muted-foreground">
                  {new Date(f.testStart * 1000).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                  })}{" "}
                  →{" "}
                  {new Date(f.testEnd * 1000).toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                  })}
                </td>
                <td className="px-2 py-1 text-right tabular text-muted-foreground">
                  {f.bars.test}
                </td>
                <td
                  className={`px-2 py-1 text-right tabular ${is.netPnlPct >= 0 ? "text-bull" : "text-bear"}`}
                >
                  {is.netPnlPct >= 0 ? "+" : ""}
                  {is.netPnlPct.toFixed(2)}%
                </td>
                <td
                  className={`px-2 py-1 text-right tabular font-medium ${isWin ? "text-bull" : "text-bear"}`}
                >
                  {oos.netPnlPct >= 0 ? "+" : ""}
                  {oos.netPnlPct.toFixed(2)}%
                </td>
                <td className="px-2 py-1 text-right tabular">
                  {(oos.winRate * 100).toFixed(0)}%
                </td>
                <td className="px-2 py-1 text-right tabular">
                  {isFinite(oos.profitFactor)
                    ? oos.profitFactor.toFixed(2)
                    : "∞"}
                </td>
                <td className="px-2 py-1 text-right tabular text-bear">
                  -{oos.maxDrawdownPct.toFixed(2)}%
                </td>
                <td className="px-2 py-1 text-right tabular text-muted-foreground">
                  {oos.totalTrades}
                </td>
                <td className="px-2 py-1 text-center">
                  <Badge
                    className={
                      isWin ? "bg-bull/20 text-bull" : "bg-bear/20 text-bear"
                    }
                  >
                    {isWin ? "OK" : "FAIL"}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
