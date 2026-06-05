import { useEffect, useState } from "react";
import { fetchOrderBook, type OrderBook } from "@/lib/binance";
import { subscribeDepth } from "@/lib/binance-ws";

export function OrderBookPanel({ symbol }: { symbol: string }) {
  const [book, setBook] = useState<OrderBook | null>(null);

  useEffect(() => {
    let alive = true;
    // Seed with REST snapshot so the panel has data before the first WS push.
    fetchOrderBook(symbol, 15)
      .then((b) => {
        if (alive) setBook(b);
      })
      .catch(() => {
        /* noop */
      });
    // Real-time updates via shared multi-stream WS.
    const unsubscribe = subscribeDepth(
      symbol,
      (b) => {
        if (alive) setBook(b);
      },
      20,
    );
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [symbol]);

  if (!book) {
    return (
      <div className="p-3 text-xs text-muted-foreground">Carregando book…</div>
    );
  }

  const maxQty = Math.max(
    ...book.bids.map((b) => b.qty),
    ...book.asks.map((a) => a.qty),
    0.0001,
  );
  const spread =
    book.asks[0] && book.bids[0] ? book.asks[0].price - book.bids[0].price : 0;
  const mid =
    book.asks[0] && book.bids[0]
      ? (book.asks[0].price + book.bids[0].price) / 2
      : 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] uppercase tracking-wider text-muted-foreground">
        <span>Order Book</span>
        <span className="tabular">spread {spread.toFixed(2)}</span>
      </div>
      <div className="grid grid-cols-3 px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>Preço</span>
        <span className="text-right">Qtd</span>
        <span className="text-right">Total</span>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Asks (reversed: highest at top) */}
        <div>
          {[...book.asks].reverse().map((a, i) => (
            <Row
              key={`a${i}`}
              price={a.price}
              qty={a.qty}
              maxQty={maxQty}
              side="ask"
            />
          ))}
        </div>
        <div className="border-y border-border bg-accent/40 px-3 py-1.5 text-center text-sm font-semibold tabular text-foreground">
          {mid.toLocaleString(undefined, { maximumFractionDigits: 2 })}
        </div>
        <div>
          {book.bids.map((b, i) => (
            <Row
              key={`b${i}`}
              price={b.price}
              qty={b.qty}
              maxQty={maxQty}
              side="bid"
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({
  price,
  qty,
  maxQty,
  side,
}: {
  price: number;
  qty: number;
  maxQty: number;
  side: "bid" | "ask";
}) {
  const pct = Math.min(100, (qty / maxQty) * 100);
  const total = price * qty;
  return (
    <div className="relative grid grid-cols-3 px-3 py-[3px] text-xs tabular">
      <div
        className={`absolute inset-y-0 right-0 ${side === "bid" ? "bg-bull/10" : "bg-bear/10"}`}
        style={{ width: `${pct}%` }}
      />
      <span
        className={`relative ${side === "bid" ? "text-bull" : "text-bear"}`}
      >
        {price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </span>
      <span className="relative text-right text-foreground">
        {qty.toFixed(4)}
      </span>
      <span className="relative text-right text-muted-foreground">
        {total.toFixed(0)}
      </span>
    </div>
  );
}
