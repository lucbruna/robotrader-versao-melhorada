import { z } from "zod";

const OllamaResponseSchema = z.object({
  model: z.string(),
  created_at: z.string(),
  response: z.string(),
  done: z.boolean(),
  context: z.array(z.number()).optional(),
});

const TradingPromptSchema = z.object({
  symbol: z.string(),
  timeframe: z.string(),
  current_price: z.number(),
  rsi: z.number().optional(),
  macd: z.number().optional(),
  macd_signal: z.number().optional(),
  ema20: z.number().optional(),
  ema50: z.number().optional(),
  ema200: z.number().optional(),
  bb_upper: z.number().optional(),
  bb_middle: z.number().optional(),
  bb_lower: z.number().optional(),
  volume: z.number().optional(),
  volume_ma: z.number().optional(),
});

export type TradingPrompt = z.infer<typeof TradingPromptSchema>;

export interface OllamaSignal {
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;
  rationale: string;
  target_price?: number;
  stop_loss?: number;
  timeframe: string;
  indicators: string[];
}

class OllamaClient {
  private baseUrl: string;
  private defaultModel: string = "llama3.1:8b";
  private contextWindow: number = 4096;

  constructor(baseUrl: string = "http://localhost:11434") {
    this.baseUrl = baseUrl;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async sendPrompt(prompt: string, model?: string): Promise<string> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: model || this.defaultModel,
        prompt,
        stream: false,
        context: [],
      }),
    });

    if (!response.ok) {
      throw new Error(
        `Ollama API Error: ${response.status} ${response.statusText}`,
      );
    }

    const data = await response.json();
    return OllamaResponseSchema.parse(data).response;
  }

  async generateTradingSignal(
    prompt: TradingPrompt,
    model?: string,
  ): Promise<OllamaSignal> {
    const systemPrompt = `
Você é um assistente de trading especializado em análise técnica. 
Baseado nos dados fornecidos, forneça uma recomendação de trading (BUY, SELL, ou HOLD) 
com nível de confiança (0-100%), justificativa detalhada, e preço alvo/seu stop loss.

Siga este formato JSON:
{
  "action": "BUY|SELL|HOLD",
  "confidence": 0-100,
  "rationale": "justificativa detalhada",
  "target_price": preço_alvo (opcional),
  "stop_loss": stop_loss (opcional),
  "timeframe": "recomendação de timeframe",
  "indicators": ["indicadores_chave_usados"]
}

Dados atuais:
`;

    const tradingData = Object.entries(prompt)
      .filter(([key]) => key !== "symbol")
      .map(([key, value]) => {
        if (value === undefined) return "";
        const formattedKey = key.replace(/_/g, " ").toUpperCase();
        return `${formattedKey}: ${typeof value === "number" ? value.toFixed(4) : value}`;
      })
      .filter((line) => line)
      .join("\n");

    const fullPrompt = `${systemPrompt}${tradingData}`;

    try {
      const response = await this.sendPrompt(fullPrompt, model);

      // Try to parse JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Validate and return structured signal
        const validated = {
          action: parsed.action || "HOLD",
          confidence: Math.min(100, Math.max(0, parsed.confidence || 50)),
          rationale: parsed.rationale || "Análise inconclusiva",
          target_price: parsed.target_price,
          stop_loss: parsed.stop_loss,
          timeframe: prompt.timeframe || "4h",
          indicators: parsed.indicators || [],
        };

        return validated;
      }

      // Fallback to simple parsing
      return {
        action: this.extractAction(response),
        confidence: this.extractConfidence(response),
        rationale: this.extractRationale(response),
        target_price: this.extractNumber(response, "target"),
        stop_loss: this.extractNumber(response, "stop"),
        timeframe: prompt.timeframe || "4h",
        indicators: this.extractIndicators(response),
      };
    } catch (error) {
      console.error("Ollama signal generation error:", error);
      return {
        action: "HOLD",
        confidence: 0,
        rationale: "Erro na análise do modelo",
        timeframe: prompt.timeframe || "4h",
        indicators: [],
      };
    }
  }

  private extractAction(response: string): "BUY" | "SELL" | "HOLD" {
    const lower = response.toLowerCase();
    if (lower.includes("buy") || lower.includes("comprar")) return "BUY";
    if (lower.includes("sell") || lower.includes("vender")) return "SELL";
    return "HOLD";
  }

  private extractConfidence(response: string): number {
    const confidenceMatch = response.match(/confidenc[ya]:?\s*(\d+)/i);
    if (confidenceMatch) {
      return Math.min(100, Math.max(0, parseInt(confidenceMatch[1])));
    }

    const strongWords =
      response
        .toLowerCase()
        .match(/\b(strong|alta|alta|high|bullish|positive)\b/gi) ?? [];
    const weakWords =
      response
        .toLowerCase()
        .match(/\b(weak|baixa|baixa|low|bearish|negative)\b/gi) ?? [];

    if (strongWords && strongWords.length > weakWords.length) return 75;
    if (weakWords && weakWords.length > strongWords.length) return 25;
    return 50;
  }

  private extractRationale(response: string): string {
    const rationaleMatch = response.match(
      /rationale|justificativa|análise:[\s\S]*?(?=\n\n|\n\w+|})/,
    );
    if (rationaleMatch) {
      return rationaleMatch[0]
        .replace(/rationale|justificativa|análise:\s*/i, "")
        .trim();
    }

    // Extract key points from response
    const sentences = response
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 10);
    return sentences.slice(0, 3).join(". ") + "." || "Análise inconclusiva";
  }

  private extractNumber(response: string, keyword: string): number | undefined {
    const pattern = new RegExp(`${keyword}[\\s:]*\\s*(\\d+(?:\\.\\d+)?)`, "i");
    const match = response.match(pattern);
    return match ? parseFloat(match[1]) : undefined;
  }

  private extractIndicators(response: string): string[] {
    const indicatorKeywords = [
      "rsi",
      "macd",
      "ema",
      "bollinger",
      "bb",
      "volume",
      "moving average",
    ];
    const foundIndicators: string[] = [];

    indicatorKeywords.forEach((indicator) => {
      if (response.toLowerCase().includes(indicator)) {
        foundIndicators.push(indicator.toUpperCase());
      }
    });

    return foundIndicators.length > 0 ? foundIndicators : ["TECHNICAL"];
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      const data = await response.json();
      return data.models.map((model: { name: string }) => model.name);
    } catch {
      return [];
    }
  }

  async testConnection(): Promise<{
    connected: boolean;
    models: string[];
    latency: number;
  }> {
    const start = Date.now();

    try {
      const models = await this.listModels();
      const latency = Date.now() - start;

      return {
        connected: models.length > 0,
        models,
        latency,
      };
    } catch {
      return {
        connected: false,
        models: [],
        latency: Date.now() - start,
      };
    }
  }
}

export default OllamaClient;
