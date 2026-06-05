import { useEffect, useRef } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type IPriceLine,
} from "lightweight-charts";
import type { Kline } from "@/lib/binance";
import {
  atr,
  bollinger,
  ema,
  vwap as vwapFn,
  type IndicatorSnapshot,
} from "@/lib/indicators";

type Overlays = {
  ema20: boolean;
  ema50: boolean;
  ema200: boolean;
  bb: boolean;
  vwap: boolean;
};

export function CandleChart({
  data,
  liveCandle,
  overlays,
  snap,
}: {
  data: Kline[];
  liveCandle: Kline | null;
  overlays: Overlays;
  snap: IndicatorSnapshot | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ema20Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const ema200Ref = useRef<ISeriesApi<"Line"> | null>(null);
  const bbUpRef = useRef<ISeriesApi<"Line"> | null>(null);
  const bbLoRef = useRef<ISeriesApi<"Line"> | null>(null);
  const vwapRef = useRef<ISeriesApi<"Line"> | null>(null);
  const atrUpRef = useRef<ISeriesApi<"Line"> | null>(null);
  const atrLoRef = useRef<ISeriesApi<"Line"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#a8b0bb",
        fontFamily: "ui-sans-serif, system-ui",
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.04)" },
        horzLines: { color: "rgba(255,255,255,0.04)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.06)" },
      timeScale: {
        borderColor: "rgba(255,255,255,0.06)",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: 1 },
      autoSize: true,
    });
    chartRef.current = chart;

    candleRef.current = chart.addSeries(CandlestickSeries, {
      upColor: "#0ecb81",
      downColor: "#f6465d",
      wickUpColor: "#0ecb81",
      wickDownColor: "#f6465d",
      borderVisible: false,
    });

    volRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "vol",
      color: "#3a4150",
    });
    chart.priceScale("vol").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    ema20Ref.current = chart.addSeries(LineSeries, {
      color: "#fcd535",
      lineWidth: 1,
    });
    ema50Ref.current = chart.addSeries(LineSeries, {
      color: "#7c5cff",
      lineWidth: 1,
    });
    ema200Ref.current = chart.addSeries(LineSeries, {
      color: "#22d3ee",
      lineWidth: 1,
    });
    bbUpRef.current = chart.addSeries(LineSeries, {
      color: "rgba(167,139,250,0.6)",
      lineWidth: 1,
      lineStyle: 2,
    });
    bbLoRef.current = chart.addSeries(LineSeries, {
      color: "rgba(167,139,250,0.6)",
      lineWidth: 1,
      lineStyle: 2,
    });
    vwapRef.current = chart.addSeries(LineSeries, {
      color: "rgba(252,213,53,0.5)",
      lineWidth: 1,
      lineStyle: 3,
    });
    atrUpRef.current = chart.addSeries(LineSeries, {
      color: "rgba(167,139,250,0.4)",
      lineWidth: 1,
      lineStyle: 3,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    atrLoRef.current = chart.addSeries(LineSeries, {
      color: "rgba(167,139,250,0.4)",
      lineWidth: 1,
      lineStyle: 3,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!candleRef.current || !volRef.current) return;
    candleRef.current.setData(
      data.map((k) => ({
        time: k.time as Time,
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
      })),
    );
    volRef.current.setData(
      data.map((k) => ({
        time: k.time as Time,
        value: k.volume,
        color:
          k.close >= k.open ? "rgba(14,203,129,0.45)" : "rgba(246,70,93,0.45)",
      })),
    );

    const closes = data.map((k) => k.close);
    const apply = (
      ref: React.RefObject<ISeriesApi<"Line"> | null>,
      values: (number | null)[],
      enabled: boolean,
    ) => {
      if (!ref.current) return;
      if (!enabled) {
        ref.current.setData([]);
        return;
      }
      ref.current.setData(
        values
          .map((v, i) =>
            v === null ? null : { time: data[i].time as Time, value: v },
          )
          .filter((x): x is { time: Time; value: number } => x !== null),
      );
    };

    apply(ema20Ref, ema(closes, 20), overlays.ema20);
    apply(ema50Ref, ema(closes, 50), overlays.ema50);
    apply(ema200Ref, ema(closes, 200), overlays.ema200);
    const b = bollinger(closes);
    apply(bbUpRef, b.upper, overlays.bb);
    apply(bbLoRef, b.lower, overlays.bb);

    if (overlays.vwap) {
      const vw = vwapFn(
        data.map((k) => ({
          time: k.time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
        })),
        96,
      );
      apply(vwapRef, vw, true);
    } else {
      apply(vwapRef, [], false);
    }

    // ATR projected bands over the last 50 bars
    if (snap?.atr && atrUpRef.current && atrLoRef.current) {
      const a = atr(
        data.map((k) => ({
          time: k.time,
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
        })),
        14,
      );
      const start = Math.max(0, data.length - 50);
      const up: { time: Time; value: number }[] = [];
      const lo: { time: Time; value: number }[] = [];
      for (let i = start; i < a.length; i++) {
        if (a[i] === null || data[i] === undefined) continue;
        up.push({
          time: data[i].time as Time,
          value: data[i].close + (a[i] as number),
        });
        lo.push({
          time: data[i].time as Time,
          value: data[i].close - (a[i] as number),
        });
      }
      atrUpRef.current.setData(up);
      atrLoRef.current.setData(lo);
    } else {
      atrUpRef.current?.setData([]);
      atrLoRef.current?.setData([]);
    }
  }, [data, overlays, snap?.atr]);

  useEffect(() => {
    if (!liveCandle || !candleRef.current || !volRef.current) return;
    candleRef.current.update({
      time: liveCandle.time as Time,
      open: liveCandle.open,
      high: liveCandle.high,
      low: liveCandle.low,
      close: liveCandle.close,
    });
    volRef.current.update({
      time: liveCandle.time as Time,
      value: liveCandle.volume,
      color:
        liveCandle.close >= liveCandle.open
          ? "rgba(14,203,129,0.45)"
          : "rgba(246,70,93,0.45)",
    });
  }, [liveCandle]);

  // Visualize S/R levels + VWAP via price lines
  useEffect(() => {
    if (!candleRef.current) return;
    priceLinesRef.current.forEach((l) => {
      try {
        candleRef.current?.removePriceLine(l);
      } catch {
        /* noop */
      }
    });
    priceLinesRef.current = [];
    if (!snap) return;
    const mk = (price: number, color: string, title: string) => {
      if (!candleRef.current) return;
      const line = candleRef.current.createPriceLine({
        price,
        color,
        lineWidth: 1,
        lineStyle: 2,
        axisLabelVisible: true,
        title,
      });
      priceLinesRef.current.push(line);
    };
    snap.resistances.forEach((r, i) => mk(r, "#f6465d", `R${i + 1}`));
    snap.supports.forEach((s, i) => mk(s, "#0ecb81", `S${i + 1}`));
    if (snap.vwap !== null) mk(snap.vwap, "#fcd535", "VWAP");
  }, [snap?.supports.join(","), snap?.resistances.join(","), snap?.vwap]);

  return <div ref={containerRef} className="h-full w-full" />;
}
