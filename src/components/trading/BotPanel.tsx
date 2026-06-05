import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Power,
  ShieldCheck,
  Wallet,
  Activity,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Zap,
  Target,
  Gauge,
  Flame,
  Snowflake,
  CircleDollarSign,
  BarChart3,
  Settings2,
} from "lucide-react";
import type { LocalSignal, IndicatorSnapshot } from "@/lib/indicators";
import type { AIDecision } from "@/lib/ai-signal.functions";
import {
  canOpenTrade,
  netPnl,
  planTrade,
  updateStops,
  type RiskSettings,
  DEFAULT_RISK,
} from "@/lib/risk";
import {
  computeMetrics,
  dailyPnl,
  equityCurve,
  type Metrics,
  type ClosedTrade,
} from "@/lib/performance";

export type Position = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  entry: number;
  qty: number;
  stop: number;
  initialStop: number;
  target: number;
  initialTarget: number;
  highWater: number; // best price since entry
  lowWater: number; // worst price since entry
  openedAt: number;
  closedAt?: number;
  exit?: number;
  pnl?: number;
  pnlNet?: number; // after fees
  reason?: string;
  closeReason?:
    | "TP"
    | "SL"
    | "TRAIL"
    | "BE"
    | "MANUAL"
    | "AI_CLOSE"
    | "INVERSE";
  atr?: number; // ATR at entry, for trailing ref
  aiConfidence?: number;
  aiRegime?: AIDecision["regime"];
  aiRationale?: string;
  rExpected?: number;
  invalidation?: string;
};

type Settings = {
  enabled: boolean;
  source: "AI" | "TECHNICAL" | "BOTH";
  aiWeight: number; // 0..100
  combinedThreshold: number; // 0..100
  minAIConfidence: number; // 0..100
  killSwitch: boolean; // manual emergency stop
  risk: RiskSettings;
};

const STORAGE_KEY = "robotrader:v2";

type State = {
  balance: number;
  initialBalance: number;
  positions: Position[];
  closedTrades: ClosedTrade[];
  settings: Settings;
  lastTradeAt: number; // global
  lastTradeBySymbol: Record<string, number>;
  lastDecisionLog: string[]; // for debugging
};

const defaultState: State = {
  balance: 10000,
  initialBalance: 10000,
  positions: [],
  closedTrades: [],
  settings: {
    enabled: false,
    source: "BOTH",
    aiWeight: 60,
    combinedThreshold: 45,
    minAIConfidence: 60,
    killSwitch: false,
    risk: { ...DEFAULT_RISK },
  },
  lastTradeAt: 0,
  lastTradeBySymbol: {},
  lastDecisionLog: [],
};

// Backwards-compat loader
function loadState(): State {
  if (typeof window === "undefined") return defaultState;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return migrate({ ...defaultState, ...parsed });
    }
    // try old v1 key
    const old = localStorage.getItem("robotrader:v1");
    if (old) {
      const parsed = JSON.parse(old);
      return migrate({
        ...defaultState,
        balance: parsed.balance ?? defaultState.balance,
        initialBalance:
          parsed.initialBalance ??
          parsed.balance ??
          defaultState.initialBalance,
        positions: (parsed.positions ?? []).map((p: Position) => ({
          ...p,
          initialStop: p.stop,
          initialTarget: p.target,
          highWater: p.entry,
          lowWater: p.entry,
        })),
        settings: {
          ...defaultState.settings,
          ...(parsed.settings ?? {}),
          risk: { ...DEFAULT_RISK, ...(parsed.settings?.risk ?? {}) },
        },
        closedTrades: [],
        lastTradeAt: 0,
        lastTradeBySymbol: {},
        lastDecisionLog: [],
      });
    }
  } catch {
    /* noop */
  }
  return defaultState;
}

function migrate(s: State): State {
  // Ensure all positions have new fields
  s.positions = s.positions.map((p) => ({
    ...p,
    initialStop: p.initialStop ?? p.stop,
    initialTarget: p.initialTarget ?? p.target,
    highWater: p.highWater ?? p.entry,
    lowWater: p.lowWater ?? p.entry,
  }));
  s.closedTrades = s.closedTrades ?? [];
  s.lastTradeAt = s.lastTradeAt ?? 0;
  s.lastTradeBySymbol = s.lastTradeBySymbol ?? {};
  s.lastDecisionLog = s.lastDecisionLog ?? [];
  s.settings.risk = { ...DEFAULT_RISK, ...(s.settings.risk ?? {}) };
  s.settings.killSwitch = s.settings.killSwitch ?? false;
  return s;
}

export function BotPanel({
  symbol,
  price,
  local,
  ai,
  snapshot,
  manualOrder,
}: {
  symbol: string;
  price: number;
  local: LocalSignal;
  ai: AIDecision | null;
  snapshot: IndicatorSnapshot | null;
  manualOrder: { side: "BUY" | "SELL"; decision?: AIDecision } | null;
}) {
  const [state, setState] = useState<State>(defaultState);
  const [showRisk, setShowRisk] = useState(false);
  useEffect(() => {
    setState(loadState());
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined")
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  // Update open positions: PnL, HWM/LWM, trailing stop
  useEffect(() => {
    if (!price) return;
    setState((s) => {
      let balance = s.balance;
      const positions = s.positions.map((p) => {
        if (p.closedAt) return p;
        const dir = p.side === "BUY" ? 1 : -1;
        const pnl = (price - p.entry) * p.qty * dir;
        const hwm = Math.max(p.highWater, price);
        const lwm = Math.min(p.lowWater, price);

        // Update trailing / breakeven stops
        const atr =
          snapshot?.atr ??
          p.atr ??
          Math.abs(p.entry - p.initialStop) /
            Math.max(1, s.settings.risk.atrMultiplierSL);
        const ref = p.side === "BUY" ? hwm : lwm;
        const upd = updateStops({
          side: p.side,
          entry: p.entry,
          initialStop: p.initialStop,
          initialTP: p.initialTarget,
          currentPrice: price,
          atr,
          highWaterMark: ref,
          settings: s.settings.risk,
        });

        const effectiveStop = upd.stop;
        const effectiveTarget = upd.target;
        const hitStop =
          p.side === "BUY" ? price <= effectiveStop : price >= effectiveStop;
        const hitTarget =
          p.side === "BUY"
            ? price >= effectiveTarget
            : price <= effectiveTarget;

        if (hitStop || hitTarget) {
          const exit = price;
          const gross = (exit - p.entry) * p.qty * dir;
          const feeCost =
            (p.entry * p.qty + exit * p.qty) * (s.settings.risk.feePct / 100);
          const pnlNet = gross - feeCost;
          balance += pnlNet;
          const closeReason: Position["closeReason"] = hitTarget
            ? "TP"
            : effectiveStop > p.initialStop
              ? "TRAIL"
              : effectiveStop !== p.initialStop
                ? "BE"
                : "SL";
          return {
            ...p,
            closedAt: Date.now(),
            exit,
            pnl: gross,
            pnlNet,
            stop: effectiveStop,
            target: effectiveTarget,
            highWater: hwm,
            lowWater: lwm,
            closeReason,
            reason: hitTarget
              ? `TP @ ${effectiveTarget.toFixed(2)}`
              : `${closeReason} @ ${effectiveStop.toFixed(2)}`,
          };
        }

        return {
          ...p,
          pnl,
          stop: effectiveStop,
          target: effectiveTarget,
          highWater: hwm,
          lowWater: lwm,
        };
      });

      // Persist newly-closed trades
      const newlyClosed = positions.filter(
        (p) =>
          p.closedAt &&
          !s.positions.find((sp) => sp.id === p.id && sp.closedAt),
      );
      const closedTrades =
        newlyClosed.length > 0
          ? [
              ...newlyClosed.map((p) => ({
                id: p.id,
                symbol: p.symbol,
                side: p.side,
                entry: p.entry,
                exit: p.exit ?? price,
                qty: p.qty,
                pnl: p.pnlNet ?? p.pnl ?? 0,
                openedAt: p.openedAt,
                closedAt: p.closedAt ?? Date.now(),
                reason: p.closeReason ?? p.reason ?? "Unknown",
              })),
              ...s.closedTrades,
            ].slice(0, 500)
          : s.closedTrades;

      return { ...s, balance, positions, closedTrades };
    });
  }, [price, snapshot?.atr]);

  // Auto-trading logic
  const lastTradeRef = useRef<number>(0);
  useEffect(() => {
    if (!state.settings.enabled) return;
    if (state.settings.killSwitch) return;
    if (!snapshot) return;
    if (Date.now() - lastTradeRef.current < 5000) return;

    const openForSymbol = state.positions.find(
      (p) => !p.closedAt && p.symbol === symbol,
    );
    if (openForSymbol) return;

    // AI suggests CLOSE for an existing open position (across symbols)
    if (ai?.action === "CLOSE") {
      // We do not auto-close cross-symbol positions here — leave to AI panel
      return;
    }

    // Combined score
    const techScore = local.score; // -100..100
    const aiSign = ai?.action === "BUY" ? 1 : ai?.action === "SELL" ? -1 : 0;
    const aiScore = ai ? aiSign * ai.confidence : 0;

    const techOK = state.settings.source !== "AI" && Math.abs(techScore) >= 40;
    const aiOK =
      state.settings.source !== "TECHNICAL" &&
      ai &&
      ai.action !== "HOLD" &&
      ai.confidence >= state.settings.minAIConfidence;

    let side: "BUY" | "SELL" | null = null;
    let decision: AIDecision | null = null;
    if (state.settings.source === "AI" && aiOK && ai) {
      side = ai.action as "BUY" | "SELL";
      decision = ai;
    } else if (state.settings.source === "TECHNICAL" && techOK) {
      side =
        local.action === "BUY"
          ? "BUY"
          : local.action === "SELL"
            ? "SELL"
            : null;
    } else if (state.settings.source === "BOTH") {
      const w = state.settings.aiWeight / 100;
      const combined = w * aiScore + (1 - w) * techScore;
      const aiMinOk =
        !ai ||
        ai.action === "HOLD" ||
        ai.confidence >= state.settings.minAIConfidence;
      if (aiMinOk && Math.abs(combined) >= state.settings.combinedThreshold) {
        side = combined > 0 ? "BUY" : "SELL";
        if (
          ai &&
          ai.action !== "HOLD" &&
          (combined > 0 ? ai.action === "BUY" : ai.action === "SELL")
        ) {
          decision = ai;
        }
      }
    }

    if (!side) return;

    // Risk guard
    const equity =
      state.balance +
      state.positions
        .filter((p) => !p.closedAt)
        .reduce((s2, p) => s2 + (p.pnl ?? 0), 0);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const guard = canOpenTrade({
      openPositions: state.positions.filter((p) => !p.closedAt).length,
      settings: state.settings.risk,
      equity,
      initialEquity: state.initialBalance,
      dailyPnl: dailyPnl(state.closedTrades, todayStart.getTime()),
      lastTradeAt: state.lastTradeAt,
      symbol,
      lastTradeBySymbol: state.lastTradeBySymbol,
      killSwitch: state.settings.killSwitch,
    });
    if (!guard.allowed) {
      setState((s) => ({
        ...s,
        lastDecisionLog: [
          `${new Date().toLocaleTimeString()} ${symbol} ${side} bloqueado: ${guard.reason}`,
          ...s.lastDecisionLog,
        ].slice(0, 20),
      }));
      return;
    }

    openPosition(side, decision, snapshot, equity);
    lastTradeRef.current = Date.now();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.settings.enabled,
    state.settings.killSwitch,
    state.settings.source,
    state.settings.aiWeight,
    state.settings.combinedThreshold,
    state.settings.minAIConfidence,
    ai?.action,
    ai?.confidence,
    local.action,
    local.score,
    symbol,
    snapshot,
  ]);

  // Manual orders from AI panel
  const manualRef = useRef(manualOrder);
  useEffect(() => {
    if (!manualOrder || manualOrder === manualRef.current) return;
    manualRef.current = manualOrder;
    openPosition(
      manualOrder.side,
      manualOrder.decision ?? null,
      snapshot,
      state.balance,
    );
  }, [manualOrder]); // eslint-disable-line react-hooks/exhaustive-deps

  function openPosition(
    side: "BUY" | "SELL",
    decision: AIDecision | null,
    snap: IndicatorSnapshot | null,
    equity: number,
  ) {
    setState((s) => {
      const plan = snap
        ? planTrade({
            side,
            entry: price,
            snapshot: snap,
            equity,
            settings: s.settings.risk,
            aiStop: decision?.stopLoss,
            aiTP: decision?.takeProfit,
            aiConfidence: decision?.confidence,
          })
        : {
            stop: side === "BUY" ? price * 0.98 : price * 1.02,
            target: side === "BUY" ? price * 1.04 : price * 0.96,
            risk: price * 0.02,
            reward: price * 0.04,
            rr: 2,
            qty: 0.001,
            qtyUsd: price * 0.001,
            riskUsd: s.balance * 0.01,
            reason: "Fallback",
          };

      const pos: Position = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        symbol,
        side,
        entry: price,
        qty: Math.max(plan.qty, 0.0001),
        stop: plan.stop,
        initialStop: plan.stop,
        target: plan.target,
        initialTarget: plan.target,
        highWater: price,
        lowWater: price,
        openedAt: Date.now(),
        atr: snap?.atr ?? undefined,
        aiConfidence: decision?.confidence,
        aiRegime: decision?.regime,
        aiRationale: decision?.rationale,
        rExpected: plan.rr,
        invalidation: decision?.invalidation,
      };

      return {
        ...s,
        positions: [pos, ...s.positions],
        lastTradeAt: Date.now(),
        lastTradeBySymbol: { ...s.lastTradeBySymbol, [symbol]: Date.now() },
        lastDecisionLog: [
          `${new Date().toLocaleTimeString()} ${symbol} ${side} @ ${price.toFixed(2)} | SL ${plan.stop.toFixed(2)} TP ${plan.target.toFixed(2)} RR ${plan.rr.toFixed(2)} | ${plan.reason}`,
          ...s.lastDecisionLog,
        ].slice(0, 30),
      };
    });
  }

  function closePosition(id: string) {
    setState((s) => {
      let balance = s.balance;
      const positions = s.positions.map((p) => {
        if (p.id !== id || p.closedAt) return p;
        const dir = p.side === "BUY" ? 1 : -1;
        const gross = (price - p.entry) * p.qty * dir;
        const pnlNet = netPnl({
          entry: p.entry,
          exit: price,
          qty: p.qty,
          side: p.side,
          feePct: s.settings.risk.feePct,
        });
        balance += pnlNet;
        return {
          ...p,
          closedAt: Date.now(),
          exit: price,
          pnl: gross,
          pnlNet,
          closeReason: "MANUAL" as const,
          reason: "Manual",
        };
      });
      const newlyClosed = positions.find(
        (p) =>
          p.id === id &&
          p.closedAt &&
          !s.positions.find((sp) => sp.id === p.id && sp.closedAt),
      );
      const closedTrades =
        newlyClosed && newlyClosed.closedAt
          ? [
              {
                id: newlyClosed.id,
                symbol: newlyClosed.symbol,
                side: newlyClosed.side,
                entry: newlyClosed.entry,
                exit: newlyClosed.exit ?? price,
                qty: newlyClosed.qty,
                pnl: newlyClosed.pnlNet ?? 0,
                openedAt: newlyClosed.openedAt,
                closedAt: newlyClosed.closedAt,
                reason: "MANUAL",
              },
              ...s.closedTrades,
            ]
          : s.closedTrades;
      return { ...s, balance, positions, closedTrades };
    });
  }

  function resetAccount() {
    if (!confirm("Resetar conta simulada para $10.000?")) return;
    setState(defaultState);
  }

  function clearHistory() {
    if (!confirm("Limpar histórico de trades? Posições abertas permanecem."))
      return;
    setState((s) => ({ ...s, closedTrades: [] }));
  }

  // Derived metrics
  const openPositions = state.positions.filter((p) => !p.closedAt);
  const closedTrades = state.closedTrades;
  const floatingPnl = openPositions.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const equity = state.balance + floatingPnl;
  const totalPnl = equity - state.initialBalance;
  const totalPnlPct = (totalPnl / state.initialBalance) * 100;
  const drawdownPct =
    ((state.initialBalance - equity) / state.initialBalance) * 100;
  const todayStart = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);
  const todayPnl = dailyPnl(closedTrades, todayStart);
  const todayPnlPct = (todayPnl / state.initialBalance) * 100;
  const metrics: Metrics = useMemo(
    () => computeMetrics(closedTrades, state.initialBalance),
    [closedTrades, state.initialBalance],
  );
  const eqCurve = useMemo(
    () => equityCurve(closedTrades, state.initialBalance),
    [closedTrades, state.initialBalance],
  );

  const drawdownBreach = drawdownPct >= state.settings.risk.maxDrawdownPct;
  const dailyBreach =
    Math.abs(todayPnlPct) >= state.settings.risk.maxDailyLossPct &&
    todayPnlPct < 0;
  const breakerActive =
    state.settings.killSwitch || drawdownBreach || dailyBreach;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Bot className="size-3.5 text-primary" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Robô · Paper trading
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowRisk((v) => !v)}
            className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] uppercase tracking-wider transition ${
              showRisk
                ? "bg-primary text-primary-foreground"
                : "bg-accent text-muted-foreground hover:bg-accent/70"
            }`}
            title="Configurações de risco"
          >
            <Settings2 className="size-3" />
          </button>
          <button
            onClick={() =>
              setState((s) => ({
                ...s,
                settings: {
                  ...s.settings,
                  killSwitch: !s.settings.killSwitch,
                  enabled: s.settings.killSwitch ? s.settings.enabled : false,
                },
              }))
            }
            className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${
              state.settings.killSwitch
                ? "bg-bear text-background glow-bear"
                : "bg-accent text-muted-foreground hover:bg-accent/70"
            }`}
            title="Kill switch — fecha tudo e bloqueia novas entradas"
          >
            <AlertTriangle className="size-3" />
            {state.settings.killSwitch ? "KILL" : "OK"}
          </button>
          <button
            onClick={() =>
              setState((s) => ({
                ...s,
                settings: { ...s.settings, enabled: !s.settings.enabled },
              }))
            }
            className={`flex items-center gap-1.5 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${
              state.settings.enabled
                ? "bg-bull text-background glow-bull"
                : "bg-accent text-muted-foreground"
            }`}
          >
            <Power className="size-3" />{" "}
            {state.settings.enabled ? "Ativo" : "Pausado"}
            {state.settings.enabled && (
              <span className="pulse-dot ml-0.5 size-1.5 rounded-full bg-background" />
            )}
          </button>
        </div>
      </div>

      <div className="space-y-3 overflow-y-auto p-3 scrollbar-thin">
        {/* Equity card */}
        <div className="rounded-md border border-border bg-gradient-to-br from-surface to-surface-2 p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Wallet className="size-3" /> Equity
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={clearHistory}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                limpar hist.
              </button>
              <button
                onClick={resetAccount}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                reset
              </button>
            </div>
          </div>
          <div className="mt-1 flex items-baseline gap-2 tabular">
            <span className="text-2xl font-bold text-foreground">
              ${equity.toFixed(2)}
            </span>
            <span
              className={`text-xs font-semibold ${totalPnl >= 0 ? "text-bull" : "text-bear"}`}
            >
              {totalPnl >= 0 ? "+" : ""}
              {totalPnlPct.toFixed(2)}%
            </span>
          </div>
          <EquitySpark points={eqCurve} />
          <div className="mt-2 grid grid-cols-4 gap-1.5 text-[10px]">
            <Mini label="Saldo" value={`$${state.balance.toFixed(0)}`} />
            <Mini
              label="Abertas"
              value={openPositions.length}
              tone={openPositions.length > 0 ? "warn" : undefined}
            />
            <Mini
              label="Hoje"
              value={`${todayPnl >= 0 ? "+" : ""}$${todayPnl.toFixed(0)}`}
              tone={todayPnl > 0 ? "bull" : todayPnl < 0 ? "bear" : undefined}
              hint={`${todayPnlPct.toFixed(1)}%`}
            />
            <Mini
              label="DD"
              value={`${drawdownPct.toFixed(1)}%`}
              tone={drawdownBreach ? "bear" : drawdownPct > 5 ? "warn" : "bull"}
              hint={`max ${state.settings.risk.maxDrawdownPct}%`}
            />
          </div>
          {breakerActive && (
            <div className="mt-2 flex items-center gap-1.5 rounded border border-bear/40 bg-bear/10 px-2 py-1.5 text-[10px] text-bear">
              <AlertTriangle className="size-3" />
              <span>
                {state.settings.killSwitch
                  ? "Kill switch ativo — bot pausado"
                  : drawdownBreach
                    ? `Drawdown máximo (${drawdownPct.toFixed(1)}%) atingido — bot pausado`
                    : `Perda diária máxima (${todayPnlPct.toFixed(1)}%) atingida — bot pausado`}
              </span>
            </div>
          )}
        </div>

        {/* Performance metrics */}
        {closedTrades.length > 0 && (
          <div className="rounded-md border border-border bg-surface p-3">
            <div className="mb-2 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <BarChart3 className="size-3" /> Performance
            </div>
            <div className="grid grid-cols-3 gap-1.5 text-[10px]">
              <Mini label="Trades" value={metrics.totalTrades} />
              <Mini
                label="Win rate"
                value={`${metrics.winRate.toFixed(0)}%`}
                tone={metrics.winRate >= 50 ? "bull" : "bear"}
                hint={`${metrics.wins}W/${metrics.losses}L`}
              />
              <Mini
                label="PF"
                value={
                  isFinite(metrics.profitFactor)
                    ? metrics.profitFactor.toFixed(2)
                    : "∞"
                }
                tone={
                  metrics.profitFactor >= 1.5
                    ? "bull"
                    : metrics.profitFactor < 1
                      ? "bear"
                      : "warn"
                }
                hint="profit factor"
              />
              <Mini
                label="Expect."
                value={`${metrics.expectancy >= 0 ? "+" : ""}$${metrics.expectancy.toFixed(2)}`}
                tone={metrics.expectancy > 0 ? "bull" : "bear"}
              />
              <Mini
                label="Sharpe"
                value={metrics.sharpe.toFixed(2)}
                tone={
                  metrics.sharpe >= 1
                    ? "bull"
                    : metrics.sharpe < 0
                      ? "bear"
                      : undefined
                }
              />
              <Mini
                label="Payoff"
                value={metrics.payoffRatio.toFixed(2)}
                tone={
                  metrics.payoffRatio >= 1.5
                    ? "bull"
                    : metrics.payoffRatio < 1
                      ? "bear"
                      : undefined
                }
                hint="avg W / |L|"
              />
              <Mini
                label="Melhor"
                value={`+$${metrics.bestTrade.toFixed(0)}`}
                tone="bull"
              />
              <Mini
                label="Pior"
                value={`-$${Math.abs(metrics.worstTrade).toFixed(0)}`}
                tone="bear"
              />
              <Mini
                label="Streak"
                value={
                  metrics.currentStreak > 0
                    ? `${metrics.currentStreak}W`
                    : `${Math.abs(metrics.currentStreak)}L`
                }
                tone={metrics.currentStreak > 0 ? "bull" : "bear"}
              />
            </div>
          </div>
        )}

        {/* Settings */}
        <div className="rounded-md border border-border bg-surface p-3 space-y-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            <ShieldCheck className="size-3" /> Estratégia
          </div>
          <div>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Fonte de sinais
            </div>
            <div className="grid grid-cols-3 gap-1">
              {(["AI", "TECHNICAL", "BOTH"] as const).map((opt) => (
                <button
                  key={opt}
                  onClick={() =>
                    setState((s) => ({
                      ...s,
                      settings: { ...s.settings, source: opt },
                    }))
                  }
                  className={`rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition ${
                    state.settings.source === opt
                      ? "bg-primary text-primary-foreground"
                      : "bg-accent text-muted-foreground hover:bg-accent/70"
                  }`}
                >
                  {opt === "AI"
                    ? "IA"
                    : opt === "TECHNICAL"
                      ? "Técnico"
                      : "Ambos"}
                </button>
              ))}
            </div>
          </div>

          {state.settings.source !== "TECHNICAL" && (
            <Slider
              label="Confiança mín. IA"
              value={state.settings.minAIConfidence}
              min={30}
              max={95}
              step={5}
              suffix="%"
              onChange={(v) =>
                setState((s) => ({
                  ...s,
                  settings: { ...s.settings, minAIConfidence: v },
                }))
              }
            />
          )}

          {state.settings.source === "BOTH" && (
            <BOTHPreview
              aiWeight={state.settings.aiWeight}
              onWeight={(w) =>
                setState((s) => ({
                  ...s,
                  settings: { ...s.settings, aiWeight: w },
                }))
              }
              threshold={state.settings.combinedThreshold}
              onThreshold={(t) =>
                setState((s) => ({
                  ...s,
                  settings: { ...s.settings, combinedThreshold: t },
                }))
              }
              localScore={local.score}
              aiScore={
                ai
                  ? (ai.action === "BUY" ? 1 : ai.action === "SELL" ? -1 : 0) *
                    ai.confidence
                  : 0
              }
            />
          )}
        </div>

        {/* Risk settings (collapsible) */}
        {showRisk && (
          <div className="rounded-md border border-border bg-surface p-3 space-y-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Gauge className="size-3" /> Risco & Exposição
            </div>
            <Slider
              label="Risco por trade"
              value={state.settings.risk.riskPerTradePct}
              min={0.1}
              max={5}
              step={0.1}
              suffix="%"
              onChange={(v) =>
                setState((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    risk: { ...s.settings.risk, riskPerTradePct: v },
                  },
                }))
              }
            />
            <Slider
              label="Máx posições abertas"
              value={state.settings.risk.maxPositions}
              min={1}
              max={10}
              step={1}
              onChange={(v) =>
                setState((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    risk: { ...s.settings.risk, maxPositions: v },
                  },
                }))
              }
            />
            <Slider
              label="Perda diária máx."
              value={state.settings.risk.maxDailyLossPct}
              min={1}
              max={20}
              step={1}
              suffix="%"
              onChange={(v) =>
                setState((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    risk: { ...s.settings.risk, maxDailyLossPct: v },
                  },
                }))
              }
            />
            <Slider
              label="Drawdown máximo"
              value={state.settings.risk.maxDrawdownPct}
              min={5}
              max={50}
              step={5}
              suffix="%"
              onChange={(v) =>
                setState((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    risk: { ...s.settings.risk, maxDrawdownPct: v },
                  },
                }))
              }
            />
            <Slider
              label="Stop ATR ×"
              value={state.settings.risk.atrMultiplierSL}
              min={0.8}
              max={4}
              step={0.1}
              onChange={(v) =>
                setState((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    risk: { ...s.settings.risk, atrMultiplierSL: v },
                  },
                }))
              }
            />
            <Slider
              label="TP ATR ×"
              value={state.settings.risk.atrMultiplierTP}
              min={1.0}
              max={6}
              step={0.1}
              onChange={(v) =>
                setState((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    risk: { ...s.settings.risk, atrMultiplierTP: v },
                  },
                }))
              }
            />
            <Slider
              label="Breakeven após R"
              value={state.settings.risk.breakevenAfterRR}
              min={0.3}
              max={2}
              step={0.1}
              onChange={(v) =>
                setState((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    risk: { ...s.settings.risk, breakevenAfterRR: v },
                  },
                }))
              }
            />
            <Slider
              label="Trailing ativa em R"
              value={state.settings.risk.trailingActivationRR}
              min={0.5}
              max={3}
              step={0.1}
              onChange={(v) =>
                setState((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    risk: { ...s.settings.risk, trailingActivationRR: v },
                  },
                }))
              }
            />
            <Slider
              label="Trailing distância ATR ×"
              value={state.settings.risk.trailingDistanceATR}
              min={0.5}
              max={3}
              step={0.1}
              onChange={(v) =>
                setState((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    risk: { ...s.settings.risk, trailingDistanceATR: v },
                  },
                }))
              }
            />
            <Slider
              label="Cooldown (s)"
              value={state.settings.risk.cooldownMs / 1000}
              min={10}
              max={600}
              step={10}
              onChange={(v) =>
                setState((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    risk: { ...s.settings.risk, cooldownMs: v * 1000 },
                  },
                }))
              }
            />
            <Slider
              label="Fee estimada %"
              value={state.settings.risk.feePct}
              min={0}
              max={0.5}
              step={0.01}
              suffix="%"
              onChange={(v) =>
                setState((s) => ({
                  ...s,
                  settings: {
                    ...s.settings,
                    risk: { ...s.settings.risk, feePct: v },
                  },
                }))
              }
            />
          </div>
        )}

        {/* Open Positions */}
        <div className="rounded-md border border-border bg-surface">
          <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Activity className="size-3" /> Posições abertas (
            {openPositions.length})
          </div>
          {openPositions.length === 0 ? (
            <div className="p-3 text-[11px] text-muted-foreground">
              Nenhuma posição aberta.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {openPositions.map((p) => (
                <PositionCard
                  key={p.id}
                  pos={p}
                  price={price}
                  onClose={() => closePosition(p.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Decision log (debug) */}
        {state.lastDecisionLog.length > 0 && (
          <div className="rounded-md border border-border bg-surface">
            <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              Últimas decisões
            </div>
            <div className="max-h-32 overflow-y-auto p-2 scrollbar-thin">
              {state.lastDecisionLog.slice(0, 8).map((l, i) => (
                <div
                  key={i}
                  className="border-b border-border/40 py-1 font-mono text-[10px] text-muted-foreground last:border-0"
                >
                  {l}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* History */}
        {closedTrades.length > 0 && (
          <div className="rounded-md border border-border bg-surface">
            <div className="border-b border-border px-3 py-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              Histórico ({closedTrades.length})
            </div>
            <div className="max-h-48 divide-y divide-border overflow-y-auto scrollbar-thin">
              {closedTrades.slice(0, 30).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between px-3 py-1.5 text-[11px]"
                >
                  <span
                    className={p.side === "BUY" ? "text-bull" : "text-bear"}
                  >
                    {p.side} {p.symbol.replace("USDT", "")}
                  </span>
                  <span className="text-muted-foreground tabular">
                    {p.reason}
                  </span>
                  <span
                    className={`tabular font-semibold ${p.pnl >= 0 ? "text-bull" : "text-bear"}`}
                  >
                    {p.pnl >= 0 ? "+" : ""}${p.pnl.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PositionCard({
  pos,
  price,
  onClose,
}: {
  pos: Position;
  price: number;
  onClose: () => void;
}) {
  const dir = pos.side === "BUY" ? 1 : -1;
  const pnl = pos.pnl ?? (price - pos.entry) * pos.qty * dir;
  const pnlPct = ((price - pos.entry) / pos.entry) * 100 * dir;
  const initialRisk = Math.abs(pos.entry - pos.initialStop);
  const move = (price - pos.entry) * dir;
  const rMultiple = initialRisk > 0 ? move / initialRisk : 0;
  const isBE =
    pos.stop !== pos.initialStop &&
    pos.stop > Math.min(pos.entry, pos.initialStop) &&
    pos.stop < Math.max(pos.entry, pos.initialStop);
  const isTrail =
    pos.side === "BUY"
      ? pos.stop > pos.initialStop
      : pos.stop < pos.initialStop;
  const distStop = pos.side === "BUY" ? price - pos.stop : pos.stop - price;
  const distTp = pos.side === "BUY" ? pos.target - price : price - pos.target;

  return (
    <div className="p-3 text-[11px]">
      <div className="flex items-center justify-between">
        <span
          className={`flex items-center gap-1 font-semibold ${pos.side === "BUY" ? "text-bull" : "text-bear"}`}
        >
          {pos.side === "BUY" ? (
            <TrendingUp className="size-3" />
          ) : (
            <TrendingDown className="size-3" />
          )}
          {pos.symbol.replace("USDT", "")}
        </span>
        <span
          className={`tabular font-semibold ${pnl >= 0 ? "text-bull" : "text-bear"}`}
        >
          {pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} ({pnlPct >= 0 ? "+" : ""}
          {pnlPct.toFixed(2)}%)
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground">
        {isTrail ? (
          <span className="flex items-center gap-0.5 rounded bg-primary/15 px-1 py-0.5 text-primary">
            <Zap className="size-2.5" /> Trailing
          </span>
        ) : isBE ? (
          <span className="flex items-center gap-0.5 rounded bg-accent px-1 py-0.5 text-foreground">
            <Target className="size-2.5" /> Breakeven
          </span>
        ) : (
          <span className="flex items-center gap-0.5 rounded bg-accent px-1 py-0.5 text-muted-foreground">
            <CircleDollarSign className="size-2.5" /> Fixo
          </span>
        )}
        {pos.aiRegime && (
          <span className="rounded bg-accent px-1 py-0.5">{pos.aiRegime}</span>
        )}
        <span className="ml-auto tabular text-foreground">
          R = {rMultiple.toFixed(2)}
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-1 text-[10px] tabular text-muted-foreground">
        <span>Entry {pos.entry.toFixed(2)}</span>
        <span className="text-bear">
          SL {pos.stop.toFixed(2)} ({distStop >= 0 ? "+" : ""}
          {distStop.toFixed(2)})
        </span>
        <span className="text-bull">
          TP {pos.target.toFixed(2)} ({distTp >= 0 ? "+" : ""}
          {distTp.toFixed(2)})
        </span>
      </div>
      {pos.aiRationale && (
        <div className="mt-1.5 text-[10px] italic text-muted-foreground">
          IA: {pos.aiRationale}
        </div>
      )}
      <button
        onClick={onClose}
        className="mt-2 w-full rounded bg-accent px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-accent/70"
      >
        Fechar a mercado
      </button>
    </div>
  );
}

function EquitySpark({ points }: { points: { t: number; equity: number }[] }) {
  if (points.length < 2) {
    return <div className="mt-2 h-8 rounded bg-accent/40" />;
  }
  const w = 240;
  const h = 32;
  const min = Math.min(...points.map((p) => p.equity));
  const max = Math.max(...points.map((p) => p.equity));
  const range = max - min || 1;
  const stepX = w / (points.length - 1);
  const path = points
    .map((p, i) => {
      const x = i * stepX;
      const y = h - ((p.equity - min) / range) * h;
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
  const fillPath = `${path} L ${w} ${h} L 0 ${h} Z`;
  const up = points[points.length - 1].equity >= points[0].equity;
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="mt-2 h-8 w-full"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="eqgrad" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor={up ? "var(--bull)" : "var(--bear)"}
            stopOpacity="0.4"
          />
          <stop
            offset="100%"
            stopColor={up ? "var(--bull)" : "var(--bear)"}
            stopOpacity="0"
          />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#eqgrad)" />
      <path
        d={path}
        fill="none"
        stroke={up ? "var(--bull)" : "var(--bear)"}
        strokeWidth="1.5"
      />
    </svg>
  );
}

function BOTHPreview({
  aiWeight,
  onWeight,
  threshold,
  onThreshold,
  localScore,
  aiScore,
}: {
  aiWeight: number;
  onWeight: (v: number) => void;
  threshold: number;
  onThreshold: (v: number) => void;
  localScore: number;
  aiScore: number;
}) {
  const w = aiWeight;
  const combined = (w / 100) * aiScore + ((100 - w) / 100) * localScore;
  const fires = Math.abs(combined) >= threshold;
  const side = combined > 0 ? "BUY" : combined < 0 ? "SELL" : "—";
  return (
    <div className="rounded border border-border bg-background/40 p-2 space-y-3">
      <div>
        <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Peso IA vs Técnico</span>
          <span className="tabular text-foreground">
            IA {w}% · Téc {100 - w}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={w}
          onChange={(e) => onWeight(parseInt(e.target.value))}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-accent accent-primary"
        />
      </div>
      <Slider
        label="Limiar combinado"
        value={threshold}
        min={10}
        max={90}
        step={5}
        onChange={onThreshold}
      />
      <div className="grid grid-cols-3 gap-1 text-[10px]">
        <Mini
          label="Téc"
          value={localScore.toFixed(0)}
          tone={localScore > 0 ? "bull" : localScore < 0 ? "bear" : undefined}
        />
        <Mini
          label="IA"
          value={aiScore.toFixed(0)}
          tone={aiScore > 0 ? "bull" : aiScore < 0 ? "bear" : undefined}
        />
        <Mini
          label="Score"
          value={combined.toFixed(0)}
          tone={combined > 0 ? "bull" : combined < 0 ? "bear" : undefined}
        />
      </div>
      <div
        className={`rounded px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-wider ${
          fires
            ? combined > 0
              ? "bg-bull/20 text-bull"
              : "bg-bear/20 text-bear"
            : "bg-accent text-muted-foreground"
        }`}
      >
        {fires ? `Dispararia ${side}` : "Aguardando limiar"}
      </div>
    </div>
  );
}

function Mini({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string | number;
  tone?: "bull" | "bear" | "warn";
  hint?: string;
}) {
  const t =
    tone === "bull"
      ? "text-bull"
      : tone === "bear"
        ? "text-bear"
        : tone === "warn"
          ? "text-[color:var(--warning)]"
          : "text-foreground";
  return (
    <div className="rounded border border-border bg-background/40 px-2 py-1">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`tabular text-xs font-semibold ${t}`}>{value}</div>
      {hint && <div className="text-[9px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        <span className="tabular text-foreground">
          {value}
          {suffix}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-accent accent-primary"
      />
    </div>
  );
}
