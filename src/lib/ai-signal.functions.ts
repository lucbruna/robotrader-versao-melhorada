import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const InputSchema = z.object({
  symbol: z.string().min(3).max(20),
  interval: z.string().min(1).max(5),
  price: z.number(),
  // Trend
  rsi: z.number().nullable(),
  macd: z.number().nullable(),
  macdSignal: z.number().nullable(),
  macdHist: z.number().nullable(),
  ema20: z.number().nullable(),
  ema50: z.number().nullable(),
  ema200: z.number().nullable(),
  ema20Slope: z.number().nullable(),
  adx: z.number().nullable(),
  plusDI: z.number().nullable(),
  minusDI: z.number().nullable(),
  // Volatility
  atr: z.number().nullable(),
  atrPct: z.number().nullable(),
  bbUpper: z.number().nullable(),
  bbLower: z.number().nullable(),
  bbWidth: z.number().nullable(),
  volRegime: z.enum(["LOW", "NORMAL", "HIGH", "EXTREME"]),
  // Momentum / Volume
  stochK: z.number().nullable(),
  stochD: z.number().nullable(),
  vwap: z.number().nullable(),
  obvSlope: z.number(),
  // Structure
  structure: z.enum(["UP", "DOWN", "RANGE"]),
  supports: z.array(z.number()),
  resistances: z.array(z.number()),
  // Range
  high24h: z.number().nullable(),
  low24h: z.number().nullable(),
  rangePos: z.number().nullable(),
  // Market
  change24h: z.number(),
  volume24h: z.number(),
  // Open position context (if any)
  openPosition: z
    .object({
      side: z.enum(["BUY", "SELL"]),
      entry: z.number(),
      pnl: z.number(),
      pnlPct: z.number(),
      stop: z.number(),
      target: z.number(),
    })
    .nullable(),
  // #15 — Optional context from downstream components
  confluence: z
    .object({
      score: z.number(), // 0..100
      tone: z.enum(["bullish", "bearish", "neutral"]),
      confidence: z.number(), // 0..100
      topBullish: z.array(z.string()),
      topBearish: z.array(z.string()),
      // Optional per-category score breakdown (0..100)
      categoryScores: z.record(z.string(), z.number()).optional(),
    })
    .optional(),
  regime: z
    .object({
      regime: z.enum(["BULL_TREND", "BEAR_TREND", "RANGE", "VOLATILE"]),
      confidence: z.object({
        overall: z.number(),
        trend: z.number(),
        structure: z.number(),
        momentum: z.number(),
        volatility: z.number(),
      }),
      barsInRegime: z.number(),
    })
    .optional(),
});

export type AIDecision = {
  action: "BUY" | "SELL" | "HOLD" | "CLOSE";
  confidence: number; // 0..100
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rationale: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  // New fields
  regime: "TREND_UP" | "TREND_DOWN" | "RANGE" | "VOLATILE" | "BREAKOUT";
  rMultiple: number; // expected R:R of the trade
  invalidation: string; // human-readable invalidation condition
  ttl: number; // suggested trade TTL in minutes
};

export const getAISignal = createServerFn({ method: "POST" })
  .inputValidator((d: z.infer<typeof InputSchema>) => InputSchema.parse(d))
  .handler(async ({ data }): Promise<AIDecision> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      return synthesize(data, {
        action: "HOLD",
        confidence: 0,
        rationale: "IA indisponível (LOVABLE_API_KEY ausente).",
        risk: "HIGH",
        regime: "RANGE",
      });
    }

    const system = `Você é um trader quantitativo sênior de cripto com 15 anos de experiência. Analise o contexto técnico e de mercado fornecido e retorne SOMENTE JSON válido.

CONTEXTO MULTI-FATOR (use na decisão, não invente números):
- "confluence" (opcional): score 0-100 (50=neutro), tone (bullish/bearish/neutral), confidence 0-100, topBullish[]/topBearish[] com strings curtas explicando os sinais, e categoryScores opcional {trend, momentum, volatility, volume, levels, derivatives}.
- "regime" (opcional): regime de mercado (BULL_TREND/BEAR_TREND/RANGE/VOLATILE), confidence {overall, trend, structure, momentum, volatility} todas 0-100, e barsInRegime (quantas barras consecutivas no regime atual).

SAÍDA OBRIGATÓRIA (apenas este JSON, sem markdown):
{
  "action": "BUY" | "SELL" | "HOLD" | "CLOSE",
  "confidence": 0-100,
  "entry": number,
  "stopLoss": number,
  "takeProfit": number,
  "rationale": "explicação curta em português (max 240 chars)",
  "risk": "LOW" | "MEDIUM" | "HIGH",
  "regime": "TREND_UP" | "TREND_DOWN" | "RANGE" | "VOLATILE" | "BREAKOUT",
  "rMultiple": number (1.0-5.0),
  "invalidation": "condição que invalida o trade em pt-BR",
  "ttl": number (minutos sugeridos, 15-720)
}

REGRAS DE DECISÃO:
1. PREFIRA HOLD quando os indicadores conflitam (RSI vs MACD vs estrutura) ou ADX < 20.
2. STOP-LOSS: SEMPRE use ATR como base. SL = entry ± k*ATR, com k entre 1.2 e 2.5 conforme volatilidade.
   - volRegime LOW/NORMAL: k=1.5
   - volRegime HIGH: k=2.0
   - volRegime EXTREME: k=2.5 ou HOLD
3. TAKE-PROFIT: RR mínimo 1.5:1. Em tendência forte (ADX>30 + structure alinhado), almeje RR 2.5-3.5.
4. SUPORTES/RESISTÊNCIAS: posicione o SL atrás do S/R relevante (não dentro).
5. ESTRUTURA: trade SOMENTE na direção da estrutura (UP→BUY, DOWN→SELL). Em RANGE, prefira HOLD.
6. VWAP: preço abaixo do VWAP favorece BUY, acima favorece SELL (intraday).
7. RSI extremo (<25 ou >75) sozinho NÃO é motivo para entrada — espere confirmação de estrutura.
8. POSIÇÃO ABERTA: se "openPosition" existir, considere CLOSE se o sinal oposto for forte OU se Stop/TP foram atingidos OU se regime mudou contra a posição.
9. CONFIANÇA:
   - < 50: HOLD (sinal fraco)
   - 50-70: trade válido mas com posição reduzida
   - 70-85: trade com convicção normal
   - > 85: trade com alta convicção (mas não exagere: >95 é suspeito)
10. RÓTULO risk: LOW = setup perfeito, HIGH = sinais conflitantes, MEDIUM = caso padrão.
11. TTL: scalping (5m/15m) → 30-90min; intraday (1h) → 4-8h; swing (4h/1d) → 1-7 dias.
12. INVALIDAÇÃO: descreva a condição técnica que fecharia a posição prematuramente (ex: "fechar abaixo da EMA50").
13. CONFLUENCE & REGIME (se fornecidos, são fortes modificadores):
    - Se confluence.score >= 70 e tone bate com a direção do trade → pode elevar confidence em +10 e buscar RR maior.
    - Se confluence.score <= 30 e tone oposto ao trade proposto → zere a confidence ou vire HOLD.
    - Se regime.regime === "BULL_TREND" e você sugere SELL → reavalie com cuidado (pode ser topo de reversão apenas se estrutura virou DOWN).
    - Se regime.regime === "VOLATILE" → reduza TTL, aperte SL (k=2.0+), e prefira HOLD se ADX<25.
    - Se regime.barsInRegime <= 2 → trate como regime nascente, exija mais confirmação.
    - Em RANGE, priorize S/R (suporte→BUY perto de suporte, resistência→SELL perto de resistência).`;

    const userMsg = formatPrompt(data);

    try {
      const res = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: system },
              { role: "user", content: userMsg },
            ],
            response_format: { type: "json_object" },
            temperature: 0.2,
          }),
        },
      );

      if (res.status === 429) {
        return synthesize(data, {
          action: "HOLD",
          confidence: 0,
          rationale: "Limite de requisições atingido. Tente em instantes.",
          risk: "HIGH",
          regime: "RANGE",
        });
      }
      if (res.status === 402) {
        return synthesize(data, {
          action: "HOLD",
          confidence: 0,
          rationale: "Créditos de IA esgotados no workspace.",
          risk: "HIGH",
          regime: "RANGE",
        });
      }
      if (!res.ok) {
        return synthesize(data, {
          action: "HOLD",
          confidence: 0,
          rationale: `Erro IA ${res.status}`,
          risk: "HIGH",
          regime: "RANGE",
        });
      }

      const j = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const txt = j.choices?.[0]?.message?.content ?? "{}";
      let parsed: Partial<AIDecision> = {};
      try {
        parsed = JSON.parse(txt);
      } catch {
        return synthesize(data, {
          action: "HOLD",
          confidence: 0,
          rationale: "Resposta da IA inválida.",
          risk: "HIGH",
          regime: "RANGE",
        });
      }

      return validateAndEnrich(parsed, data);
    } catch (err) {
      console.error("AI signal error", err);
      return synthesize(data, {
        action: "HOLD",
        confidence: 0,
        rationale: "Falha ao consultar IA.",
        risk: "HIGH",
        regime: "RANGE",
      });
    }
  });

function formatPrompt(d: z.infer<typeof InputSchema>): string {
  const fmt = (v: number | null | undefined, d = 2) =>
    v === null || v === undefined ? "n/a" : v.toFixed(d);
  const lines: string[] = [];
  lines.push(`ATIVO: ${d.symbol} (${d.interval})`);
  lines.push(`PREÇO ATUAL: ${d.price}`);
  lines.push(``);
  lines.push(`=== MERCADO 24H ===`);
  lines.push(`Variação: ${d.change24h.toFixed(2)}%`);
  lines.push(
    `Volume 24h (USDT): ${d.volume24h.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
  );
  lines.push(
    `Range 24h: ${fmt(d.low24h)} - ${fmt(d.high24h)} | Posição no range: ${d.rangePos !== null ? (d.rangePos * 100).toFixed(0) + "%" : "n/a"}`,
  );
  lines.push(``);
  lines.push(`=== MOMENTUM ===`);
  lines.push(`RSI(14): ${fmt(d.rsi, 1)}`);
  lines.push(
    `MACD: ${fmt(d.macd, 4)} | Sinal: ${fmt(d.macdSignal, 4)} | Hist: ${fmt(d.macdHist, 4)}`,
  );
  lines.push(`Estocástico K/D: ${fmt(d.stochK, 1)} / ${fmt(d.stochD, 1)}`);
  lines.push(``);
  lines.push(`=== TENDÊNCIA ===`);
  lines.push(
    `EMA20: ${fmt(d.ema20)} | EMA50: ${fmt(d.ema50)} | EMA200: ${fmt(d.ema200)}`,
  );
  lines.push(`EMA20 slope (3 bars): ${fmt(d.ema20Slope, 3)}%`);
  lines.push(
    `ADX: ${fmt(d.adx, 1)} | +DI: ${fmt(d.plusDI, 1)} | -DI: ${fmt(d.minusDI, 1)}`,
  );
  lines.push(`Estrutura de mercado: ${d.structure}`);
  lines.push(``);
  lines.push(`=== VOLATILIDADE ===`);
  lines.push(
    `ATR(14): ${fmt(d.atr, 4)} (${d.atrPct !== null ? (d.atrPct * 100).toFixed(2) + "%" : "n/a"} do preço)`,
  );
  lines.push(`Regime: ${d.volRegime}`);
  lines.push(
    `Bollinger: ${fmt(d.bbLower)} - ${fmt(d.bbUpper)} | Width: ${d.bbWidth !== null ? (d.bbWidth * 100).toFixed(2) + "%" : "n/a"}`,
  );
  lines.push(``);
  lines.push(`=== VOLUME / FLUXO ===`);
  lines.push(`VWAP: ${fmt(d.vwap)}`);
  lines.push(
    `OBV slope: ${d.obvSlope === 1 ? "compra" : d.obvSlope === -1 ? "venda" : "neutro"}`,
  );
  lines.push(``);
  lines.push(`=== NÍVEIS CHAVE ===`);
  lines.push(
    `Suportes: ${d.supports.length ? d.supports.map((s) => s.toFixed(2)).join(", ") : "nenhum próximo"}`,
  );
  lines.push(
    `Resistências: ${d.resistances.length ? d.resistances.map((r) => r.toFixed(2)).join(", ") : "nenhuma próxima"}`,
  );

  // #15 — Confluence breakdown (multi-factor score with weights)
  if (d.confluence) {
    lines.push(``);
    lines.push(`=== CONFLUENCE (multi-fator) ===`);
    lines.push(
      `Score: ${d.confluence.score}/100 · Tone: ${d.confluence.tone.toUpperCase()} · Confiança: ${d.confluence.confidence}%`,
    );
    if (d.confluence.categoryScores) {
      const cats = Object.entries(d.confluence.categoryScores)
        .map(([k, v]) => `${k}=${v}`)
        .join(" | ");
      if (cats) lines.push(`Categorias: ${cats}`);
    }
    if (d.confluence.topBullish.length > 0) {
      lines.push(
        `Top bullish: ${d.confluence.topBullish.slice(0, 3).join(" · ")}`,
      );
    }
    if (d.confluence.topBearish.length > 0) {
      lines.push(
        `Top bearish: ${d.confluence.topBearish.slice(0, 3).join(" · ")}`,
      );
    }
  }

  // #15 — Regime classification with per-dimension confidence
  if (d.regime) {
    lines.push(``);
    lines.push(`=== REGIME DE MERCADO ===`);
    lines.push(
      `Regime: ${d.regime.regime} (${d.regime.barsInRegime} barras no regime atual)`,
    );
    lines.push(
      `Confiança — geral: ${d.regime.confidence.overall}% | tendência: ${d.regime.confidence.trend}% | estrutura: ${d.regime.confidence.structure}% | momentum: ${d.regime.confidence.momentum}% | volatilidade: ${d.regime.confidence.volatility}%`,
    );
  }

  lines.push(``);
  lines.push(
    d.openPosition
      ? `=== POSIÇÃO ABERTA ===\nLado: ${d.openPosition.side}\nEntrada: ${d.openPosition.entry}\nPnL: ${d.openPosition.pnl.toFixed(2)} (${d.openPosition.pnlPct.toFixed(2)}%)\nStop: ${d.openPosition.stop} | Alvo: ${d.openPosition.target}\nConsidere CLOSE se contexto virou contra.`
      : `=== SEM POSIÇÃO ABERTA ===`,
  );
  return lines.join("\n");
}

function validateAndEnrich(
  parsed: Partial<AIDecision>,
  data: z.infer<typeof InputSchema>,
): AIDecision {
  // Force consistent SL/TP using ATR if AI provided nonsense
  const atr = data.atr ?? data.price * 0.02;
  const k =
    data.volRegime === "EXTREME" ? 2.5 : data.volRegime === "HIGH" ? 2.0 : 1.5;

  const action: AIDecision["action"] =
    parsed.action === "BUY" || parsed.action === "SELL"
      ? parsed.action
      : parsed.action === "CLOSE"
        ? "CLOSE"
        : "HOLD";

  // If CLOSE, keep entry=current price
  const entry = Number(parsed.entry) || data.price;

  let stop = Number(parsed.stopLoss);
  if (!isFinite(stop) || stop <= 0) {
    stop = action === "BUY" ? entry - atr * k : entry + atr * k;
  }
  let target = Number(parsed.takeProfit);
  if (!isFinite(target) || target <= 0) {
    target = action === "BUY" ? entry + atr * k * 2 : entry - atr * k * 2;
  }
  // Sanity: SL must be on correct side
  if (action === "BUY" && stop >= entry) stop = entry - atr * k;
  if (action === "SELL" && stop <= entry) stop = entry + atr * k;
  if (action === "BUY" && target <= entry) target = entry + atr * k * 2;
  if (action === "SELL" && target >= entry) target = entry - atr * k * 2;

  // Compute R-multiple
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const rMultiple = risk > 0 ? reward / risk : 1;

  // Cap confidence in extreme vol unless strong evidence
  let confidence = Math.max(0, Math.min(100, Number(parsed.confidence) || 0));
  if (data.volRegime === "EXTREME" && confidence > 70) confidence = 70;
  if (data.structure === "RANGE" && (action === "BUY" || action === "SELL")) {
    confidence = Math.min(confidence, 55);
  }

  // #15 — Confluence & regime modifiers
  if (data.confluence) {
    const tone = data.confluence.tone;
    const score = data.confluence.score;
    // Strong bullish confluence aligned with a BUY → +10 confidence
    if (tone === "bullish" && score >= 70 && action === "BUY") {
      confidence = Math.min(100, confidence + 10);
    }
    // Strong bearish confluence aligned with a SELL → +10 confidence
    else if (tone === "bearish" && score <= 30 && action === "SELL") {
      confidence = Math.min(100, confidence + 10);
    }
    // Strong confluence AGAINST the action → kill or flip to HOLD
    if (
      (tone === "bullish" && score >= 70 && action === "SELL") ||
      (tone === "bearish" && score <= 30 && action === "BUY")
    ) {
      confidence = 0;
    }
  }
  if (data.regime) {
    const rg = data.regime.regime;
    // Volatile regime + any directional action → cap confidence
    if (rg === "VOLATILE" && (action === "BUY" || action === "SELL")) {
      confidence = Math.min(confidence, 60);
    }
    // Nascente regime (≤2 bars) → exige mais confirmação
    if (
      data.regime.barsInRegime <= 2 &&
      (action === "BUY" || action === "SELL")
    ) {
      confidence = Math.min(confidence, 50);
    }
    // Counter-trend action in well-established trend → penaliza
    if (
      rg === "BULL_TREND" &&
      action === "SELL" &&
      data.regime.barsInRegime >= 4
    ) {
      confidence = Math.min(confidence, 40);
    }
    if (
      rg === "BEAR_TREND" &&
      action === "BUY" &&
      data.regime.barsInRegime >= 4
    ) {
      confidence = Math.min(confidence, 40);
    }
  }
  // After all modifiers, if confidence is too low, downgrade to HOLD
  if (confidence < 50 && (action === "BUY" || action === "SELL")) {
    // Keep the action but mark low confidence — caller decides what to do
    // (existing UI: confidence% is shown but button is enabled).
  }

  const regime: AIDecision["regime"] = (() => {
    const r = parsed.regime;
    if (
      r === "TREND_UP" ||
      r === "TREND_DOWN" ||
      r === "RANGE" ||
      r === "VOLATILE" ||
      r === "BREAKOUT"
    )
      return r;
    if (data.volRegime === "EXTREME" || data.volRegime === "HIGH")
      return "VOLATILE";
    if (data.structure === "UP") return "TREND_UP";
    if (data.structure === "DOWN") return "TREND_DOWN";
    return "RANGE";
  })();

  return {
    action,
    confidence,
    entry,
    stopLoss: stop,
    takeProfit: target,
    rationale: String(parsed.rationale || "Sem justificativa.").slice(0, 280),
    risk:
      parsed.risk === "LOW" || parsed.risk === "HIGH" ? parsed.risk : "MEDIUM",
    regime,
    rMultiple: Math.max(
      0.5,
      Math.min(5, Number(parsed.rMultiple) || rMultiple),
    ),
    invalidation: String(parsed.invalidation || "Stop loss atingido").slice(
      0,
      140,
    ),
    ttl: Math.max(15, Math.min(10080, Number(parsed.ttl) || 240)),
  };
}

// Synthesise a decision locally when AI is unavailable — uses indicator rules
function synthesize(
  data: z.infer<typeof InputSchema>,
  base: {
    action: AIDecision["action"];
    confidence: number;
    rationale: string;
    risk: AIDecision["risk"];
    regime: AIDecision["regime"];
  },
): AIDecision {
  const atr = data.atr ?? data.price * 0.02;
  const k =
    data.volRegime === "EXTREME" ? 2.5 : data.volRegime === "HIGH" ? 2.0 : 1.5;
  const action = base.action;
  let stop = data.price;
  let target = data.price;

  if (action === "BUY") {
    stop = data.price - atr * k;
    target = data.price + atr * k * 2;
  } else if (action === "SELL") {
    stop = data.price + atr * k;
    target = data.price - atr * k * 2;
  } else if (action === "CLOSE") {
    stop = data.price;
    target = data.price;
  }

  return {
    ...base,
    entry: data.price,
    stopLoss: stop,
    takeProfit: target,
    rMultiple: k > 0 ? 2 / k : 1.5,
    invalidation: "Stop loss atingido",
    ttl: 240,
  };
}

// ---------------------------------------------------------------------------
// Signal explainer (#14) — natural-language explanation of the current setup
// ---------------------------------------------------------------------------

const ExplainInputSchema = z.object({
  symbol: z.string(),
  interval: z.string(),
  price: z.number(),
  // Same core context as getAISignal
  rsi: z.number().nullable(),
  macdHist: z.number().nullable(),
  ema20: z.number().nullable(),
  ema50: z.number().nullable(),
  ema200: z.number().nullable(),
  adx: z.number().nullable(),
  plusDI: z.number().nullable(),
  minusDI: z.number().nullable(),
  atr: z.number().nullable(),
  atrPct: z.number().nullable(),
  bbWidth: z.number().nullable(),
  stochK: z.number().nullable(),
  stochD: z.number().nullable(),
  volRegime: z.enum(["LOW", "NORMAL", "HIGH", "EXTREME"]),
  structure: z.enum(["UP", "DOWN", "RANGE"]),
  // Decision context
  localAction: z.enum(["BUY", "SELL", "HOLD"]),
  localScore: z.number(), // -100..100
  localConfidence: z.number(), // 0..100
  localReasons: z.array(z.string()),
  // Confluence + regime
  confluenceScore: z.number(), // 0..100
  confluenceTone: z.enum(["bullish", "bearish", "neutral"]),
  regime: z.enum(["BULL_TREND", "BEAR_TREND", "RANGE", "VOLATILE"]),
  // AI decision (optional — if present, explain it; if not, just explain the setup)
  aiAction: z.enum(["BUY", "SELL", "HOLD", "CLOSE"]).nullable(),
  aiConfidence: z.number().nullable(),
  aiRationale: z.string().nullable(),
});

export type ExplainInput = z.infer<typeof ExplainInputSchema>;

export type ExplainResult = {
  explanation: string;
  /** Key points the LLM highlighted, useful for tooltips / bullets. */
  highlights: string[];
  /** True if the model refused or returned a fallback. */
  fallback: boolean;
  /** Wall-clock duration in ms. */
  durationMs: number;
};

export const explainSignal = createServerFn({ method: "POST" })
  .inputValidator((d: ExplainInput) => ExplainInputSchema.parse(d))
  .handler(async ({ data }): Promise<ExplainResult> => {
    const t0 = Date.now();
    const apiKey = process.env.LOVABLE_API_KEY;

    // Local fallback: synthesise a deterministic 1-paragraph explanation
    // from the indicators so the feature always works.
    const fallbackText = synthesizeExplanation(data);
    const fallback: ExplainResult = {
      explanation: fallbackText,
      highlights: extractHighlights(data),
      fallback: true,
      durationMs: Date.now() - t0,
    };

    if (!apiKey) return fallback;

    const system = `Você é um analista técnico que escreve explicações claras e curtas em português brasileiro para traders. Receberá um snapshot de indicadores + o sinal local + o regime de mercado + o score de confluence (multi-fator) e (opcionalmente) a decisão da IA. Sua tarefa é explicar POR QUE o setup está como está.

REGRAS:
- Texto curto: 2-4 frases, no MÁXIMO 380 caracteres.
- Cite APENAS indicadores relevantes (RSI, MACD, EMA, ADX, BB, estrutura, regime, confluence). Não invente números.
- Se o regime ou a confluence discorda do sinal local, mencione brevemente.
- NÃO use markdown, listas, JSON ou aspas. Apenas texto corrido.
- NÃO dê conselho financeiro. Termine com "Análise automatizada, não é recomendação."`;

    const userMsg = formatExplainPrompt(data);

    try {
      const res = await fetch(
        "https://ai.gateway.lovable.dev/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            messages: [
              { role: "system", content: system },
              { role: "user", content: userMsg },
            ],
            temperature: 0.4,
            max_tokens: 220,
          }),
        },
      );
      if (!res.ok) return fallback;
      const json = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text || text.length < 20) return fallback;

      return {
        explanation: text.slice(0, 600),
        highlights: extractHighlights(data),
        fallback: false,
        durationMs: Date.now() - t0,
      };
    } catch {
      return fallback;
    }
  });

function formatExplainPrompt(d: ExplainInput): string {
  const fmt = (n: number | null, p = 2) => (n === null ? "n/d" : n.toFixed(p));
  const parts: string[] = [];
  parts.push(`# ${d.symbol} ${d.interval} @ ${fmt(d.price)}`);
  parts.push("");
  parts.push("Sinal local:");
  parts.push(`- action: ${d.localAction}`);
  parts.push(`- score: ${d.localScore.toFixed(0)} (-100..100)`);
  parts.push(`- confidence: ${d.localConfidence.toFixed(0)}%`);
  if (d.localReasons.length > 0) {
    parts.push(`- reasons: ${d.localReasons.slice(0, 5).join("; ")}`);
  }
  parts.push("");
  parts.push("Contexto:");
  parts.push(`- regime: ${d.regime}`);
  parts.push(
    `- confluence: ${d.confluenceScore.toFixed(0)} (${d.confluenceTone})`,
  );
  parts.push(`- volRegime: ${d.volRegime}`);
  parts.push(`- structure: ${d.structure}`);
  parts.push("");
  parts.push("Indicadores:");
  parts.push(
    `- RSI: ${fmt(d.rsi)} | MACD hist: ${fmt(d.macdHist, 4)} | Stoch K/D: ${fmt(d.stochK)}/${fmt(d.stochD)}`,
  );
  parts.push(
    `- EMA 20/50/200: ${fmt(d.ema20)} / ${fmt(d.ema50)} / ${fmt(d.ema200)}`,
  );
  parts.push(
    `- ADX: ${fmt(d.adx)} (+DI ${fmt(d.plusDI)} / -DI ${fmt(d.minusDI)})`,
  );
  parts.push(
    `- ATR: ${fmt(d.atr)} (${d.atrPct !== null ? (d.atrPct * 100).toFixed(2) + "%" : "n/d"}) | BB width: ${d.bbWidth !== null ? (d.bbWidth * 100).toFixed(1) + "%" : "n/d"}`,
  );
  if (d.aiAction) {
    parts.push("");
    parts.push("IA:");
    parts.push(`- action: ${d.aiAction} (${d.aiConfidence ?? 0}%)`);
    if (d.aiRationale)
      parts.push(`- rationale: ${d.aiRationale.slice(0, 200)}`);
  }
  return parts.join("\n");
}

function synthesizeExplanation(d: ExplainInput): string {
  // Deterministic local fallback — pulls 2-3 salient points.
  const bits: string[] = [];
  const dir =
    d.localAction === "BUY"
      ? "compra"
      : d.localAction === "SELL"
        ? "venda"
        : "aguardar";

  if (d.structure === "UP" && d.localAction === "BUY") {
    bits.push("estrutura em alta (HH/HL)");
  } else if (d.structure === "DOWN" && d.localAction === "SELL") {
    bits.push("estrutura em baixa (LH/LL)");
  } else if (d.structure === "RANGE") {
    bits.push("mercado lateralizado");
  }

  if (d.rsi !== null) {
    if (d.rsi < 30) bits.push(`RSI ${d.rsi.toFixed(0)} sobrevendido`);
    else if (d.rsi > 70) bits.push(`RSI ${d.rsi.toFixed(0)} sobrecomprado`);
  }

  if (d.adx !== null && d.adx > 25) {
    bits.push(`ADX ${d.adx.toFixed(0)} confirma força da tendência`);
  } else if (d.adx !== null && d.adx < 20) {
    bits.push(`ADX ${d.adx.toFixed(0)} fraco, sem direção clara`);
  }

  if (d.volRegime === "EXTREME" || d.volRegime === "HIGH") {
    bits.push(`volatilidade ${d.volRegime.toLowerCase()}`);
  }

  if (d.aiAction && d.aiAction !== d.localAction && d.aiAction !== "HOLD") {
    bits.push(`IA discorda e sugere ${d.aiAction}`);
  }

  const reason = bits.length > 0 ? bits.join(", ") : "indicadores neutros";
  return `Sinal local indica ${dir} baseado em ${reason}. Confluence ${d.confluenceScore.toFixed(0)} (${d.confluenceTone}), regime ${d.regime}. Análise automatizada, não é recomendação.`;
}

function extractHighlights(d: ExplainInput): string[] {
  const out: string[] = [];
  if (d.rsi !== null) {
    if (d.rsi < 30) out.push(`RSI sobrevendido (${d.rsi.toFixed(0)})`);
    else if (d.rsi > 70) out.push(`RSI sobrecomprado (${d.rsi.toFixed(0)})`);
  }
  if (d.adx !== null) {
    if (d.adx > 25) out.push(`ADX forte (${d.adx.toFixed(0)})`);
    else if (d.adx < 20) out.push(`ADX fraco (${d.adx.toFixed(0)})`);
  }
  if (d.macdHist !== null) {
    if (d.macdHist > 0) out.push("MACD positivo");
    else if (d.macdHist < 0) out.push("MACD negativo");
  }
  out.push(`Regime: ${d.regime}`);
  if (d.localReasons.length > 0) {
    out.push(d.localReasons[0]);
  }
  return out.slice(0, 5);
}
