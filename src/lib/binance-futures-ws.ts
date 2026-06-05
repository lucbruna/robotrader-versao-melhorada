// WebSocket manager for Binance USDⓈ-M Futures public streams.
// Separate from binance-ws.ts because futures uses a different host
// (fstream.binance.com) and stream names.
//
// Streams wrapped:
//   - <sym>@markPrice@1s   — mark price + funding rate, 1s tick
//   - <sym>@openInterest@1s — open interest updates, 1s tick
//   - <sym>@forceOrder     — liquidation orders (real-time)
// All multi-stream on a single combined socket, with auto-reconnect.

import { useEffect, useState } from "react";

export type FuturesMarkPrice = {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  lastFundingRate: number;
  nextFundingTime: number;
  time: number;
};

export type FuturesOI = {
  symbol: string;
  sumOpenInterest: number;
  sumOpenInterestValue: number;
  time: number;
};

export type FuturesLiquidation = {
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  time: number;
};

export type FuturesStatus = {
  connected: boolean;
  reconnecting: boolean;
  attempt: number;
  lastError: string | null;
  activeStreams: number;
  lastMessageAt: number;
};

export type MarkPriceHandler = (m: FuturesMarkPrice) => void;
export type OIHandler = (o: FuturesOI) => void;
export type LiquidationHandler = (l: FuturesLiquidation) => void;
export type FuturesStatusHandler = (s: FuturesStatus) => void;

type StreamKey = string; // e.g. "btcusdt@markPrice@1s"
type StreamKind = "markPrice" | "openInterest" | "forceOrder";
type AnyCallback = (...args: never[]) => void;

interface InternalSub {
  kind: StreamKind;
  callbacks: Set<AnyCallback>;
}

const FWS_BASE = "wss://fstream.binance.com/stream";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;

function key(symbol: string, kind: StreamKind): StreamKey {
  const s = symbol.toLowerCase();
  if (kind === "markPrice") return `${s}@markPrice@1s`;
  if (kind === "openInterest") return `${s}@openInterest@1s`;
  return `${s}@forceOrder`;
}

class BinanceFuturesWSSingleton {
  private socket: WebSocket | null = null;
  private subs = new Map<StreamKey, InternalSub>();
  private wanted = new Set<StreamKey>();
  private nextId = 1;
  private currentStatus: FuturesStatus = {
    connected: false,
    reconnecting: false,
    attempt: 0,
    lastError: null,
    activeStreams: 0,
    lastMessageAt: 0,
  };
  private statusListeners = new Set<FuturesStatusHandler>();
  private reconnectTimer: number | null = null;

  getStatus(): FuturesStatus {
    return { ...this.currentStatus };
  }

  onStatus(cb: FuturesStatusHandler): () => void {
    this.statusListeners.add(cb);
    cb(this.currentStatus);
    return () => {
      this.statusListeners.delete(cb);
    };
  }

  private setStatus(patch: Partial<FuturesStatus>): void {
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
  markPrice(symbol: string, cb: MarkPriceHandler): () => void {
    return this.addSub("markPrice", symbol, cb);
  }
  openInterest(symbol: string, cb: OIHandler): () => void {
    return this.addSub("openInterest", symbol, cb);
  }
  forceOrder(cb: LiquidationHandler): () => void {
    return this.addSub("forceOrder", "*", cb);
  }

  private addSub<T extends AnyCallback>(
    kind: StreamKind,
    symbol: string,
    cb: T,
  ): () => void {
    const k =
      kind === "forceOrder" ? `${symbol}@forceOrder` : key(symbol, kind);
    let sub = this.subs.get(k);
    if (!sub) {
      sub = { kind, callbacks: new Set() };
      this.subs.set(k, sub);
    }
    sub.callbacks.add(cb);
    this.ensureStream(k);
    return () => this.removeSub(k, cb);
  }

  private removeSub(k: StreamKey, cb: AnyCallback): void {
    const sub = this.subs.get(k);
    if (!sub) return;
    sub.callbacks.delete(cb);
    if (sub.callbacks.size === 0) {
      this.subs.delete(k);
      this.wanted.delete(k);
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send({ method: "UNSUBSCRIBE", params: [k], id: this.nextId++ });
      }
      this.setStatus({ activeStreams: this.wanted.size });
    }
  }

  private ensureStream(k: StreamKey): void {
    if (!this.wanted.has(k)) {
      this.wanted.add(k);
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send({ method: "SUBSCRIBE", params: [k], id: this.nextId++ });
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

    const url = `${FWS_BASE}?streams=${Array.from(this.wanted).join("/")}`;
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
      let msg: { stream?: string; data?: Record<string, unknown> };
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
      this.setStatus({ lastError: "WebSocket error (futures)" });
    };

    ws.onclose = () => {
      this.setStatus({ connected: false });
      this.socket = null;
      this.scheduleReconnect();
    };
  }

  private dispatch(sub: InternalSub, data: Record<string, unknown>): void {
    if (sub.kind === "markPrice") {
      const m: FuturesMarkPrice = {
        symbol: (data.s as string) ?? "",
        markPrice: parseFloat(data.p as string),
        indexPrice: parseFloat(data.i as string),
        lastFundingRate: parseFloat(data.r as string),
        nextFundingTime: Number(data.T ?? 0),
        time: Number(data.E ?? Date.now()),
      };
      for (const cb of sub.callbacks) (cb as MarkPriceHandler)(m);
      return;
    }
    if (sub.kind === "openInterest") {
      const o: FuturesOI = {
        symbol: (data.s as string) ?? "",
        sumOpenInterest: parseFloat(data.o as string),
        sumOpenInterestValue: parseFloat(data.q as string),
        time: Number(data.E ?? Date.now()),
      };
      for (const cb of sub.callbacks) (cb as OIHandler)(o);
      return;
    }
    if (sub.kind === "forceOrder") {
      const o = data.o as
        | {
            s: string;
            S: "BUY" | "SELL";
            q: string;
            p: string;
            T: number;
          }
        | undefined;
      if (!o) return;
      const l: FuturesLiquidation = {
        symbol: o.s,
        side: o.S,
        qty: parseFloat(o.q),
        price: parseFloat(o.p),
        time: o.T,
      };
      for (const cb of sub.callbacks) (cb as LiquidationHandler)(l);
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

let _instance: BinanceFuturesWSSingleton | null = null;

export function getBinanceFuturesWS(): BinanceFuturesWSSingleton {
  if (!_instance) _instance = new BinanceFuturesWSSingleton();
  return _instance;
}

export function useFuturesStatus(): FuturesStatus {
  const [s, setS] = useState<FuturesStatus>(() =>
    getBinanceFuturesWS().getStatus(),
  );
  useEffect(() => getBinanceFuturesWS().onStatus(setS), []);
  return s;
}
