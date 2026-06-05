import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  Waves,
  Layers,
  RefreshCw,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchKlines, type Interval, type Kline } from "@/lib/binance";
import { type IndicatorSnapshot } from "@/lib/indicators";
import { regimeHistory, type Regime } from "@/lib/regime";

const REGIME_META: Record<
  Regime,
  { label: string; color: string; bg: string; Icon: typeof TrendingUp }
> = {
  BULL_TREND: {
    label: "Tendência Alta",
    color: "text-bull",
    bg: "bg-bull/15 border-bull/40",
    Icon: TrendingUp,
  },
  BEAR_TREND: {
    label: "Tendência Baixa",
    color: "text-bear",
    bg: "bg-bear/15 border-bear/40",
    Icon: TrendingDown,
  },
  RANGE: {
    label: "Lateralização",
    color: "text-muted-foreground",
    bg: "bg-muted/20 border-border",
    Icon: Minus,
  },
  VOLATILE: {
    label: "Volatilidade",
    color: "text-warn",
    bg: "bg-warn/15 border-warn/40",
    Icon: Waves,
  },
};

const HISTORY_BARS = 100;
const HISTORY_INTERVAL_MS = 60_000;

export function RegimeDetector({
  symbol,
  interval,
  snap,
}: {
  symbol: string;
  interval: Interval;
  snap: IndicatorSnapshot | null;
}) {
  const [history, setHistory] = useState<
    { time: number; regime: Regime; confidence: number }[]
  >([]);
  const [barsInRegime, setBarsInRegime] = useState(0);
  const [loading, setLoading] = useState(false);

  // Use the LIVE snapshot for the headline regime so it tracks the
  // dashboard's indicator refresh.
  const liveRegime = useMemo(() => {
    if (!snap) return null;
    return classifyHeadline(snap);
  }, [snap]);

  // Recompute history periodically (and when symbol/interval change)
  useEffect(() => {
    let alive = true;
    async function load() {
      setLoading(true);
      try {
        const klines: Kline[] = await fetchKlines(
          symbol,
          interval,
          HISTORY_BARS + 50,
        );
        if (!alive) return;
        const candles = klines.map((k) => ({
          time: k.time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
        }));
        const { history, current } = regimeHistory(candles, {
          historyBars: HISTORY_BARS,
        });
        setHistory(history);
        setBarsInRegime(current?.barsInRegime ?? 0);
      } catch {
        /* silent */
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    const t = setInterval(load, HISTORY_INTERVAL_MS * 5);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol, interval]);

  if (!liveRegime) {
    return (
      <Card className="flex h-full flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="size-3.5 text-primary" /> Regime
          </CardTitle>
          <CardDescription>aguardando indicadores…</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 items-center justify-center text-[10px] text-muted-foreground">
          <Activity className="mr-1 size-3 animate-pulse" /> calculando
        </CardContent>
      </Card>
    );
  }

  const meta = REGIME_META[liveRegime.regime];
  const Icon = meta.Icon;

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Layers className="size-3.5 text-primary" /> Regime de Mercado
        </CardTitle>
        <CardDescription>
          {liveRegime.regime === "BULL_TREND" ||
          liveRegime.regime === "BEAR_TREND"
            ? "Direção dominante com força"
            : liveRegime.regime === "RANGE"
              ? "Sem direção clara · compressão"
              : "Volatilidade elevada · cautela"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1 space-y-2.5 overflow-y-auto p-3 scrollbar-thin">
        {/* Headline */}
        <div className="flex items-center gap-2.5">
          <div
            className={`flex size-10 items-center justify-center rounded-md border ${meta.bg}`}
          >
            <Icon className={`size-5 ${meta.color}`} />
          </div>
          <div className="flex-1">
            <div className={`text-sm font-bold ${meta.color}`}>
              {meta.label}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <span>confiança {liveRegime.confidence.overall}%</span>
              <span>·</span>
              <span>{barsInRegime} barras</span>
              {loading && (
                <>
                  <span>·</span>
                  <RefreshCw className="size-2.5 animate-spin" />
                </>
              )}
            </div>
          </div>
        </div>

        {/* Confidence bars */}
        <div className="space-y-1">
          <ConfBar
            label="Tendência"
            value={liveRegime.confidence.trend}
            hint={liveRegime.diagnostics.emaStack}
          />
          <ConfBar
            label="Estrutura"
            value={liveRegime.confidence.structure}
            hint={liveRegime.diagnostics.structure}
          />
          <ConfBar
            label="Momentum"
            value={liveRegime.confidence.momentum}
            hint={
              liveRegime.diagnostics.rsi !== null
                ? `RSI ${liveRegime.diagnostics.rsi.toFixed(0)}`
                : "—"
            }
          />
          <ConfBar
            label="Volatilidade"
            value={liveRegime.confidence.volatility}
            hint={
              liveRegime.diagnostics.atrPct !== null
                ? `ATR ${(liveRegime.diagnostics.atrPct * 100).toFixed(2)}%`
                : "—"
            }
          />
        </div>

        {/* History strip */}
        {history.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
              <span>Histórico ({history.length})</span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-bull" /> bull
                <span className="size-1.5 rounded-full bg-bear" /> bear
                <span className="size-1.5 rounded-full bg-muted" /> range
                <span className="size-1.5 rounded-full bg-warn" /> vol
              </span>
            </div>
            <HistoryStrip history={history} />
          </div>
        )}

        {/* Diagnostics badges */}
        <div className="flex flex-wrap gap-1">
          {liveRegime.diagnostics.adx !== null && (
            <Badge variant="outline" className="text-[9px]">
              ADX {liveRegime.diagnostics.adx.toFixed(0)}
            </Badge>
          )}
          {liveRegime.diagnostics.bbWidth !== null && (
            <Badge variant="outline" className="text-[9px]">
              BB {(liveRegime.diagnostics.bbWidth * 100).toFixed(1)}%
            </Badge>
          )}
          {liveRegime.diagnostics.atrPct !== null && (
            <Badge variant="outline" className="text-[9px]">
              ATR% {(liveRegime.diagnostics.atrPct * 100).toFixed(2)}
            </Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function classifyHeadline(snap: IndicatorSnapshot) {
  // Reuse the same logic as classifyRegime but with a synthetic time
  // We import it from regime.ts indirectly via a direct call.
  // To avoid double import, inline a minimal version here.
  const trend = computeTrendBias(snap);
  const adxVal = snap.adx ?? 0;
  const diDom = (snap.plusDI ?? 0) - (snap.minusDI ?? 0);
  const emaStack = computeEmaStack(snap);

  let regime: Regime;
  if (snap.volRegime === "EXTREME" || (snap.atrPct ?? 0) > 0.06) {
    regime = "VOLATILE";
  } else if (trend > 0.3 && snap.structure === "UP" && adxVal > 20) {
    regime = "BULL_TREND";
  } else if (trend < -0.3 && snap.structure === "DOWN" && adxVal > 20) {
    regime = "BEAR_TREND";
  } else if (adxVal < 20 && (snap.bbWidth ?? 0.1) < 0.04) {
    regime = "RANGE";
  } else {
    regime =
      Math.abs(trend) > 0.15
        ? trend > 0
          ? "BULL_TREND"
          : "BEAR_TREND"
        : "RANGE";
  }

  const overall = clamp(
    Math.abs(trend) * 100 * 0.5 +
      Math.min(100, adxVal) * 0.3 +
      (snap.atrPct !== null ? Math.min(100, snap.atrPct * 1000) : 0) * 0.2,
    0,
    100,
  );

  return {
    regime,
    confidence: {
      overall: Math.round(overall),
      trend: Math.round(Math.abs(trend) * 100),
      volatility:
        snap.atrPct !== null
          ? Math.round(Math.min(100, snap.atrPct * 1000))
          : 50,
      momentum:
        snap.rsi !== null ? Math.round(Math.abs(snap.rsi - 50) * 2) : 50,
      structure: snap.structure === "RANGE" ? 30 : 80,
    },
    diagnostics: {
      emaStack,
      adx: snap.adx,
      plusDI: snap.plusDI,
      minusDI: snap.minusDI,
      atrPct: snap.atrPct,
      bbWidth: snap.bbWidth,
      rsi: snap.rsi,
      structure: snap.structure,
    },
  };
}

function computeTrendBias(snap: IndicatorSnapshot): number {
  // Returns -1..+1
  let bias = 0;
  const e20 = snap.ema20,
    e50 = snap.ema50,
    e200 = snap.ema200;
  if (e20 !== null && e50 !== null && e200 !== null && e200 > 0) {
    if (e20 > e50 && e50 > e200) bias += 0.5;
    else if (e20 < e50 && e50 < e200) bias -= 0.5;
    else bias += Math.sign((e20 - e50) * 0.2);
  }
  if (snap.adx !== null && snap.adx > 20) {
    const diDom = (snap.plusDI ?? 0) - (snap.minusDI ?? 0);
    bias += Math.sign(diDom) * Math.min(0.4, (snap.adx - 20) * 0.02);
  }
  if (snap.ema20Slope !== null) {
    bias +=
      Math.sign(snap.ema20Slope) *
      Math.min(0.2, Math.abs(snap.ema20Slope) * 0.5);
  }
  return clamp(bias, -1, 1);
}

function computeEmaStack(snap: IndicatorSnapshot): "BULL" | "BEAR" | "MIXED" {
  if (snap.ema20 === null || snap.ema50 === null || snap.ema200 === null)
    return "MIXED";
  if (snap.ema20 > snap.ema50 && snap.ema50 > snap.ema200) return "BULL";
  if (snap.ema20 < snap.ema50 && snap.ema50 < snap.ema200) return "BEAR";
  return "MIXED";
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function ConfBar({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  const tone =
    value >= 65 ? "bg-bull" : value <= 35 ? "bg-bear" : "bg-muted-foreground";
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[10px]">
        <span className="text-foreground">{label}</span>
        <span className="tabular text-muted-foreground">
          {value}
          <span className="ml-1 text-[9px] opacity-70">{hint}</span>
        </span>
      </div>
      <div className="relative h-1 overflow-hidden rounded-full bg-accent">
        <div
          className={`absolute inset-y-0 left-0 ${tone}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

function HistoryStrip({
  history,
}: {
  history: { time: number; regime: Regime; confidence: number }[];
}) {
  // Take the last 80 bars max
  const slice = history.slice(-80);
  return (
    <div className="flex h-3.5 w-full gap-px">
      {slice.map((h, i) => {
        const opacity = 0.3 + 0.7 * (h.confidence / 100);
        const color =
          h.regime === "BULL_TREND"
            ? "var(--bull)"
            : h.regime === "BEAR_TREND"
              ? "var(--bear)"
              : h.regime === "VOLATILE"
                ? "var(--warn)"
                : "var(--muted)";
        return (
          <div
            key={`${h.time}-${i}`}
            className="flex-1 rounded-sm"
            style={{ backgroundColor: color, opacity }}
            title={`${new Date(h.time * 1000).toLocaleString("pt-BR")} · ${h.regime} ${h.confidence.toFixed(0)}%`}
          />
        );
      })}
    </div>
  );
}
