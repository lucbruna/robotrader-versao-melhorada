import type { IndicatorSnapshot } from "@/lib/indicators";
import {
  Activity,
  AlertTriangle,
  Flame,
  Snowflake,
  TrendingUp,
  TrendingDown,
  Minus,
  Layers,
  Target,
} from "lucide-react";

function Stat({
  label,
  value,
  hint,
  tone,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "bull" | "bear" | "warn" | "muted";
  icon?: typeof Activity;
}) {
  const toneClass =
    tone === "bull"
      ? "text-bull"
      : tone === "bear"
        ? "text-bear"
        : tone === "warn"
          ? "text-[color:var(--warning)]"
          : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="size-3" />}
      </div>
      <div className={`mt-0.5 text-sm font-semibold tabular ${toneClass}`}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function RegimeIcon({ regime }: { regime: IndicatorSnapshot["volRegime"] }) {
  if (regime === "EXTREME") return <Flame className="size-3 text-bear" />;
  if (regime === "HIGH")
    return <Flame className="size-3 text-[color:var(--warning)]" />;
  if (regime === "LOW")
    return <Snowflake className="size-3 text-muted-foreground" />;
  return <Activity className="size-3 text-muted-foreground" />;
}

export function IndicatorsPanel({ snap }: { snap: IndicatorSnapshot }) {
  const fmt = (v: number | null, d = 2) => (v === null ? "—" : v.toFixed(d));

  const rsiTone: "bull" | "bear" | "warn" | "muted" =
    snap.rsi === null
      ? "muted"
      : snap.rsi < 30
        ? "bull"
        : snap.rsi > 70
          ? "bear"
          : "muted";

  const stochTone: "bull" | "bear" | "muted" =
    snap.stochK === null
      ? "muted"
      : snap.stochK < 20
        ? "bull"
        : snap.stochK > 80
          ? "bear"
          : "muted";

  const macdTone: "bull" | "bear" | "muted" =
    snap.macdHist === null ? "muted" : snap.macdHist > 0 ? "bull" : "bear";

  const trendTone: "bull" | "bear" | "muted" =
    snap.ema20 === null || snap.ema50 === null
      ? "muted"
      : snap.ema20 > snap.ema50
        ? "bull"
        : "bear";

  const structureTone: "bull" | "bear" | "muted" =
    snap.structure === "UP"
      ? "bull"
      : snap.structure === "DOWN"
        ? "bear"
        : "muted";

  const adxTone: "bull" | "warn" | "muted" =
    snap.adx === null
      ? "muted"
      : snap.adx < 20
        ? "muted"
        : snap.adx < 25
          ? "warn"
          : "bull";

  const volTone: "bull" | "bear" | "warn" | "muted" =
    snap.volRegime === "EXTREME"
      ? "bear"
      : snap.volRegime === "HIGH"
        ? "warn"
        : snap.volRegime === "LOW"
          ? "bull"
          : "muted";

  const vwapTone: "bull" | "bear" | "muted" =
    snap.vwap === null
      ? "muted"
      : snap.price > snap.vwap
        ? "bull"
        : snap.price < snap.vwap
          ? "bear"
          : "muted";

  const StructureIcon =
    snap.structure === "UP"
      ? TrendingUp
      : snap.structure === "DOWN"
        ? TrendingDown
        : Minus;

  return (
    <div className="space-y-2 p-3">
      {/* Row 1: Core momentum + trend */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat
          label="RSI (14)"
          value={fmt(snap.rsi, 1)}
          tone={rsiTone}
          hint={
            snap.rsi === null
              ? undefined
              : snap.rsi < 30
                ? "Sobrevendido"
                : snap.rsi > 70
                  ? "Sobrecomprado"
                  : "Neutro"
          }
        />
        <Stat
          label="MACD"
          value={fmt(snap.macd, 3)}
          tone={macdTone}
          hint={`hist ${fmt(snap.macdHist, 3)}`}
        />
        <Stat
          label="Estocástico"
          value={`${fmt(snap.stochK, 1)} / ${fmt(snap.stochD, 1)}`}
          tone={stochTone}
          hint={
            snap.stochK === null
              ? undefined
              : snap.stochK < 20
                ? "Sobrevendido"
                : snap.stochK > 80
                  ? "Sobrecomprado"
                  : "Neutro"
          }
        />
        <Stat
          label="ADX"
          value={fmt(snap.adx, 1)}
          tone={adxTone}
          hint={
            snap.adx === null
              ? undefined
              : snap.adx >= 25
                ? `+DI ${fmt(snap.plusDI, 0)} / -DI ${fmt(snap.minusDI, 0)}`
                : "Sem tendência"
          }
        />
      </div>

      {/* Row 2: Trend + structure */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat
          label="Estrutura"
          value={
            snap.structure === "UP"
              ? "Alta (HH/HL)"
              : snap.structure === "DOWN"
                ? "Baixa (LH/LL)"
                : "Range"
          }
          tone={structureTone}
          icon={StructureIcon}
        />
        <Stat
          label="Tendência"
          value={
            trendTone === "bull" ? "Alta" : trendTone === "bear" ? "Baixa" : "—"
          }
          tone={trendTone}
          hint="EMA20 vs EMA50"
        />
        <Stat
          label="EMA 200"
          value={fmt(snap.ema200)}
          tone={
            snap.ema200 !== null && snap.price > snap.ema200 ? "bull" : "bear"
          }
          hint={
            snap.ema200 !== null
              ? snap.price > snap.ema200
                ? "Preço acima"
                : "Preço abaixo"
              : undefined
          }
        />
        <Stat
          label="VWAP"
          value={fmt(snap.vwap)}
          tone={vwapTone}
          hint={
            snap.vwap !== null
              ? `${(((snap.price - snap.vwap) / snap.vwap) * 100).toFixed(2)}% vs preço`
              : undefined
          }
        />
      </div>

      {/* Row 3: Volatility + S/R */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Stat
          label="ATR (14)"
          value={fmt(snap.atr, 4)}
          hint={
            snap.atrPct !== null
              ? `${(snap.atrPct * 100).toFixed(2)}% do preço`
              : undefined
          }
        />
        <Stat
          label="Regime Vol."
          value={snap.volRegime}
          tone={volTone}
          icon={
            (
              <RegimeIcon regime={snap.volRegime} />
            ) as unknown as typeof Activity
          }
        />
        <Stat
          label="BB Width"
          value={
            snap.bbWidth !== null ? `${(snap.bbWidth * 100).toFixed(2)}%` : "—"
          }
          tone={snap.bbWidth !== null && snap.bbWidth < 0.02 ? "warn" : "muted"}
          hint={
            snap.bbWidth !== null && snap.bbWidth < 0.02
              ? "Bandas apertadas (squeeze)"
              : undefined
          }
        />
        <Stat
          label="Range 24h"
          value={
            snap.rangePos !== null
              ? `${(snap.rangePos * 100).toFixed(0)}%`
              : "—"
          }
          tone={
            snap.rangePos === null
              ? "muted"
              : snap.rangePos > 0.9
                ? "warn"
                : snap.rangePos < 0.1
                  ? "bull"
                  : "muted"
          }
          hint={
            snap.high24h !== null && snap.low24h !== null
              ? `${fmt(snap.low24h)} – ${fmt(snap.high24h)}`
              : undefined
          }
        />
      </div>

      {/* Row 4: S/R + OBV */}
      {snap.supports.length + snap.resistances.length > 0 && (
        <div className="rounded-md border border-border bg-surface p-3">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            <Layers className="size-3" /> Níveis S/R
          </div>
          <div className="mt-1.5 grid grid-cols-2 gap-2 text-[10px]">
            <div>
              <div className="flex items-center gap-1 text-bear">
                <Target className="size-3" /> Resistências
              </div>
              {snap.resistances.length === 0 ? (
                <div className="mt-1 text-muted-foreground">—</div>
              ) : (
                <div className="mt-1 space-y-0.5">
                  {snap.resistances.map((r, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between tabular"
                    >
                      <span className="text-foreground">R{i + 1}</span>
                      <span className="text-bear">{r.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-1 text-bull">
                <Target className="size-3" /> Suportes
              </div>
              {snap.supports.length === 0 ? (
                <div className="mt-1 text-muted-foreground">—</div>
              ) : (
                <div className="mt-1 space-y-0.5">
                  {snap.supports.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between tabular"
                    >
                      <span className="text-foreground">S{i + 1}</span>
                      <span className="text-bull">{s.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {snap.ema20Slope !== null && (
        <div className="text-[10px] text-muted-foreground">
          EMA20 slope (3 bars):{" "}
          <span
            className={
              snap.ema20Slope > 0
                ? "text-bull"
                : snap.ema20Slope < 0
                  ? "text-bear"
                  : ""
            }
          >
            {snap.ema20Slope >= 0 ? "+" : ""}
            {snap.ema20Slope.toFixed(3)}%
          </span>{" "}
          · OBV:{" "}
          <span
            className={
              snap.obvSlope > 0
                ? "text-bull"
                : snap.obvSlope < 0
                  ? "text-bear"
                  : ""
            }
          >
            {snap.obvSlope > 0
              ? "compra"
              : snap.obvSlope < 0
                ? "venda"
                : "neutro"}
          </span>
          {snap.volRegime === "EXTREME" && (
            <span className="ml-2 inline-flex items-center gap-0.5 text-bear">
              <AlertTriangle className="size-2.5" /> Volatilidade extrema
            </span>
          )}
        </div>
      )}
    </div>
  );
}
