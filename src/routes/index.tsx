import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Sparkles,
  Settings as SettingsIcon,
  FlaskConical,
} from "lucide-react";
import {
  DEFAULT_SYMBOLS,
  INTERVALS,
  type Interval,
  type Kline,
  type Ticker24h,
  fetchKlines,
  fetchTicker24h,
} from "@/lib/binance";
import { getBinanceWS } from "@/lib/binance-ws";
import {
  snapshot,
  localSignal,
  type IndicatorSnapshot,
} from "@/lib/indicators";
import { useServerFn } from "@tanstack/react-start";
import { getAISignal, type AIDecision } from "@/lib/ai-signal.functions";
import { fetchAISignal, isElectron } from "@/lib/ai-client";
import { TickerTape } from "@/components/trading/TickerTape";
import { CandleChart } from "@/components/trading/CandleChart";
import { OrderBookPanel } from "@/components/trading/OrderBookPanel";
import { IndicatorsPanel } from "@/components/trading/IndicatorsPanel";
import { AISignalPanel } from "@/components/trading/AISignalPanel";
import { BotPanel } from "@/components/trading/BotPanel";
import { TelegramSettings } from "@/components/trading/TelegramSettings";
import { UpdaterSettings } from "@/components/trading/UpdaterSettings";
import { WSStatusBadge } from "@/components/trading/WSStatusBadge";
import { FundingPanel } from "@/components/trading/FundingPanel";
import { ConfluenceGauge } from "@/components/trading/ConfluenceGauge";
import { RegimeDetector } from "@/components/trading/RegimeDetector";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RoboTrader AI · Painel profissional Binance" },
      {
        name: "description",
        content:
          "Robô de trading com IA para Binance: gráficos, indicadores e sinais inteligentes em tempo real.",
      },
    ],
  }),
  component: Dashboard,
});

function klineToCandle(k: Kline) {
  return {
    time: k.time,
    open: k.open,
    high: k.high,
    low: k.low,
    close: k.close,
    volume: k.volume,
  };
}

function Dashboard() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval] = useState<Interval>("15m");
  const [klines, setKlines] = useState<Kline[]>([]);
  const [live, setLive] = useState<Kline | null>(null);
  const [ticker, setTicker] = useState<Ticker24h | null>(null);
  const [overlays, setOverlays] = useState({
    ema20: true,
    ema50: true,
    ema200: false,
    bb: true,
    vwap: true,
  });
  const [manualOrder, setManualOrder] = useState<{
    side: "BUY" | "SELL";
    decision?: AIDecision;
  } | null>(null);

  // Load klines + ticker
  useEffect(() => {
    let alive = true;
    setKlines([]);
    setLive(null);
    fetchKlines(symbol, interval, 500)
      .then((k) => {
        if (alive) setKlines(k);
      })
      .catch(() => {});
    fetchTicker24h(symbol)
      .then((t) => {
        if (alive) setTicker(t);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [symbol, interval]);

  // WS subscriptions (shared multi-stream socket via singleton manager)
  useEffect(() => {
    const ws = getBinanceWS();
    const u1 = ws.kline(symbol, interval, (k, isFinal) => {
      setLive(k);
      if (isFinal) setKlines((prev) => [...prev.slice(-499), k]);
    });
    const u2 = ws.ticker(symbol, (t) => setTicker(t));
    return () => {
      u1();
      u2();
    };
  }, [symbol, interval]);

  const merged = useMemo(() => {
    if (!live || klines.length === 0) return klines;
    const last = klines[klines.length - 1];
    if (last.time === live.time) return [...klines.slice(0, -1), live];
    return klines;
  }, [klines, live]);

  const snap: IndicatorSnapshot | null = useMemo(() => {
    if (merged.length < 50) return null;
    return snapshot(merged.map(klineToCandle));
  }, [merged]);

  const local = useMemo(() => (snap ? localSignal(snap) : null), [snap]);
  const price = live?.close ?? ticker?.lastPrice ?? 0;

  // AI signal — used by both AISignalPanel and BotPanel
  const fetchAI = useServerFn(getAISignal);
  const [ai, setAI] = useState<AIDecision | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    setAI(null);
    if (!snap || !ticker) {
      return () => {
        alive = false;
      };
    }
    const run = async () => {
      setAiLoading(true);
      try {
        const payload = {
          symbol,
          interval,
          price: snap.price,
          rsi: snap.rsi,
          macd: snap.macd,
          macdSignal: snap.macdSignal,
          macdHist: snap.macdHist,
          ema20: snap.ema20,
          ema50: snap.ema50,
          ema200: snap.ema200,
          ema20Slope: snap.ema20Slope,
          adx: snap.adx,
          plusDI: snap.plusDI,
          minusDI: snap.minusDI,
          atr: snap.atr,
          atrPct: snap.atrPct,
          bbUpper: snap.bbUpper,
          bbLower: snap.bbLower,
          bbWidth: snap.bbWidth,
          volRegime: snap.volRegime,
          stochK: snap.stochK,
          stochD: snap.stochD,
          vwap: snap.vwap,
          obvSlope: snap.obvSlope,
          structure: snap.structure,
          supports: snap.supports,
          resistances: snap.resistances,
          high24h: snap.high24h,
          low24h: snap.low24h,
          rangePos: snap.rangePos,
          change24h: ticker.priceChangePercent,
          volume24h: ticker.quoteVolume,
          openPosition: null,
        };
        const d = isElectron()
          ? await fetchAISignal(payload)
          : await fetchAI({ data: payload });
        if (alive) setAI(d);
      } catch {
        /* noop */
      } finally {
        if (alive) setAiLoading(false);
      }
    };
    run();
    const id: number = window.setInterval(() => {
      run();
    }, 60000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [symbol, interval, snap, ticker]); // eslint-disable-line react-hooks/exhaustive-deps

  const up = (ticker?.priceChangePercent ?? 0) >= 0;

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex items-center justify-between border-b border-border bg-sidebar px-4 py-2">
        <div className="flex items-center gap-3">
          <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground glow-primary">
            <Bot className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-tight">
              RoboTrader<span className="text-primary"> AI</span>
            </div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Paper trading · Binance live data · ATR stops · AI-enhanced
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {ai && (
            <div className="hidden items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-primary md:flex">
              <Sparkles className="size-3" />
              IA: {ai.action} ({ai.confidence}%)
            </div>
          )}
          <div className="flex items-center gap-1.5 rounded-full bg-bull/10 px-2.5 py-1 text-[10px] uppercase tracking-wider text-bull">
            <span className="pulse-dot size-1.5 rounded-full bg-bull" /> Mercado
            ao vivo
          </div>
          <WSStatusBadge />
          <Link
            to="/backtest"
            className="flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Backtest"
          >
            <FlaskConical className="size-3.5" />
          </Link>
          <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
            <DialogTrigger asChild>
              <button
                className="flex size-7 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground"
                title="Configurações"
              >
                <SettingsIcon className="size-3.5" />
              </button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Configurações</DialogTitle>
                <DialogDescription>
                  Notificações e integrações externas.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <TelegramSettings />
                <UpdaterSettings />
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <TickerTape onSelect={setSymbol} active={symbol} />

      {/* Symbol header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-sidebar px-4 py-3">
        <div className="flex items-center gap-4">
          <div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-lg font-bold tracking-tight">
                {symbol.replace("USDT", "")}
                <span className="text-muted-foreground">/USDT</span>
              </h1>
              <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                Spot
              </span>
              {snap && (
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${
                    snap.volRegime === "EXTREME"
                      ? "bg-bear/20 text-bear"
                      : snap.volRegime === "HIGH"
                        ? "bg-[color:var(--warning)]/20 text-[color:var(--warning)]"
                        : snap.volRegime === "LOW"
                          ? "bg-accent text-muted-foreground"
                          : "bg-bull/20 text-bull"
                  }`}
                >
                  Vol {snap.volRegime.toLowerCase()}
                </span>
              )}
            </div>
          </div>
          <div className="hidden md:block">
            <div
              className={`text-2xl font-bold tabular ${up ? "text-bull" : "text-bear"}`}
            >
              {price
                ? price.toLocaleString(undefined, { maximumFractionDigits: 2 })
                : "—"}
            </div>
          </div>
          {ticker && (
            <div className="hidden gap-4 text-[11px] tabular md:flex">
              <Stat
                label="24h Chg"
                value={`${up ? "+" : ""}${ticker.priceChangePercent.toFixed(2)}%`}
                tone={up ? "bull" : "bear"}
              />
              <Stat label="24h High" value={ticker.highPrice.toFixed(2)} />
              <Stat label="24h Low" value={ticker.lowPrice.toFixed(2)} />
              <Stat
                label="24h Vol (USDT)"
                value={(ticker.quoteVolume / 1e6).toFixed(2) + "M"}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="rounded-md border border-border bg-surface px-2 py-1.5 text-xs"
          >
            {DEFAULT_SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <div className="flex overflow-hidden rounded-md border border-border bg-surface">
            {INTERVALS.map((i) => (
              <button
                key={i}
                onClick={() => setInterval(i)}
                className={`px-2.5 py-1.5 text-xs font-medium uppercase tracking-wider transition ${
                  interval === i
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent"
                }`}
              >
                {i}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Chart overlay toggles */}
      <div className="flex flex-wrap items-center gap-1 border-b border-border bg-surface px-3 py-1.5">
        <span className="mr-2 flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
          <Activity className="size-3" /> Indicadores
        </span>
        {(["ema20", "ema50", "ema200", "bb", "vwap"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setOverlays((o) => ({ ...o, [k]: !o[k] }))}
            className={`rounded px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider transition ${
              overlays[k]
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60"
            }`}
          >
            {k === "bb" ? "Bollinger" : k.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_280px_340px] xl:grid-cols-[1fr_280px_340px_320px]">
        {/* Chart + indicators */}
        <div className="flex min-h-0 flex-col border-r border-border">
          <div className="min-h-0 flex-1">
            {merged.length > 0 ? (
              <CandleChart
                data={merged}
                liveCandle={live}
                overlays={overlays}
                snap={snap}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                Carregando candles…
              </div>
            )}
          </div>
          {snap && (
            <div className="border-t border-border bg-sidebar">
              <IndicatorsPanel snap={snap} />
            </div>
          )}
        </div>

        {/* Order book */}
        <div className="border-r border-border bg-sidebar">
          <OrderBookPanel symbol={symbol} />
        </div>

        {/* Confluence + Regime + AI + Bot stacked */}
        <div className="grid min-h-0 grid-rows-[auto_auto_1fr_1fr] border-r border-border bg-sidebar">
          <div className="min-h-0 border-b border-border">
            <ConfluenceGauge symbol={symbol} snap={snap} ticker={ticker} />
          </div>
          <div className="min-h-0 border-b border-border">
            <RegimeDetector symbol={symbol} interval={interval} snap={snap} />
          </div>
          <div className="min-h-0 border-b border-border">
            {snap && local && (
              <AISignalPanel
                symbol={symbol}
                interval={interval}
                snap={snap}
                local={local}
                ticker={ticker}
                onExecute={(d) => {
                  if (d.action === "CLOSE") {
                    setManualOrder({ side: "BUY", decision: d });
                    return;
                  }
                  setManualOrder({
                    side: d.action === "SELL" ? "SELL" : "BUY",
                    decision: d,
                  });
                }}
              />
            )}
          </div>
          <div className="min-h-0">
            <BotPanel
              symbol={symbol}
              price={price}
              local={
                local ?? {
                  action: "HOLD",
                  score: 0,
                  confidence: 0,
                  reasons: [],
                  warnings: [],
                }
              }
              ai={ai}
              snapshot={snap}
              manualOrder={manualOrder}
            />
          </div>
        </div>

        {/* Futures panel (xl screens) */}
        <div className="hidden min-h-0 border-border bg-sidebar xl:block">
          <FundingPanel symbol={symbol} />
        </div>
      </div>
      {aiLoading && !ai && (
        <div className="pointer-events-none absolute bottom-4 right-4 rounded-md border border-border bg-surface/80 px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
          IA carregando…
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "bull" | "bear";
}) {
  const t =
    tone === "bull"
      ? "text-bull"
      : tone === "bear"
        ? "text-bear"
        : "text-foreground";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`font-semibold ${t}`}>{value}</div>
    </div>
  );
}
