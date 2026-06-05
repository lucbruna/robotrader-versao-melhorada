import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  Layers,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import type { IndicatorSnapshot } from "@/lib/indicators";
import type { Ticker24h } from "@/lib/binance";
import {
  fetchLongShortRatio,
  fetchOpenInterest,
  fetchOpenInterestHist,
  fetchPremiumIndex,
  fetchTakerBuySellRatio,
  type LongShortRatio,
  type OpenInterest,
  type PremiumIndex,
  type TakerRatio,
} from "@/lib/futures-data";
import {
  computeConfluence,
  CATEGORY_WEIGHTS,
  CONFLUENCE_CATEGORIES,
  categoryFactors,
  categoryLabel,
  categoryScore,
  type Confluence,
  type Factor,
  type FactorTone,
} from "@/lib/confluence";

export function ConfluenceGauge({
  symbol,
  snap,
  ticker,
}: {
  symbol: string;
  snap: IndicatorSnapshot | null;
  ticker: Ticker24h | null;
}) {
  const [premium, setPremium] = useState<PremiumIndex | null>(null);
  const [oi, setOi] = useState<OpenInterest | null>(null);
  const [oiChange24h, setOiChange24h] = useState<number | null>(null);
  const [longShort, setLongShort] = useState<LongShortRatio | null>(null);
  const [taker, setTaker] = useState<TakerRatio | null>(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [p, o, oiHist, ls, tk] = await Promise.allSettled([
          fetchPremiumIndex(symbol),
          fetchOpenInterest(symbol),
          fetchOpenInterestHist(symbol, "1h", 25),
          fetchLongShortRatio(symbol, "1h", 1),
          fetchTakerBuySellRatio(symbol, "1h", 1),
        ]);
        if (!alive) return;
        if (p.status === "fulfilled") setPremium(p.value);
        if (o.status === "fulfilled") setOi(o.value);
        if (tk.status === "fulfilled") setTaker(tk.value[0] ?? null);
        if (ls.status === "fulfilled") setLongShort(ls.value[0] ?? null);
        if (oiHist.status === "fulfilled") {
          const h = oiHist.value;
          if (h.length >= 2) {
            const first = h[0]?.sumOpenInterestValue ?? 0;
            const last = h[h.length - 1]?.sumOpenInterestValue ?? 0;
            if (first > 0) setOiChange24h(((last - first) / first) * 100);
          }
        }
      } catch {
        /* silent — partial data is OK */
      }
    }
    void load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [symbol]);

  const conf: Confluence | null = useMemo(() => {
    if (!snap) return null;
    return computeConfluence({
      snap,
      ticker,
      premium,
      oi,
      oiChange24h,
      longShort,
      taker,
    });
  }, [snap, ticker, premium, oi, oiChange24h, longShort, taker]);

  if (!conf) {
    return (
      <Card className="flex h-full flex-col">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Layers className="size-3.5 text-primary" /> Confluence
          </CardTitle>
          <CardDescription>aguardando indicadores…</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-1 items-center justify-center text-[10px] text-muted-foreground">
          <Activity className="mr-1 size-3 animate-pulse" /> calculando
        </CardContent>
      </Card>
    );
  }

  const Icon =
    conf.tone === "bullish"
      ? TrendingUp
      : conf.tone === "bearish"
        ? TrendingDown
        : Minus;
  const toneColor =
    conf.tone === "bullish"
      ? "text-bull"
      : conf.tone === "bearish"
        ? "text-bear"
        : "text-muted-foreground";

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Layers className="size-3.5 text-primary" /> Confluence
        </CardTitle>
        <CardDescription>
          Score multi-fator · 6 categorias ponderadas
        </CardDescription>
      </CardHeader>

      <CardContent className="flex-1 space-y-3 overflow-y-auto p-3 scrollbar-thin">
        {/* Gauge */}
        <div className="flex flex-col items-center">
          <RadialGauge score={conf.score} tone={conf.tone} />
          <div className="mt-1 flex items-center gap-1.5">
            <Icon className={`size-3.5 ${toneColor}`} />
            <span className={`text-sm font-bold ${toneColor}`}>
              {conf.tone === "bullish"
                ? "BULLISH"
                : conf.tone === "bearish"
                  ? "BEARISH"
                  : "NEUTRO"}
            </span>
            <span className="text-[10px] text-muted-foreground tabular">
              · conf {conf.confidence}%
            </span>
          </div>
        </div>

        {/* Category breakdown */}
        <div className="space-y-1.5">
          {CONFLUENCE_CATEGORIES.map((c) => {
            const factors = categoryFactors(conf, c);
            if (factors.length === 0) return null;
            const catScore = categoryScore(conf, c);
            return (
              <CategoryRow
                key={c}
                label={categoryLabel(c)}
                weight={CATEGORY_WEIGHTS[c]}
                score={catScore}
                factors={factors}
              />
            );
          })}
        </div>

        {/* Top reasons */}
        {(conf.topBullish.length > 0 || conf.topBearish.length > 0) && (
          <div className="space-y-1.5 rounded-md border border-border bg-surface/50 p-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Principais sinais
            </div>
            {conf.topBullish.map((f) => (
              <div
                key={`b${f.id}`}
                className="flex items-start gap-1.5 text-[10px]"
              >
                <span className="text-bull">▲</span>
                <span className="flex-1">
                  <span className="font-medium">{f.label}:</span>{" "}
                  <span className="text-muted-foreground">{f.detail}</span>
                </span>
              </div>
            ))}
            {conf.topBearish.map((f) => (
              <div
                key={`B${f.id}`}
                className="flex items-start gap-1.5 text-[10px]"
              >
                <span className="text-bear">▼</span>
                <span className="flex-1">
                  <span className="font-medium">{f.label}:</span>{" "}
                  <span className="text-muted-foreground">{f.detail}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RadialGauge({ score, tone }: { score: number; tone: FactorTone }) {
  // 220x140 viewBox — half-circle gauge (semicircle from 180° to 360°)
  const cx = 110;
  const cy = 110;
  const r = 85;
  const startAngle = Math.PI; // 180° (left)
  const endAngle = 0; // 0° (right) — half circle
  const totalAngle = Math.PI; // half circle

  const valueAngle = startAngle - (score / 100) * totalAngle;
  const valueX = cx + r * Math.cos(valueAngle);
  const valueY = cy - r * Math.sin(valueAngle);

  // Build background arc (180° to 0° = 0 to 100 on the dial)
  const bgPath = describeArc(cx, cy, r, 180, 360);

  // Build value arc — only render the filled portion
  const fillEndAngle = 180 - (score / 100) * 180;
  const valuePath = describeArc(cx, cy, r, 180, fillEndAngle);

  const stroke =
    tone === "bullish"
      ? "var(--bull)"
      : tone === "bearish"
        ? "var(--bear)"
        : "var(--muted-foreground)";

  return (
    <svg
      viewBox="0 0 220 130"
      className="h-28 w-full"
      role="img"
      aria-label={`Confluence score ${score}`}
    >
      <defs>
        <linearGradient id="confluence-grad" x1="0" x2="1">
          <stop offset="0%" stopColor="var(--bear)" />
          <stop offset="50%" stopColor="var(--warning)" />
          <stop offset="100%" stopColor="var(--bull)" />
        </linearGradient>
      </defs>
      {/* Track */}
      <path
        d={bgPath}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="10"
        strokeLinecap="round"
      />
      {/* Fill */}
      <path
        d={valuePath}
        fill="none"
        stroke="url(#confluence-grad)"
        strokeWidth="10"
        strokeLinecap="round"
      />
      {/* Tick marks at 0/25/50/75/100 */}
      {[0, 25, 50, 75, 100].map((v) => {
        const a = startAngle - (v / 100) * totalAngle;
        const x1 = cx + (r - 14) * Math.cos(a);
        const y1 = cy - (r - 14) * Math.sin(a);
        const x2 = cx + (r - 6) * Math.cos(a);
        const y2 = cy - (r - 6) * Math.sin(a);
        return (
          <line
            key={v}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke="var(--muted-foreground)"
            strokeWidth={v === 50 ? 2 : 1}
            opacity={v === 50 ? 0.7 : 0.4}
          />
        );
      })}
      {/* Needle */}
      <line
        x1={cx}
        y1={cy}
        x2={valueX}
        y2={valueY}
        stroke={stroke}
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r="5" fill={stroke} />
      <text
        x={cx}
        y={cy - 28}
        textAnchor="middle"
        className="fill-foreground"
        style={{ fontSize: 26, fontWeight: 700 }}
      >
        {score}
      </text>
      <text
        x={cx}
        y={cy - 14}
        textAnchor="middle"
        className="fill-muted-foreground"
        style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: 1 }}
      >
        score
      </text>
    </svg>
  );
}

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  // Angles in degrees: 180 = left, 270 = top, 0 = right (canvas-flipped)
  // We invert Y by computing as (cx + r cos a, cy - r sin a)
  const a1 = (Math.PI / 180) * startDeg;
  const a2 = (Math.PI / 180) * endDeg;
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy - r * Math.sin(a1);
  const x2 = cx + r * Math.cos(a2);
  const y2 = cy - r * Math.sin(a2);
  const largeArc = Math.abs(endDeg - startDeg) > 180 ? 1 : 0;
  // For 180→360 (sweeping clockwise on the dial), sweep=1
  const sweep = 1;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2} ${y2}`;
}

function CategoryRow({
  label,
  weight,
  score,
  factors,
}: {
  label: string;
  weight: number;
  score: number;
  factors: Factor[];
}) {
  const dominantTone: FactorTone =
    score >= 60 ? "bullish" : score <= 40 ? "bearish" : "neutral";
  const barColor =
    dominantTone === "bullish"
      ? "bg-bull"
      : dominantTone === "bearish"
        ? "bg-bear"
        : "bg-muted-foreground";
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-[10px]">
        <span className="font-medium text-foreground">
          {label}{" "}
          <span className="text-muted-foreground">
            · {Math.round(weight * 100)}%
          </span>
        </span>
        <span className="tabular text-muted-foreground">{score}</span>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-accent">
        <div
          className={`absolute inset-y-0 left-0 ${barColor}`}
          style={{ width: `${score}%` }}
        />
        <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/30" />
      </div>
      <div className="mt-0.5 truncate text-[9px] text-muted-foreground">
        {factors
          .map((f) => `${f.label}: ${f.detail}`)
          .slice(0, 2)
          .join(" · ")}
      </div>
    </div>
  );
}
