// Binance USDⓈ-M Futures public market data (no auth required).
// Spot REST lives in src/lib/binance.ts — this is the futures counterpart.

export type FundingRate = {
  symbol: string;
  fundingTime: number; // ms
  fundingRate: number; // decimal, e.g. 0.0001 = 0.01%
  markPrice?: number;
};

export type PremiumIndex = {
  symbol: string;
  markPrice: number;
  indexPrice: number;
  lastFundingRate: number;
  nextFundingTime: number; // ms
  time: number; // ms
};

export type OpenInterest = {
  symbol: string;
  sumOpenInterest: number; // contracts
  sumOpenInterestValue: number; // USDT
  timestamp: number; // ms
};

export type LongShortRatio = {
  symbol: string;
  longShortRatio: number; // 1.5 = 1.5:1 longs:shorts
  longAccount: number; // 0..1
  shortAccount: number; // 0..1
  timestamp: number; // ms
};

export type TakerRatio = {
  buySellRatio: number;
  buyVol: number;
  sellVol: number;
  timestamp: number; // ms
};

export type Liquidation = {
  symbol: string;
  side: "BUY" | "SELL"; // SELL = long liquidated, BUY = short liquidated
  orderType: string;
  qty: number;
  price: number;
  time: number; // ms
};

const FAPI = "https://fapi.binance.com";
const FDATA = "https://fapi.binance.com/futures/data";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance futures ${res.status}: ${url}`);
  return (await res.json()) as T;
}

// Convert spot symbol "BTCUSDT" -> futures symbol "BTCUSDT" (same).
// But allow caller to pass either — be permissive.
function perp(symbol: string): string {
  return symbol.toUpperCase().endsWith("USDT")
    ? symbol.toUpperCase()
    : `${symbol.toUpperCase()}USDT`;
}

export async function fetchPremiumIndex(symbol: string): Promise<PremiumIndex> {
  const d = await getJson<{
    symbol: string;
    markPrice: string;
    indexPrice: string;
    lastFundingRate: string;
    nextFundingTime: number;
    time: number;
  }>(`${FAPI}/fapi/v1/premiumIndex?symbol=${perp(symbol)}`);
  return {
    symbol: d.symbol,
    markPrice: parseFloat(d.markPrice),
    indexPrice: parseFloat(d.indexPrice),
    lastFundingRate: parseFloat(d.lastFundingRate),
    nextFundingTime: d.nextFundingTime,
    time: d.time,
  };
}

export async function fetchFundingHistory(
  symbol: string,
  limit = 30,
): Promise<FundingRate[]> {
  const arr = await getJson<
    Array<{
      symbol: string;
      fundingTime: number;
      fundingRate: string;
      markPrice?: string;
    }>
  >(`${FAPI}/fapi/v1/fundingRate?symbol=${perp(symbol)}&limit=${limit}`);
  return arr.map((d) => ({
    symbol: d.symbol,
    fundingTime: d.fundingTime,
    fundingRate: parseFloat(d.fundingRate),
    markPrice: d.markPrice ? parseFloat(d.markPrice) : undefined,
  }));
}

export async function fetchOpenInterest(symbol: string): Promise<OpenInterest> {
  const d = await getJson<{
    symbol: string;
    sumOpenInterest: string;
    sumOpenInterestValue: string;
    timestamp: number;
  }>(`${FAPI}/fapi/v1/openInterest?symbol=${perp(symbol)}`);
  return {
    symbol: d.symbol,
    sumOpenInterest: parseFloat(d.sumOpenInterest),
    sumOpenInterestValue: parseFloat(d.sumOpenInterestValue),
    timestamp: d.timestamp,
  };
}

export async function fetchOpenInterestHist(
  symbol: string,
  period:
    | "5m"
    | "15m"
    | "30m"
    | "1h"
    | "2h"
    | "4h"
    | "6h"
    | "12h"
    | "1d" = "5m",
  limit = 30,
): Promise<OpenInterest[]> {
  const arr = await getJson<
    Array<{
      symbol: string;
      sumOpenInterest: string;
      sumOpenInterestValue: string;
      timestamp: number;
    }>
  >(
    `${FDATA}/openInterestHist?symbol=${perp(symbol)}&period=${period}&limit=${limit}`,
  );
  return arr.map((d) => ({
    symbol: d.symbol,
    sumOpenInterest: parseFloat(d.sumOpenInterest),
    sumOpenInterestValue: parseFloat(d.sumOpenInterestValue),
    timestamp: d.timestamp,
  }));
}

export async function fetchLongShortRatio(
  symbol: string,
  period:
    | "5m"
    | "15m"
    | "30m"
    | "1h"
    | "2h"
    | "4h"
    | "6h"
    | "12h"
    | "1d" = "15m",
  limit = 30,
): Promise<LongShortRatio[]> {
  const arr = await getJson<
    Array<{
      symbol: string;
      longShortRatio: string;
      longAccount: string;
      shortAccount: string;
      timestamp: number;
    }>
  >(
    `${FDATA}/globalLongShortAccountRatio?symbol=${perp(symbol)}&period=${period}&limit=${limit}`,
  );
  return arr.map((d) => ({
    symbol: d.symbol,
    longShortRatio: parseFloat(d.longShortRatio),
    longAccount: parseFloat(d.longAccount),
    shortAccount: parseFloat(d.shortAccount),
    timestamp: d.timestamp,
  }));
}

export async function fetchTakerBuySellRatio(
  symbol: string,
  period:
    | "5m"
    | "15m"
    | "30m"
    | "1h"
    | "2h"
    | "4h"
    | "6h"
    | "12h"
    | "1d" = "15m",
  limit = 30,
): Promise<TakerRatio[]> {
  const arr = await getJson<
    Array<{
      buySellRatio: string;
      buyVol: string;
      sellVol: string;
      timestamp: number;
    }>
  >(
    `${FDATA}/takerlongshortRatio?symbol=${perp(symbol)}&period=${period}&limit=${limit}`,
  );
  return arr.map((d) => ({
    buySellRatio: parseFloat(d.buySellRatio),
    buyVol: parseFloat(d.buyVol),
    sellVol: parseFloat(d.sellVol),
    timestamp: d.timestamp,
  }));
}

// ---- Derived helpers ----

export type FundingTone = "bullish" | "bearish" | "neutral";

export function fundingTone(rate: number): FundingTone {
  if (rate > 0.0001) return "bearish"; // longs pay shorts
  if (rate < -0.0001) return "bullish"; // shorts pay longs
  return "neutral";
}

export function formatBasis(
  mark: number,
  index: number,
): {
  abs: number;
  pct: number;
} {
  const abs = mark - index;
  const pct = index > 0 ? (abs / index) * 100 : 0;
  return { abs, pct };
}

export function msUntilFunding(nextFundingTime: number): number {
  return Math.max(0, nextFundingTime - Date.now());
}

export function formatCountdown(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatRatePct(rate: number, dp = 4): string {
  const pct = rate * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(dp)}%`;
}
