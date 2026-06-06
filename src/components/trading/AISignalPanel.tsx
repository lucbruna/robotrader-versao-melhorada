import { memo, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  Shield,
  AlertTriangle,
  Activity,
  Target,
  Crosshair,
  Clock,
  Zap,
  Flame,
  Snowflake,
  Waves,
  Send,
  MessageCircle,
  BookOpen,
  RefreshCw,
  Users,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getAISignal, type AIDecision } from "@/lib/ai-signal.functions";
import {
  fetchAIConsensus,
  fetchAISignal,
  fetchExplanation,
  isElectron,
  telegramSendSignal,
  telegramStatus,
  type ConsensusModelDecision,
  type ConsensusResult,
} from "@/lib/ai-client";
import { useConfluence, useRegimeLive } from "@/lib/hooks/useSymbolContext";
import {
  CONFLUENCE_CATEGORIES,
  categoryLabel,
  categoryScore,
} from "@/lib/confluence";
import type { IndicatorSnapshot, LocalSignal } from "@/lib/indicators";
import type { Ticker24h } from "@/lib/binance";

function AISignalPanelImpl({
  symbol,
  interval,
  snap,
  local,
  ticker,
  onExecute: onExecuteProp,
}: {
  symbol: string;
  interval: string;
  snap: IndicatorSnapshot;
  local: LocalSignal;
  ticker: Ticker24h | null;
  onExecute: (a: AIDecision) => void;
}) {
  const fetchAI = useServerFn(getAISignal);
  const [ai, setAI] = useState<AIDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<number>(0);
  const [tgReady, setTgReady] = useState(false);
  const [tgAuto, setTgAuto] = useState(true);
  const [tgSending, setTgSending] = useState(false);
  const [tgLastResult, setTgLastResult] = useState<string | null>(null);
  // #14 — LLM explainer
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainErr, setExplainErr] = useState<string | null>(null);
  const [explainCacheKey, setExplainCacheKey] = useState<string | null>(null);
  // #15 — Real confluence + regime from the live dashboard, used in the
  // LLM prompt and the explainer. Duplicates fetches done by ConfluenceGauge
  // and RegimeDetector, but the data is small and short-lived.
  const { confluence } = useConfluence(symbol, snap, ticker);
  const regimeLive = useRegimeLive(snap);

  // #16 — Mode toggle: "single" (default) = 1 model, "consensus" = 3 models
  // in parallel aggregated by vote.
  const [mode, setMode] = useState<"single" | "consensus">("single");
  const [consensus, setConsensus] = useState<ConsensusResult | null>(null);
  const [consensusExpanded, setConsensusExpanded] = useState(false);

  // #15 — Build the optional `confluence` + `regime` sub-payload for the
  // AI signal request. Aggregates the per-category scores into a flat dict
  // so the prompt can show e.g. "trend=82 | momentum=45 | ...".
  const buildContextPayload = () => {
    if (!confluence && !regimeLive) return {};
    const out: {
      confluence?: {
        score: number;
        tone: "bullish" | "bearish" | "neutral";
        confidence: number;
        topBullish: string[];
        topBearish: string[];
        categoryScores?: Record<string, number>;
      };
      regime?: {
        regime: "BULL_TREND" | "BEAR_TREND" | "RANGE" | "VOLATILE";
        confidence: {
          overall: number;
          trend: number;
          structure: number;
          momentum: number;
          volatility: number;
        };
        barsInRegime: number;
      };
    } = {};
    if (confluence) {
      const cats: Record<string, number> = {};
      for (const c of CONFLUENCE_CATEGORIES) {
        cats[categoryLabel(c)] = Math.round(categoryScore(confluence, c));
      }
      out.confluence = {
        score: Math.round(confluence.score),
        tone: confluence.tone,
        confidence: Math.round(confluence.confidence),
        topBullish: confluence.topBullish.map((f) => `${f.label}: ${f.detail}`),
        topBearish: confluence.topBearish.map((f) => `${f.label}: ${f.detail}`),
        categoryScores: cats,
      };
    }
    if (regimeLive) {
      out.regime = {
        regime: regimeLive.regime,
        confidence: {
          overall: Math.round(regimeLive.confidence.overall),
          trend: Math.round(regimeLive.confidence.trend),
          structure: Math.round(regimeLive.confidence.structure),
          momentum: Math.round(regimeLive.confidence.momentum),
          volatility: Math.round(regimeLive.confidence.volatility),
        },
        barsInRegime: regimeLive.barsInRegime,
      };
    }
    return out;
  };

  const refresh = async () => {
    if (!ticker) return;
    setLoading(true);
    setErr(null);
    try {
      const payload = {
        symbol,
        interval,
        price: snap.price,
        rsi: snap.rsi,
        macd: snap.macd,
        macdSignal: snap.macdSignal,
        macdHist: snap.macdHist,
        ema20: snap.ema20,
        ema50: snap.ema50,
        ema200: snap.ema200,
        ema20Slope: snap.ema20Slope,
        adx: snap.adx,
        plusDI: snap.plusDI,
        minusDI: snap.minusDI,
        atr: snap.atr,
        atrPct: snap.atrPct,
        bbUpper: snap.bbUpper,
        bbLower: snap.bbLower,
        bbWidth: snap.bbWidth,
        volRegime: snap.volRegime,
        stochK: snap.stochK,
        stochD: snap.stochD,
        vwap: snap.vwap,
        obvSlope: snap.obvSlope,
        structure: snap.structure,
        supports: snap.supports,
        resistances: snap.resistances,
        high24h: snap.high24h,
        low24h: snap.low24h,
        rangePos: snap.rangePos,
        change24h: ticker.priceChangePercent,
        volume24h: ticker.quoteVolume,
        openPosition: null,
        // #15 — Inject real confluence + regime from the dashboard
        ...buildContextPayload(),
      };
      if (mode === "consensus") {
        const r = await fetchAIConsensus(payload);
        setConsensus(r);
        setAI(r.decision);
      } else {
        const d = isElectron()
          ? await fetchAISignal(payload)
          : await fetchAI({ data: payload });
        setAI(d);
        setConsensus(null);
      }
      setLastUpdate(Date.now());
      // auto-send to Telegram on trade-worthy signal
      if (
        tgAuto &&
        tgReady &&
        ai &&
        (ai.action === "BUY" || ai.action === "SELL")
      ) {
        void doSendTelegram(ai);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro IA");
    } finally {
      setLoading(false);
    }
  };

  // Check Telegram availability once
  useEffect(() => {
    void telegramStatus().then((s) => setTgReady(!!s?.configured));
  }, []);

  // #19 — Listen for keyboard-shortcut events dispatched from the dashboard.
  // The events are "rt:refresh", "rt:execute", "rt:tg", "rt:toggleConsensus".
  // We expose them via window so the parent route's keyboard hook can fire
  // them without prop drilling. The events are bubbleable and
  // cancelable=false (the listener decides what to do).
  useEffect(() => {
    const onRefresh = () => void refresh();
    const onExecute = () => {
      if (ai && ai.action !== "HOLD") {
        onExecuteProp(ai);
      }
    };
    const onTg = () => {
      if (ai) void doSendTelegram(ai);
    };
    const onToggleConsensus = () =>
      setMode((m) => (m === "single" ? "consensus" : "single"));
    window.addEventListener("rt:refresh", onRefresh);
    window.addEventListener("rt:execute", onExecute);
    window.addEventListener("rt:tg", onTg);
    window.addEventListener("rt:toggleConsensus", onToggleConsensus);
    return () => {
      window.removeEventListener("rt:refresh", onRefresh);
      window.removeEventListener("rt:execute", onExecute);
      window.removeEventListener("rt:tg", onTg);
      window.removeEventListener("rt:toggleConsensus", onToggleConsensus);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ai]);

  const doSendTelegram = async (signal: AIDecision) => {
    setTgSending(true);
    setTgLastResult(null);
    try {
      const r = await telegramSendSignal(signal, symbol, interval, {
        currentPrice: snap.price,
        change24h: ticker?.priceChangePercent,
      });
      if (r && r.ok) {
        setTgLastResult(`✅ Enviado (id ${r.messageId})`);
        // #18 — toast on success
        toast.success("Sinal enviado ao Telegram", {
          description: `${symbol} ${interval} · ${signal.action} (id ${r.messageId})`,
        });
      } else {
        setTgLastResult(`❌ ${r?.error ?? "indisponível"}`);
        toast.error("Falha ao enviar ao Telegram", {
          description: r?.error ?? "indisponível",
        });
      }
    } catch (e) {
      setTgLastResult(`❌ ${e instanceof Error ? e.message : "erro"}`);
      toast.error("Erro Telegram", {
        description: e instanceof Error ? e.message : "erro",
      });
    } finally {
      setTgSending(false);
    }
  };

  // #14 — LLM explainer: builds the explainer payload from the same context
  // the AI decision used, then asks the server for a 2-4 sentence PT-BR
  // explanation. Result is cached by (action, score, regime, AI action)
  // for the lifetime of this panel instance to avoid re-billing on toggle.
  const buildExplainPayload = () => {
    // Pull top 3 local reasons for the prompt
    const localReasons = (local.reasons ?? []).slice(0, 5);
    return {
      symbol,
      interval,
      price: snap.price,
      rsi: snap.rsi,
      macdHist: snap.macdHist,
      ema20: snap.ema20,
      ema50: snap.ema50,
      ema200: snap.ema200,
      adx: snap.adx,
      plusDI: snap.plusDI,
      minusDI: snap.minusDI,
      atr: snap.atr,
      atrPct: snap.atrPct,
      bbWidth: snap.bbWidth,
      stochK: snap.stochK,
      stochD: snap.stochD,
      volRegime: snap.volRegime,
      structure: snap.structure,
      localAction: local.action,
      localScore: local.score,
      localConfidence: local.confidence,
      localReasons,
      // #15 — Real confluence/regime from the dashboard (not defaults)
      confluenceScore: confluence ? Math.round(confluence.score) : 50,
      confluenceTone: confluence ? confluence.tone : ("neutral" as const),
      regime: regimeLive ? regimeLive.regime : ("RANGE" as const),
      aiAction: ai?.action ?? null,
      aiConfidence: ai?.confidence ?? null,
      aiRationale: ai?.rationale ?? null,
    };
  };

  const doExplain = async () => {
    if (explaining) return;
    setExplaining(true);
    setExplainErr(null);
    try {
      const payload = buildExplainPayload();
      const key = `${payload.localAction}|${Math.round(payload.localScore)}|${payload.localConfidence}|${payload.regime}|${payload.aiAction ?? "-"}`;
      setExplainCacheKey(key);
      const r = await fetchExplanation(payload);
      setExplanation(r.explanation);
    } catch (e) {
      setExplainErr(e instanceof Error ? e.message : "Erro ao explicar");
    } finally {
      setExplaining(false);
    }
  };

  // auto-refresh every 60s on symbol/interval change
  useEffect(() => {
    setAI(null);
    setConsensus(null);
    setErr(null);
    setExplanation(null);
    setExplainErr(null);
    setExplainCacheKey(null);
    if (!ticker) return;
    refresh();
    const id = setInterval(refresh, 60000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, interval, mode]);

  const ActionIcon =
    local.action === "BUY"
      ? TrendingUp
      : local.action === "SELL"
        ? TrendingDown
        : Minus;
  const localTone =
    local.action === "BUY"
      ? "text-bull"
      : local.action === "SELL"
        ? "text-bear"
        : "text-muted-foreground";

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <Sparkles className="size-3.5 text-primary" />
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Sinais
          </span>
          {/* #16 — Mode toggle */}
          <div className="ml-1 flex items-center rounded border border-border bg-surface text-[10px]">
            <button
              onClick={() => setMode("single")}
              className={`px-1.5 py-0.5 ${
                mode === "single"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="IA única (1 modelo)"
            >
              IA
            </button>
            <button
              onClick={() => setMode("consensus")}
              className={`px-1.5 py-0.5 ${
                mode === "consensus"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title="Consenso de 3 modelos"
            >
              Consenso
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {tgReady && ai && (
            <>
              <button
                onClick={() => doSendTelegram(ai)}
                disabled={tgSending}
                title={
                  tgAuto
                    ? "Enviar sinal atual pro Telegram (auto-send ligado)"
                    : "Enviar sinal atual pro Telegram"
                }
                className="flex items-center gap-1 rounded bg-blue-500/10 px-2 py-1 text-[10px] uppercase tracking-wider text-blue-600 hover:bg-blue-500/20 disabled:opacity-50"
              >
                {tgSending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Send className="size-3" />
                )}
                Telegram
              </button>
              <button
                onClick={() => setTgAuto(!tgAuto)}
                title={
                  tgAuto ? "Auto-send Telegram: ON" : "Auto-send Telegram: OFF"
                }
                className={`rounded px-1.5 py-1 text-[10px] ${
                  tgAuto
                    ? "bg-blue-500/20 text-blue-600"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <MessageCircle className="size-3" />
              </button>
            </>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            className="rounded bg-accent px-2 py-1 text-[10px] uppercase tracking-wider text-foreground hover:bg-accent/70 disabled:opacity-50"
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              "Atualizar"
            )}
          </button>
        </div>
      </div>

      {tgLastResult && (
        <div className="border-b border-border bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground">
          {tgLastResult}
        </div>
      )}

      <div className="space-y-3 overflow-y-auto p-3 scrollbar-thin">
        {/* Local heuristic */}
        <div className="rounded-md border border-border bg-surface p-3">
          <div className="flex items-center justify-between">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Análise técnica
            </div>
            <div
              className={`flex items-center gap-1 text-sm font-semibold ${localTone}`}
            >
              <ActionIcon className="size-4" /> {local.action}
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <ScoreBar score={local.score} />
            <span className="text-[10px] tabular text-muted-foreground">
              {local.confidence}%
            </span>
          </div>
          {local.warnings.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {local.warnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1 text-[10px] text-[color:var(--warning)]"
                >
                  <AlertTriangle className="size-2.5 shrink-0" />
                  <span>{w}</span>
                </div>
              ))}
            </div>
          )}
          <ul className="mt-2 space-y-1">
            {local.reasons.map((r, i) => (
              <li key={i} className="text-[11px] text-muted-foreground">
                • {r}
              </li>
            ))}
          </ul>
        </div>

        {/* #16 — Consensus breakdown (only in consensus mode) */}
        {mode === "consensus" && consensus && (
          <div className="rounded-md border border-border bg-surface p-2">
            <button
              onClick={() => setConsensusExpanded((v) => !v)}
              className="flex w-full items-center justify-between text-[10px] uppercase tracking-wider text-muted-foreground"
            >
              <span className="flex items-center gap-1">
                <Users className="size-3" /> 3 modelos ·{" "}
                {consensus.consensusLabel} {consensus.agreement}%
              </span>
              <span className="flex items-center gap-1.5 text-[9px]">
                {consensus.models.map((m) => (
                  <span
                    key={m.id}
                    className={`flex size-2 rounded-full ${
                      m.ok ? "bg-bull" : "bg-bear"
                    }`}
                    title={`${m.label}: ${m.ok ? "OK" : m.error}`}
                  />
                ))}
                {consensusExpanded ? (
                  <ChevronUp className="size-3" />
                ) : (
                  <ChevronDown className="size-3" />
                )}
              </span>
            </button>
            {consensusExpanded && (
              <div className="mt-1.5 space-y-1">
                {consensus.models.map((m) => (
                  <ModelRow key={m.id} m={m} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* AI decision */}
        <div className="rounded-md border border-border bg-gradient-to-br from-surface to-surface-2 p-3 glow-primary">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-primary">
              <Sparkles className="size-3" />{" "}
              {mode === "consensus" ? "IA · Consenso" : "IA · Gemini"}
            </div>
            {ai && (
              <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] tabular text-foreground">
                conf {ai.confidence}%
              </span>
            )}
          </div>

          {loading && !ai && (
            <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" /> Analisando mercado…
            </div>
          )}

          {err && <div className="mt-2 text-[11px] text-bear">{err}</div>}

          {ai && (
            <>
              <div
                className={`mt-2 flex items-baseline gap-2 ${
                  ai.action === "BUY"
                    ? "text-bull"
                    : ai.action === "SELL"
                      ? "text-bear"
                      : ai.action === "CLOSE"
                        ? "text-[color:var(--warning)]"
                        : "text-muted-foreground"
                }`}
              >
                <span className="text-2xl font-bold">{ai.action}</span>
                <RegimeBadge regime={ai.regime} />
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Shield className="size-3" /> risco {ai.risk}
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                {ai.rationale}
              </p>
              {/* #14 — LLM explainer */}
              <div className="mt-2.5 rounded border border-border/60 bg-background/40 p-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <BookOpen className="size-3" /> Explicar com IA
                  </div>
                  <button
                    onClick={doExplain}
                    disabled={explaining}
                    className="flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-[10px] text-foreground hover:bg-accent/70 disabled:opacity-50"
                  >
                    {explaining ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : explanation ? (
                      <RefreshCw className="size-3" />
                    ) : (
                      <Sparkles className="size-3" />
                    )}
                    {explaining
                      ? "Gerando…"
                      : explanation
                        ? "Regerar"
                        : "Explicar"}
                  </button>
                </div>
                {explainErr && (
                  <div className="mt-1 text-[10px] text-bear">{explainErr}</div>
                )}
                {explanation && (
                  <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/90">
                    {explanation}
                  </p>
                )}
                {!explanation && !explaining && !explainErr && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Pede ao LLM uma explicação curta em PT-BR do porquê deste
                    setup, citando os indicadores mais relevantes.
                  </p>
                )}
              </div>
              <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-[10px]">
                <Pill label="Entry" value={ai.entry} />
                <Pill
                  label="Stop"
                  value={ai.stopLoss}
                  tone="bear"
                  hint={`-${(((ai.entry - ai.stopLoss) / ai.entry) * 100).toFixed(2)}%`}
                />
                <Pill
                  label="Target"
                  value={ai.takeProfit}
                  tone="bull"
                  hint={`+${(((ai.takeProfit - ai.entry) / ai.entry) * 100).toFixed(2)}%`}
                />
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px]">
                <Meta
                  icon={Activity}
                  label="R:R"
                  value={`${ai.rMultiple.toFixed(2)}`}
                  tone={ai.rMultiple >= 1.5 ? "bull" : "warn"}
                />
                <Meta icon={Clock} label="TTL" value={formatTtl(ai.ttl)} />
                <Meta
                  icon={Crosshair}
                  label="Regime"
                  value={ai.regime.replace("_", " ")}
                />
              </div>
              {ai.invalidation && (
                <div className="mt-2 flex items-start gap-1 rounded border border-border/60 bg-background/40 px-2 py-1.5 text-[10px]">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0 text-[color:var(--warning)]" />
                  <span className="text-muted-foreground">
                    <span className="text-foreground">Invalidação:</span>{" "}
                    {ai.invalidation}
                  </span>
                </div>
              )}
              <button
                onClick={() => onExecuteProp(ai)}
                disabled={ai.action === "HOLD"}
                className={`mt-3 w-full rounded-md px-3 py-2 text-xs font-semibold transition ${
                  ai.action === "BUY"
                    ? "bg-bull text-background hover:opacity-90 glow-bull"
                    : ai.action === "SELL"
                      ? "bg-bear text-background hover:opacity-90 glow-bear"
                      : ai.action === "CLOSE"
                        ? "bg-[color:var(--warning)] text-background hover:opacity-90"
                        : "bg-accent text-muted-foreground cursor-not-allowed"
                }`}
              >
                {ai.action === "HOLD"
                  ? "Aguardando…"
                  : ai.action === "CLOSE"
                    ? "Fechar posição aberta (simulado)"
                    : `Executar ${ai.action} (simulado)`}
              </button>
              {lastUpdate > 0 && (
                <div className="mt-1.5 text-center text-[9px] text-muted-foreground">
                  Atualizado {new Date(lastUpdate).toLocaleTimeString()}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// #20 — React.memo to avoid re-renders when the dashboard re-renders for
// unrelated reasons (ticker tick, snap update on a different symbol, etc).
// Equality on props is shallow; onExecuteProp identity matters but the
// parent uses an inline arrow — we accept that re-renders happen on
// parent re-render. Real win is preventing re-renders when AI
// state inside this component settles.
const AISignalPanelMemo = memo(AISignalPanelImpl);
export { AISignalPanelMemo as AISignalPanel };

function ModelRow({ m }: { m: ConsensusModelDecision }) {
  const tone =
    m.decision?.action === "BUY"
      ? "text-bull"
      : m.decision?.action === "SELL"
        ? "text-bear"
        : "text-muted-foreground";
  return (
    <div className="flex items-center justify-between gap-2 rounded bg-background/50 px-2 py-1 text-[10px]">
      <div className="flex items-center gap-1.5">
        {m.ok ? (
          <CheckCircle2 className="size-3 text-bull" />
        ) : (
          <XCircle className="size-3 text-bear" />
        )}
        <span className="font-medium text-foreground">{m.label}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">{m.durationMs}ms</span>
      </div>
      <div className="flex items-center gap-1.5">
        {m.ok && m.decision ? (
          <>
            <span className={`font-semibold ${tone}`}>{m.decision.action}</span>
            <span className="tabular text-muted-foreground">
              {m.decision.confidence}%
            </span>
          </>
        ) : (
          <span className="text-bear" title={m.error ?? ""}>
            {m.error ?? "falhou"}
          </span>
        )}
      </div>
    </div>
  );
}

function RegimeBadge({ regime }: { regime: AIDecision["regime"] }) {
  const map: Record<
    AIDecision["regime"],
    { icon: typeof Zap; label: string; cls: string }
  > = {
    TREND_UP: { icon: TrendingUp, label: "Tend. Alta", cls: "text-bull" },
    TREND_DOWN: { icon: TrendingDown, label: "Tend. Baixa", cls: "text-bear" },
    RANGE: { icon: Waves, label: "Range", cls: "text-muted-foreground" },
    VOLATILE: {
      icon: Flame,
      label: "Volátil",
      cls: "text-[color:var(--warning)]",
    },
    BREAKOUT: { icon: Zap, label: "Breakout", cls: "text-primary" },
  };
  const { icon: Icon, label, cls } = map[regime];
  return (
    <span
      className={`flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] ${cls}`}
    >
      <Icon className="size-3" /> {label}
    </span>
  );
}

function formatTtl(min: number): string {
  if (min < 60) return `${min}m`;
  if (min < 1440) return `${(min / 60).toFixed(1)}h`;
  return `${(min / 1440).toFixed(1)}d`;
}

function Pill({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone?: "bull" | "bear";
  hint?: string;
}) {
  const t =
    tone === "bull"
      ? "text-bull"
      : tone === "bear"
        ? "text-bear"
        : "text-foreground";
  return (
    <div className="rounded border border-border bg-background px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className={`tabular font-semibold ${t}`}>
        {value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
      </div>
      {hint && <div className="text-[9px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Meta({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Zap;
  label: string;
  value: string;
  tone?: "bull" | "bear" | "warn";
}) {
  const t =
    tone === "bull"
      ? "text-bull"
      : tone === "bear"
        ? "text-bear"
        : tone === "warn"
          ? "text-[color:var(--warning)]"
          : "text-foreground";
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-background/40 px-2 py-1">
      <Icon className="size-3 text-muted-foreground" />
      <div className="flex-1">
        <div className="text-[9px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
        <div className={`text-[10px] font-semibold ${t}`}>{value}</div>
      </div>
    </div>
  );
}

function ScoreBar({ score }: { score: number }) {
  const pct = (score + 100) / 2;
  return (
    <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-accent">
      <div
        className={`absolute inset-y-0 ${score >= 0 ? "left-1/2 bg-bull" : "right-1/2 bg-bear"}`}
        style={{ width: `${Math.abs(pct - 50)}%` }}
      />
      <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/30" />
    </div>
  );
}
