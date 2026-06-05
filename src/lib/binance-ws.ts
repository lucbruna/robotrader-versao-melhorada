// Real-time WebSocket manager for Binance public market data.
// Uses combined-stream endpoint with dynamic subscribe/unsubscribe.
// Auto-reconnect with exponential backoff + jitter.
// Multi-stream on a single socket (kline, ticker, depth).

import { useEffect, useState } from "react";
import type { Kline, Ticker24h, OrderBook } from "./binance";

export type WSStatus = {
  connected: boolean;
  reconnecting: boolean;
  attempt: number;
  lastError: string | null;
  activeStreams: number;
  lastMessageAt: number;
};

export type KlineHandler = (k: Kline, isFinal: boolean) => void;
export type TickerHandler = (t: Ticker24h) => void;
export type DepthHandler = (d: OrderBook) => void;
export type StatusHandler = (s: WSStatus) => void;

type StreamKey = string; // e.g. "btcusdt@kline_15m"
type StreamKind = "kline" | "ticker" | "depth";
type AnyCallback = (...args: never[]) => void;

interface InternalSub {
  kind: StreamKind;
  symbol: string;
  interval?: string;
  callbacks: Set<AnyCallback>;
}

const WS_BASE = "wss://stream.binance.com:9443/stream";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const PING_TIMEOUT_MS = 60000;

function klineStream(symbol: string, interval: string): StreamKey {
  return `${symbol.toLowerCase()}@kline_${interval}`;
}
function tickerStream(symbol: string): StreamKey {
  return `${symbol.toLowerCase()}@ticker`;
}
function depthStream(symbol: string, levels: 5 | 10 | 20 = 20): StreamKey {
  return `${symbol.toLowerCase()}@depth${levels}@100ms`;
}

class BinanceWSSingleton {
  private socket: WebSocket | null = null;
  private subs = new Map<StreamKey, InternalSub>();
  private wanted = new Set<StreamKey>(); // streams we want active
  private nextId = 1;
  private currentStatus: WSStatus = {
    connected: false,
    reconnecting: false,
    attempt: 0,
    lastError: null,
    activeStreams: 0,
    lastMessageAt: 0,
  };
  private statusListeners = new Set<StatusHandler>();
  private reconnectTimer: number | null = null;
  private lastPingAt = 0;

  getStatus(): WSStatus {
    return { ...this.currentStatus };
  }

  onStatus(cb: StatusHandler): () => void {
    this.statusListeners.add(cb);
    cb(this.currentStatus);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  private setStatus(patch: Partial<WSStatus>): void {
    this.currentStatus = { ...this.currentStatus, ...patch };
    for (const cb of this.statusListeners) {
      try {
        cb(this.currentStatus);
      } catch {
        /* noop */
      }
    }
  }

  // ---- public subscribe API ----
  kline(symbol: string, interval: string, cb: KlineHandler): () => void {
    return this.addSub("kline", symbol, cb, interval);
  }
  ticker(symbol: string, cb: TickerHandler): () => void {
    return this.addSub("ticker", symbol, cb);
  }
  depth(
    symbol: string,
    cb: DepthHandler,
    levels: 5 | 10 | 20 = 20,
  ): () => void {
    return this.addSub("depth", symbol, cb, undefined, levels);
  }

  private addSub<T extends AnyCallback>(
    kind: StreamKind,
    symbol: string,
    cb: T,
    interval?: string,
    depthLevels: 5 | 10 | 20 = 20,
  ): () => void {
    const key =
      kind === "kline"
        ? klineStream(symbol, interval!)
        : kind === "ticker"
          ? tickerStream(symbol)
          : depthStream(symbol, depthLevels);
    let sub = this.subs.get(key);
    if (!sub) {
      sub = {
        kind,
        symbol: symbol.toUpperCase(),
        interval,
        callbacks: new Set(),
      };
      this.subs.set(key, sub);
    }
    sub.callbacks.add(cb);
    this.ensureStream(key);
    return () => this.removeSub(key, cb);
  }

  private removeSub(key: StreamKey, cb: AnyCallback): void {
    const sub = this.subs.get(key);
    if (!sub) return;
    sub.callbacks.delete(cb);
    if (sub.callbacks.size === 0) {
      this.subs.delete(key);
      this.wanted.delete(key);
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send({
          method: "UNSUBSCRIBE",
          params: [key],
          id: this.nextId++,
        });
      }
      this.setStatus({ activeStreams: this.wanted.size });
    }
  }

  private ensureStream(key: StreamKey): void {
    if (!this.wanted.has(key)) {
      this.wanted.add(key);
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send({ method: "SUBSCRIBE", params: [key], id: this.nextId++ });
      } else {
        this.connect();
      }
    }
    this.setStatus({ activeStreams: this.wanted.size });
  }

  private send(payload: unknown): void {
    try {
      this.socket?.send(JSON.stringify(payload));
    } catch {
      /* noop */
    }
  }

  private connect(): void {
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) return;
    this.setStatus({
      reconnecting: true,
      attempt: this.currentStatus.attempt + 1,
    });

    const url = `${WS_BASE}?streams=${Array.from(this.wanted).join("/")}`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.setStatus({
        lastError: e instanceof Error ? e.message : String(e),
      });
      this.scheduleReconnect();
      return;
    }
    this.socket = ws;
    this.lastPingAt = Date.now();

    ws.onopen = () => {
      this.setStatus({
        connected: true,
        reconnecting: false,
        attempt: 0,
        lastError: null,
      });
    };

    ws.onmessage = (e) => {
      this.setStatus({ lastMessageAt: Date.now() });
      this.lastPingAt = Date.now();
      let msg: {
        stream?: string;
        data?: Record<string, unknown>;
      };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      const stream = msg.stream;
      const data = msg.data ?? {};
      if (!stream) return;
      const sub = this.subs.get(stream);
      if (!sub) return;
      this.dispatch(sub, data);
    };

    ws.onerror = () => {
      this.setStatus({ lastError: "WebSocket error" });
    };

    ws.onclose = () => {
      this.setStatus({ connected: false });
      this.socket = null;
      this.scheduleReconnect();
    };
  }

  private dispatch(sub: InternalSub, data: Record<string, unknown>): void {
    if (sub.kind === "kline") {
      const k = data.k as {
        t: number;
        o: string;
        h: string;
        l: string;
        c: string;
        v: string;
        x: boolean;
      };
      if (!k) return;
      const kline: Kline = {
        time: Math.floor(k.t / 1000),
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v),
      };
      for (const cb of sub.callbacks) (cb as KlineHandler)(kline, Boolean(k.x));
      return;
    }
    if (sub.kind === "ticker") {
      const t: Ticker24h = {
        symbol: (data.s as string) ?? sub.symbol,
        lastPrice: parseFloat(data.c as string),
        priceChange: parseFloat(data.p as string),
        priceChangePercent: parseFloat(data.P as string),
        highPrice: parseFloat(data.h as string),
        lowPrice: parseFloat(data.l as string),
        volume: parseFloat(data.v as string),
        quoteVolume: parseFloat(data.q as string),
      };
      for (const cb of sub.callbacks) (cb as TickerHandler)(t);
      return;
    }
    if (sub.kind === "depth") {
      const bids = (data.bids as [string, string][]) ?? [];
      const asks = (data.asks as [string, string][]) ?? [];
      const ob: OrderBook = {
        bids: bids.map(([p, q]) => ({
          price: parseFloat(p),
          qty: parseFloat(q),
        })),
        asks: asks.map(([p, q]) => ({
          price: parseFloat(p),
          qty: parseFloat(q),
        })),
      };
      for (const cb of sub.callbacks) (cb as DepthHandler)(ob);
      return;
    }
  }

  private scheduleReconnect(): void {
    if (this.wanted.size === 0) {
      this.setStatus({ reconnecting: false });
      return;
    }
    if (this.reconnectTimer !== null) return;
    const attempt = Math.max(1, this.currentStatus.attempt);
    const backoff = Math.min(
      RECONNECT_MAX_MS,
      RECONNECT_BASE_MS * 2 ** Math.min(attempt - 1, 6),
    );
    const jitter = Math.random() * 250;
    const delay = backoff + jitter;
    this.setStatus({ reconnecting: true });
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  // For tests / hot-reload
  destroy(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.wanted.clear();
    this.subs.clear();
    try {
      this.socket?.close();
    } catch {
      /* noop */
    }
    this.socket = null;
    this.statusListeners.clear();
    this.setStatus({
      connected: false,
      reconnecting: false,
      attempt: 0,
      activeStreams: 0,
      lastError: null,
    });
  }
}

let _instance: BinanceWSSingleton | null = null;

export function getBinanceWS(): BinanceWSSingleton {
  if (!_instance) _instance = new BinanceWSSingleton();
  return _instance;
}

// Lightweight periodic health check — surfaces UI badge as "stale"
let healthTimer: number | null = null;
export function startWSHealthCheck(onStale: () => void): () => void {
  if (healthTimer !== null) {
    window.clearInterval(healthTimer);
  }
  healthTimer = window.setInterval(() => {
    const s = getBinanceWS().getStatus();
    if (s.connected && s.lastMessageAt > 0) {
      const age = Date.now() - s.lastMessageAt;
      if (age > PING_TIMEOUT_MS) onStale();
    }
  }, 15000);
  return () => {
    if (healthTimer !== null) {
      window.clearInterval(healthTimer);
      healthTimer = null;
    }
  };
}

// ---- public subscribe helpers (delegate to singleton) ----
export function subscribeDepth(
  symbol: string,
  cb: DepthHandler,
  levels: 5 | 10 | 20 = 20,
): () => void {
  return getBinanceWS().depth(symbol, cb, levels);
}

export function subscribeWSKline(
  symbol: string,
  interval: string,
  cb: KlineHandler,
): () => void {
  return getBinanceWS().kline(symbol, interval, cb);
}

export function subscribeWSTicker(
  symbol: string,
  cb: TickerHandler,
): () => void {
  return getBinanceWS().ticker(symbol, cb);
}

// React hook for the connection status — auto-subscribes/unsubscribes.
export function useWSStatus(): WSStatus {
  const [s, setS] = useState<WSStatus>(() => getBinanceWS().getStatus());
  useEffect(() => getBinanceWS().onStatus(setS), []);
  return s;
}
