export type TelegramSendResult =
  | { ok: true; messageId: number; chatId: string }
  | { ok: false; error: string; retryable: boolean };

export type TelegramTestResult =
  | { ok: true; botName: string; botUsername: string; chatId: string }
  | { ok: false; error: string };

export type TelegramStatus = {
  configured: boolean;
  botTokenSet: boolean;
  chatIdSet: boolean;
  lastSendAt: number | null;
  lastError: string | null;
  totalSent: number;
  totalFailed: number;
};

const TELEGRAM_API = "https://api.telegram.org/bot";
const MAX_MSG_LEN = 4096;
const MIN_INTERVAL_MS = 1100;

class TokenBucket {
  private last = 0;
  private queue: Promise<void> = Promise.resolve();
  constructor(private minIntervalMs: number = MIN_INTERVAL_MS) {}

  async take(): Promise<void> {
    this.queue = this.queue.then(async () => {
      const now = Date.now();
      const wait = Math.max(0, this.minIntervalMs - (now - this.last));
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.last = Date.now();
    });
    return this.queue;
  }
}

export class TelegramBot {
  readonly token: string;
  readonly chatId: string;
  private bucket = new TokenBucket();
  private stats = {
    totalSent: 0,
    totalFailed: 0,
    lastSendAt: 0 as number | null,
    lastError: null as string | null,
  };

  constructor(token: string, chatId: string) {
    this.token = token;
    this.chatId = chatId;
  }

  getStats() {
    return { ...this.stats };
  }

  private truncate(text: string): string {
    if (text.length <= MAX_MSG_LEN) return text;
    return text.slice(0, MAX_MSG_LEN - 20) + "\n\n…(truncado)";
  }

  async sendMessage(
    text: string,
    opts: {
      parseMode?: "Markdown" | "MarkdownV2" | "HTML";
      disableWebPreview?: boolean;
    } = {},
  ): Promise<TelegramSendResult> {
    if (!this.token || !this.chatId) {
      return {
        ok: false,
        error: "Telegram não configurado (token/chat_id ausentes).",
        retryable: false,
      };
    }
    const body = this.truncate(text);
    await this.bucket.take();
    try {
      const url = `${TELEGRAM_API}${this.token}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: body,
          parse_mode: opts.parseMode ?? "Markdown",
          disable_web_page_preview: opts.disableWebPreview ?? true,
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        description?: string;
        error_code?: number;
        result?: { message_id?: number; chat?: { id?: number } };
      };
      if (!res.ok || !j.ok) {
        const err = j.description ?? `HTTP ${res.status}`;
        this.stats.totalFailed++;
        this.stats.lastError = err;
        const retryable =
          res.status === 429 || (res.status >= 500 && res.status < 600);
        return { ok: false, error: err, retryable };
      }
      this.stats.totalSent++;
      this.stats.lastSendAt = Date.now();
      this.stats.lastError = null;
      return {
        ok: true,
        messageId: j.result?.message_id ?? 0,
        chatId: String(j.result?.chat?.id ?? this.chatId),
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.stats.totalFailed++;
      this.stats.lastError = msg;
      return { ok: false, error: msg, retryable: true };
    }
  }

  async testConnection(): Promise<TelegramTestResult> {
    if (!this.token) {
      return { ok: false, error: "TELEGRAM_BOT_TOKEN ausente." };
    }
    if (!this.chatId) {
      return { ok: false, error: "TELEGRAM_CHAT_ID ausente." };
    }
    try {
      const meRes = await fetch(`${TELEGRAM_API}${this.token}/getMe`);
      const meJ = (await meRes.json()) as {
        ok?: boolean;
        result?: { first_name?: string; username?: string };
        description?: string;
      };
      if (!meRes.ok || !meJ.ok) {
        return {
          ok: false,
          error: meJ.description ?? `getMe falhou (HTTP ${meRes.status})`,
        };
      }
      const send = await this.sendMessage(
        `✅ *RoboTrader AI conectado*\nBot: ${meJ.result?.first_name ?? "?"} (@${meJ.result?.username ?? "?"})\nChat ID: \`${this.chatId}\`\nTimestamp: ${new Date().toISOString()}`,
      );
      if (!send.ok) return { ok: false, error: send.error };
      return {
        ok: true,
        botName: meJ.result?.first_name ?? "Bot",
        botUsername: meJ.result?.username ?? "",
        chatId: this.chatId,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

let cachedBot: TelegramBot | null = null;
let cachedKey = "";

export function getTelegramBot(
  token?: string,
  chatId?: string,
): TelegramBot | null {
  const t =
    token ??
    (typeof process !== "undefined"
      ? process.env.TELEGRAM_BOT_TOKEN
      : undefined);
  const c =
    chatId ??
    (typeof process !== "undefined" ? process.env.TELEGRAM_CHAT_ID : undefined);
  if (!t || !c) return null;
  const key = `${t}::${c}`;
  if (cachedBot && cachedKey === key) return cachedBot;
  cachedBot = new TelegramBot(t, c);
  cachedKey = key;
  return cachedBot;
}

export function getTelegramStatus(): TelegramStatus {
  const bot = getTelegramBot();
  if (!bot) {
    return {
      configured: false,
      botTokenSet: !!(
        typeof process !== "undefined" && process.env.TELEGRAM_BOT_TOKEN
      ),
      chatIdSet: !!(
        typeof process !== "undefined" && process.env.TELEGRAM_CHAT_ID
      ),
      lastSendAt: null,
      lastError: null,
      totalSent: 0,
      totalFailed: 0,
    };
  }
  const s = bot.getStats();
  return {
    configured: true,
    botTokenSet: true,
    chatIdSet: true,
    lastSendAt: s.lastSendAt,
    lastError: s.lastError,
    totalSent: s.totalSent,
    totalFailed: s.totalFailed,
  };
}
