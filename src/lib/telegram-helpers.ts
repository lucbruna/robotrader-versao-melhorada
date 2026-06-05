import type { AlertEvent } from "./alerts";

export type SimpleSignal = {
  action: "BUY" | "SELL" | "HOLD" | "CLOSE";
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  rationale: string;
  risk: "LOW" | "MEDIUM" | "HIGH";
  regime: "TREND_UP" | "TREND_DOWN" | "RANGE" | "VOLATILE" | "BREAKOUT";
  rMultiple: number;
  invalidation: string;
  ttl: number;
};

const ACTION_EMOJI: Record<SimpleSignal["action"], string> = {
  BUY: "🟢",
  SELL: "🔴",
  HOLD: "⚪",
  CLOSE: "🟡",
};

const ACTION_LABEL: Record<SimpleSignal["action"], string> = {
  BUY: "COMPRAR",
  SELL: "VENDER",
  HOLD: "AGUARDAR",
  CLOSE: "FECHAR",
};

const RISK_EMOJI: Record<SimpleSignal["risk"], string> = {
  LOW: "🟢",
  MEDIUM: "🟡",
  HIGH: "🔴",
};

function regimeLabel(r: SimpleSignal["regime"]): string {
  switch (r) {
    case "TREND_UP":
      return "Tendência Alta";
    case "TREND_DOWN":
      return "Tendência Baixa";
    case "RANGE":
      return "Lateral";
    case "VOLATILE":
      return "Volátil";
    case "BREAKOUT":
      return "Rompimento";
    default:
      return String(r);
  }
}

function fmtPrice(n: number): string {
  if (!isFinite(n)) return "n/a";
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 2 : abs >= 1 ? 4 : 6;
  return n.toFixed(dp);
}

function fmtPct(n: number): string {
  if (!isFinite(n)) return "n/a";
  const sign = n >= 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

export function formatSignalMessage(
  signal: SimpleSignal,
  symbol: string,
  interval: string,
  extra?: { currentPrice?: number; change24h?: number },
): string {
  const emoji = ACTION_EMOJI[signal.action];
  const label = ACTION_LABEL[signal.action];
  const riskIcon = RISK_EMOJI[signal.risk];
  const lines: string[] = [];

  lines.push(`${emoji} *${label}* — \`${symbol}\` (${interval})`);
  lines.push("");
  lines.push(`💯 *Confiança:* ${signal.confidence}/100`);
  lines.push(`${riskIcon} *Risco:* ${signal.risk}`);
  lines.push(`📊 *Regime:* ${regimeLabel(signal.regime)}`);

  if (extra?.currentPrice !== undefined) {
    lines.push(`💰 *Preço atual:* ${fmtPrice(extra.currentPrice)}`);
  }
  if (extra?.change24h !== undefined) {
    lines.push(`📈 *24h:* ${fmtPct(extra.change24h)}`);
  }

  if (signal.action === "BUY" || signal.action === "SELL") {
    lines.push("");
    lines.push(`🎯 *Entrada:* ${fmtPrice(signal.entry)}`);
    lines.push(`🛑 *Stop:* ${fmtPrice(signal.stopLoss)}`);
    lines.push(`🚀 *Alvo:* ${fmtPrice(signal.takeProfit)}`);
    lines.push(`⚖️ *R:R:* 1:${signal.rMultiple.toFixed(2)}`);
    const ttlTxt =
      signal.ttl < 60
        ? `${signal.ttl}min`
        : signal.ttl < 1440
          ? `${(signal.ttl / 60).toFixed(1)}h`
          : `${(signal.ttl / 1440).toFixed(1)}d`;
    lines.push(`⏱️ *TTL:* ${ttlTxt}`);
  }

  if (signal.rationale) {
    lines.push("");
    lines.push(`💬 _${signal.rationale}_`);
  }
  if (signal.invalidation) {
    lines.push(`⚠️ _Invalidação:_ ${signal.invalidation}`);
  }

  lines.push("");
  lines.push(`_🤖 RoboTrader AI · ${new Date().toLocaleString("pt-BR")}_`);
  return lines.join("\n");
}

export function formatAlertMessage(event: AlertEvent): string {
  const priorityIcon =
    event.priority === "URGENT"
      ? "🚨"
      : event.priority === "HIGH"
        ? "🔔"
        : event.priority === "MEDIUM"
          ? "ℹ️"
          : "📌";
  const typeIcon =
    event.type === "PRICE"
      ? "💰"
      : event.type === "TECHNICAL"
        ? "📊"
        : event.type === "AI_SIGNAL"
          ? "🤖"
          : event.type === "VOLUME"
            ? "📦"
            : "⏰";
  return [
    `${priorityIcon} *Alerta ${event.priority}* — \`${event.symbol}\``,
    `${typeIcon} ${event.type}: ${event.message}`,
    ``,
    `_🕐 ${new Date(event.timestamp).toLocaleString("pt-BR")}_`,
  ].join("\n");
}

export function formatSimpleMessage(
  title: string,
  body: string,
  level: "info" | "warn" | "error" | "success" = "info",
): string {
  const icon =
    level === "success"
      ? "✅"
      : level === "warn"
        ? "⚠️"
        : level === "error"
          ? "❌"
          : "ℹ️";
  return [
    `${icon} *${title}*`,
    ``,
    body,
    ``,
    `_🤖 RoboTrader AI · ${new Date().toLocaleString("pt-BR")}_`,
  ].join("\n");
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      TELEGRAM_BOT_TOKEN?: string;
      TELEGRAM_CHAT_ID?: string;
    }
  }
}
