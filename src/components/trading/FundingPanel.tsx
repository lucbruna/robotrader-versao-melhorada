import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Zap,
  AlertTriangle,
  Flame,
  RefreshCw,
  Clock,
  DollarSign,
  BarChart3,
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
import { DEFAULT_SYMBOLS } from "@/lib/binance";
import {
  fetchFundingHistory,
  fetchLongShortRatio,
  fetchOpenInterest,
  fetchOpenInterestHist,
  fetchPremiumIndex,
  fetchTakerBuySellRatio,
  formatBasis,
  formatCountdown,
  formatRatePct,
  fundingTone,
  msUntilFunding,
  type LongShortRatio,
  type OpenInterest,
  type PremiumIndex,
  type TakerRatio,
} from "@/lib/futures-data";
import {
  getBinanceFuturesWS,
  type FuturesLiquidation,
} from "@/lib/binance-futures-ws";

type Tab = "funding" | "oi" | "sentiment" | "liquidations";

export function FundingPanel({
  symbol: defaultSymbol = "BTCUSDT",
}: {
  symbol?: string;
}) {
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [tab, setTab] = useState<Tab>("funding");
  const [premium, setPremium] = useState<PremiumIndex | null>(null);
  const [fundingHist, setFundingHist] = useState<
    { rate: number; time: number }[]
  >([]);
  const [oi, setOI] = useState<OpenInterest | null>(null);
  const [oiHist, setOIHist] = useState<OpenInterest[]>([]);
  const [oiChange24h, setOIChange24h] = useState<number | null>(null);
  const [lsRatio, setLsRatio] = useState<LongShortRatio | null>(null);
  const [taker, setTaker] = useState<TakerRatio | null>(null);
  const [liquidations, setLiquidations] = useState<FuturesLiquidation[]>([]);
  const [countdown, setCountdown] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // REST seed + periodic refresh
  const refresh = async () => {
    setLoading(true);
    setErr(null);
    try {
      const [p, fh, o, oh, ls, tk] = await Promise.all([
        fetchPremiumIndex(symbol),
        fetchFundingHistory(symbol, 30),
        fetchOpenInterest(symbol),
        fetchOpenInterestHist(symbol, "5m", 30),
        fetchLongShortRatio(symbol, "15m", 1),
        fetchTakerBuySellRatio(symbol, "15m", 1),
      ]);
      setPremium(p);
      setFundingHist(
        fh.map((f) => ({ rate: f.fundingRate, time: f.fundingTime })),
      );
      setOI(o);
      setOIHist(oh);
      // 24h change = latest OI vs OI from ~24h ago (288 5m periods)
      if (oh.length > 0) {
        const oi24hAgo = await fetchOpenInterestHist(symbol, "1d", 2);
        if (oi24hAgo.length > 0) {
          const base = oi24hAgo[0].sumOpenInterestValue;
          if (base > 0) {
            setOIChange24h(((o.sumOpenInterestValue - base) / base) * 100);
          }
        }
      }
      setLsRatio(ls[0] ?? null);
      setTaker(tk[0] ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(refresh, 30000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // WS: mark price + funding rate (1s tick) — updates premium + countdown
  useEffect(() => {
    const ws = getBinanceFuturesWS();
    const unsub = ws.markPrice(symbol, (m) => {
      setPremium((prev) =>
        prev
          ? {
              ...prev,
              markPrice: m.markPrice,
              indexPrice: m.indexPrice,
              lastFundingRate: m.lastFundingRate,
              nextFundingTime: m.nextFundingTime,
              time: m.time,
            }
          : prev,
      );
    });
    return unsub;
  }, [symbol]);

  // WS: OI 1s tick
  useEffect(() => {
    const ws = getBinanceFuturesWS();
    const unsub = ws.openInterest(symbol, (o) => {
      setOI({
        symbol: o.symbol,
        sumOpenInterest: o.sumOpenInterest,
        sumOpenInterestValue: o.sumOpenInterestValue,
        timestamp: o.time,
      });
    });
    return unsub;
  }, [symbol]);

  // WS: liquidations (global — receive for any symbol, filter ours)
  useEffect(() => {
    const ws = getBinanceFuturesWS();
    const unsub = ws.forceOrder((l) => {
      if (l.symbol !== symbol) return;
      setLiquidations((prev) => [l, ...prev].slice(0, 30));
    });
    return unsub;
  }, [symbol]);

  // Funding countdown ticker
  useEffect(() => {
    if (!premium) return;
    const tick = () =>
      setCountdown(formatCountdown(msUntilFunding(premium.nextFundingTime)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [premium]);

  const basis = useMemo(
    () => (premium ? formatBasis(premium.markPrice, premium.indexPrice) : null),
    [premium],
  );

  const fundingToneCls = premium
    ? fundingTone(premium.lastFundingRate) === "bearish"
      ? "text-bear"
      : fundingTone(premium.lastFundingRate) === "bullish"
        ? "text-bull"
        : "text-muted-foreground"
    : "text-muted-foreground";

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <BarChart3 className="size-3.5 text-primary" />
            Futures · USDⓈ-M
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={refresh}
            disabled={loading}
            className="h-6 px-2"
          >
            <RefreshCw className={`size-3 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
        <CardDescription>
          <select
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
            className="mt-1 w-full rounded border border-border bg-surface px-2 py-1 text-xs"
          >
            {DEFAULT_SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </CardDescription>
      </CardHeader>

      <div className="flex border-b border-border px-2">
        {(["funding", "oi", "sentiment", "liquidations"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 px-2 py-1.5 text-[10px] uppercase tracking-wider transition ${
              tab === t
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "funding"
              ? "Funding"
              : t === "oi"
                ? "OI"
                : t === "sentiment"
                  ? "Sentiment"
                  : "Liquid."}
          </button>
        ))}
      </div>

      <CardContent className="flex-1 overflow-y-auto p-3 scrollbar-thin">
        {err && (
          <div className="mb-2 flex items-center gap-1 rounded border border-bear/30 bg-bear/5 p-2 text-[10px] text-bear">
            <AlertTriangle className="size-3" /> {err}
          </div>
        )}

        {tab === "funding" && premium && (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-surface p-2.5">
              <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Funding atual</span>
                <Clock className="size-3" />
                <span>{countdown || "—"}</span>
              </div>
              <div
                className={`mt-1 text-xl font-bold tabular ${fundingToneCls}`}
              >
                {formatRatePct(premium.lastFundingRate)} / 8h
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {fundingTone(premium.lastFundingRate) === "bullish"
                  ? "🟢 Shorts pagam longs — viés comprador"
                  : fundingTone(premium.lastFundingRate) === "bearish"
                    ? "🔴 Longs pagam shorts — viés vendedor"
                    : "⚪ Neutro"}
              </div>
            </div>

            <div className="rounded-md border border-border bg-surface p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Mark vs Index (basis)
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-semibold tabular">
                  {premium.markPrice.toLocaleString(undefined, {
                    maximumFractionDigits: 2,
                  })}
                </span>
                {basis && (
                  <span
                    className={`text-[11px] tabular ${
                      basis.pct >= 0 ? "text-bull" : "text-bear"
                    }`}
                  >
                    {basis.pct >= 0 ? "+" : ""}
                    {basis.pct.toFixed(3)}%
                  </span>
                )}
              </div>
            </div>

            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Últimos 30 funding rates
              </div>
              <div className="flex h-10 items-end gap-0.5 rounded bg-accent/30 p-1">
                {fundingHist.map((f, i) => {
                  const w = Math.min(100, Math.abs(f.rate) * 100000 * 2);
                  const isPos = f.rate >= 0;
                  return (
                    <div
                      key={i}
                      className={`flex-1 ${isPos ? "bg-bear/60" : "bg-bull/60"}`}
                      style={{ height: `${Math.max(8, w)}%` }}
                      title={`${formatRatePct(f.rate)} — ${new Date(f.time).toLocaleString()}`}
                    />
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between text-[9px] text-muted-foreground">
                <span>−30 rates</span>
                <span>agora</span>
              </div>
            </div>
          </div>
        )}

        {tab === "oi" && oi && (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-surface p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Open Interest
              </div>
              <div className="mt-1 text-xl font-bold tabular">
                {formatUsd(oi.sumOpenInterestValue)}
              </div>
              <div className="text-[10px] text-muted-foreground tabular">
                {formatContracts(oi.sumOpenInterest)} contratos
              </div>
              {oiChange24h !== null && (
                <div
                  className={`mt-1 flex items-center gap-1 text-[11px] ${
                    oiChange24h >= 0 ? "text-bull" : "text-bear"
                  }`}
                >
                  {oiChange24h >= 0 ? (
                    <TrendingUp className="size-3" />
                  ) : (
                    <TrendingDown className="size-3" />
                  )}
                  {oiChange24h >= 0 ? "+" : ""}
                  {oiChange24h.toFixed(2)}% 24h
                </div>
              )}
            </div>

            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                OI (5m · últimas 30)
              </div>
              <OIChart hist={oiHist} />
            </div>
          </div>
        )}

        {tab === "sentiment" && (
          <div className="space-y-3">
            <div className="rounded-md border border-border bg-surface p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Long / Short ratio (top traders)
              </div>
              {lsRatio ? (
                <>
                  <div className="mt-1 text-xl font-bold tabular">
                    {lsRatio.longShortRatio.toFixed(2)}
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-accent">
                    <div
                      className="h-full bg-bull"
                      style={{
                        width: `${Math.min(100, lsRatio.longAccount * 100).toFixed(1)}%`,
                      }}
                    />
                  </div>
                  <div className="mt-0.5 flex justify-between text-[10px] text-muted-foreground tabular">
                    <span>{(lsRatio.longAccount * 100).toFixed(1)}% long</span>
                    <span>
                      {(lsRatio.shortAccount * 100).toFixed(1)}% short
                    </span>
                  </div>
                </>
              ) : (
                <div className="mt-1 text-[10px] text-muted-foreground">—</div>
              )}
            </div>

            <div className="rounded-md border border-border bg-surface p-2.5">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Taker buy / sell (15m)
              </div>
              {taker ? (
                <>
                  <div
                    className={`mt-1 text-xl font-bold tabular ${
                      taker.buySellRatio >= 1 ? "text-bull" : "text-bear"
                    }`}
                  >
                    {taker.buySellRatio.toFixed(2)}
                  </div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground tabular">
                    buy {formatUsd(taker.buyVol)} · sell{" "}
                    {formatUsd(taker.sellVol)}
                  </div>
                </>
              ) : (
                <div className="mt-1 text-[10px] text-muted-foreground">—</div>
              )}
            </div>
          </div>
        )}

        {tab === "liquidations" && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Flame className="size-3" /> Liquidações recentes · {symbol}
            </div>
            {liquidations.length === 0 ? (
              <div className="rounded border border-border bg-surface p-3 text-center text-[10px] text-muted-foreground">
                Aguardando liquidações…
              </div>
            ) : (
              liquidations.map((l, i) => {
                const isLongLiq = l.side === "SELL";
                return (
                  <div
                    key={i}
                    className={`flex items-center justify-between rounded border-l-2 px-2 py-1.5 text-[11px] ${
                      isLongLiq
                        ? "border-bear bg-bear/5"
                        : "border-bull bg-bull/5"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Zap className="size-3" />
                      <span className="font-semibold">
                        {isLongLiq ? "LONG liq" : "SHORT liq"}
                      </span>
                      <span className="tabular text-muted-foreground">
                        {l.price.toFixed(2)}
                      </span>
                    </div>
                    <div className="text-right tabular">
                      <div className="font-semibold">{l.qty.toFixed(3)}</div>
                      <div className="text-[9px] text-muted-foreground">
                        {formatUsd(l.qty * l.price)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {!premium && !loading && (
          <div className="flex h-32 items-center justify-center text-[10px] text-muted-foreground">
            <Activity className="mr-1 size-3 animate-pulse" /> Carregando…
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatUsd(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(2)}K`;
  return `$${v.toFixed(2)}`;
}

function formatContracts(v: number): string {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return v.toFixed(2);
}

function OIChart({ hist }: { hist: OpenInterest[] }) {
  if (hist.length < 2)
    return (
      <div className="h-16 rounded bg-accent/30 text-center text-[10px] text-muted-foreground">
        dados insuficientes
      </div>
    );
  const values = hist.map((h) => h.sumOpenInterestValue);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  return (
    <div className="flex h-16 items-end gap-0.5 rounded bg-accent/30 p-1">
      {hist.map((h, i) => {
        const pct = ((h.sumOpenInterestValue - min) / range) * 100;
        return (
          <div
            key={i}
            className="flex-1 bg-primary/60"
            style={{ height: `${Math.max(8, pct)}%` }}
            title={`${formatUsd(h.sumOpenInterestValue)} — ${new Date(h.timestamp).toLocaleTimeString()}`}
          />
        );
      })}
    </div>
  );
}

// Suppress unused Badge import warning (kept for future use)
void Badge;
