import { useEffect, useState } from "react";
import {
  fetchMultiTicker,
  DEFAULT_SYMBOLS,
  type Ticker24h,
} from "@/lib/binance";
import { getBinanceWS } from "@/lib/binance-ws";

export function TickerTape({
  onSelect,
  active,
}: {
  onSelect: (s: string) => void;
  active: string;
}) {
  const [tickers, setTickers] = useState<Ticker24h[]>([]);

  useEffect(() => {
    let alive = true;
    // Seed from REST so the tape has values immediately.
    fetchMultiTicker(DEFAULT_SYMBOLS)
      .then((t) => {
        if (alive) setTickers(t);
      })
      .catch(() => {
        /* noop */
      });
    // Real-time WS updates for every default symbol on a single shared socket.
    const ws = getBinanceWS();
    const unsubs = DEFAULT_SYMBOLS.map((sym) =>
      ws.ticker(sym, (t) => {
        if (!alive) return;
        setTickers((prev) => {
          const idx = prev.findIndex((p) => p.symbol === t.symbol);
          if (idx === -1) return [...prev, t];
          const next = prev.slice();
          next[idx] = t;
          return next;
        });
      }),
    );
    return () => {
      alive = false;
      for (const u of unsubs) u();
    };
  }, []);

  return (
    <div className="flex items-center gap-1 overflow-x-auto scrollbar-thin border-b border-border bg-surface px-2 py-1.5">
      {tickers.map((t) => {
        const up = t.priceChangePercent >= 0;
        const isActive = t.symbol === active;
        return (
          <button
            key={t.symbol}
            onClick={() => onSelect(t.symbol)}
            className={`group flex shrink-0 items-center gap-2 rounded px-2.5 py-1 text-xs transition tabular ${
              isActive ? "bg-accent" : "hover:bg-accent/60"
            }`}
          >
            <span className="font-medium text-foreground">
              {t.symbol.replace("USDT", "")}
            </span>
            <span className="text-muted-foreground">
              {t.lastPrice.toLocaleString(undefined, {
                maximumFractionDigits: t.lastPrice > 100 ? 2 : 4,
              })}
            </span>
            <span className={up ? "text-bull" : "text-bear"}>
              {up ? "+" : ""}
              {t.priceChangePercent.toFixed(2)}%
            </span>
          </button>
        );
      })}
    </div>
  );
}
