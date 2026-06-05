// Binance public market data helpers (no API key required for public endpoints)
export type Kline = {
  time: number; // seconds (for lightweight-charts)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Ticker24h = {
  symbol: string;
  lastPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
};

const REST = "https://api.binance.com";

export async function fetchKlines(
  symbol: string,
  interval: string,
  limit = 500,
): Promise<Kline[]> {
  const url = `${REST}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance klines ${res.status}`);
  const data = (await res.json()) as unknown[][];
  return data.map((k) => ({
    time: Math.floor((k[0] as number) / 1000),
    open: parseFloat(k[1] as string),
    high: parseFloat(k[2] as string),
    low: parseFloat(k[3] as string),
    close: parseFloat(k[4] as string),
    volume: parseFloat(k[5] as string),
  }));
}

export async function fetchTicker24h(symbol: string): Promise<Ticker24h> {
  const res = await fetch(`${REST}/api/v3/ticker/24hr?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Binance ticker ${res.status}`);
  const d = (await res.json()) as Record<string, string>;
  return {
    symbol: d.symbol,
    lastPrice: parseFloat(d.lastPrice),
    priceChange: parseFloat(d.priceChange),
    priceChangePercent: parseFloat(d.priceChangePercent),
    highPrice: parseFloat(d.highPrice),
    lowPrice: parseFloat(d.lowPrice),
    volume: parseFloat(d.volume),
    quoteVolume: parseFloat(d.quoteVolume),
  };
}

export async function fetchMultiTicker(
  symbols: string[],
): Promise<Ticker24h[]> {
  const q = encodeURIComponent(JSON.stringify(symbols));
  const res = await fetch(`${REST}/api/v3/ticker/24hr?symbols=${q}`);
  if (!res.ok) throw new Error(`Binance multi ticker ${res.status}`);
  const arr = (await res.json()) as Record<string, string>[];
  return arr.map((d) => ({
    symbol: d.symbol,
    lastPrice: parseFloat(d.lastPrice),
    priceChange: parseFloat(d.priceChange),
    priceChangePercent: parseFloat(d.priceChangePercent),
    highPrice: parseFloat(d.highPrice),
    lowPrice: parseFloat(d.lowPrice),
    volume: parseFloat(d.volume),
    quoteVolume: parseFloat(d.quoteVolume),
  }));
}

export type OrderBookLevel = { price: number; qty: number };
export type OrderBook = { bids: OrderBookLevel[]; asks: OrderBookLevel[] };

export async function fetchOrderBook(
  symbol: string,
  limit = 20,
): Promise<OrderBook> {
  const res = await fetch(
    `${REST}/api/v3/depth?symbol=${symbol}&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`Binance depth ${res.status}`);
  const d = (await res.json()) as {
    bids: [string, string][];
    asks: [string, string][];
  };
  return {
    bids: d.bids.map(([p, q]) => ({
      price: parseFloat(p),
      qty: parseFloat(q),
    })),
    asks: d.asks.map(([p, q]) => ({
      price: parseFloat(p),
      qty: parseFloat(q),
    })),
  };
}

export type Trade = {
  id: number;
  price: number;
  qty: number;
  time: number;
  isBuyerMaker: boolean;
};

export async function fetchRecentTrades(
  symbol: string,
  limit = 30,
): Promise<Trade[]> {
  const res = await fetch(
    `${REST}/api/v3/trades?symbol=${symbol}&limit=${limit}`,
  );
  if (!res.ok) throw new Error(`Binance trades ${res.status}`);
  const d = (await res.json()) as Array<{
    id: number;
    price: string;
    qty: string;
    time: number;
    isBuyerMaker: boolean;
  }>;
  return d.map((t) => ({
    id: t.id,
    price: parseFloat(t.price),
    qty: parseFloat(t.qty),
    time: t.time,
    isBuyerMaker: t.isBuyerMaker,
  }));
}

// WebSocket subscriptions (kline + miniTicker)
export function subscribeKline(
  symbol: string,
  interval: string,
  onMsg: (k: Kline, isFinal: boolean) => void,
): () => void {
  const ws = new WebSocket(
    `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`,
  );
  ws.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      const k = msg.k;
      onMsg(
        {
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
        },
        Boolean(k.x),
      );
    } catch {
      // ignore
    }
  };
  return () => {
    try {
      ws.close();
    } catch {
      /* noop */
    }
  };
}

export function subscribeTicker(
  symbol: string,
  onMsg: (t: Ticker24h) => void,
): () => void {
  const ws = new WebSocket(
    `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`,
  );
  ws.onmessage = (e) => {
    try {
      const d = JSON.parse(e.data);
      onMsg({
        symbol: d.s,
        lastPrice: parseFloat(d.c),
        priceChange: parseFloat(d.p),
        priceChangePercent: parseFloat(d.P),
        highPrice: parseFloat(d.h),
        lowPrice: parseFloat(d.l),
        volume: parseFloat(d.v),
        quoteVolume: parseFloat(d.q),
      });
    } catch {
      /* noop */
    }
  };
  return () => {
    try {
      ws.close();
    } catch {
      /* noop */
    }
  };
}

export const DEFAULT_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
  "LINKUSDT",
  "MATICUSDT",
];

export const INTERVALS = ["1m", "5m", "15m", "1h", "4h", "1d"] as const;
export type Interval = (typeof INTERVALS)[number];
