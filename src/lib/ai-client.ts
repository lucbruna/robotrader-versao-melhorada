// Shared client-side helper for AI signal calls.
// In Electron: routes through IPC (env var stays in main process).
// In web: routes through the TanStack server function (env var on server).

import {
  explainSignal,
  getAISignal,
  type ExplainInput,
  type ExplainResult,
} from "@/lib/ai-signal.functions";

type AIPayload = Parameters<typeof getAISignal>[0]["data"];

export type TelegramStatus = {
  configured: boolean;
  botTokenSet: boolean;
  chatIdSet: boolean;
  lastSendAt: number | null;
  lastError: string | null;
  totalSent: number;
  totalFailed: number;
};

export type TelegramSendResult =
  | { ok: true; messageId: number; chatId: string }
  | { ok: false; error: string; retryable: boolean };

export type TelegramTestResult =
  | { ok: true; botName: string; botUsername: string; chatId: string }
  | { ok: false; error: string };

export type UpdaterStatus = {
  enabled: boolean;
  currentVersion: string;
  checking: boolean;
  downloading: boolean;
  progress: number;
  available: {
    version: string;
    releaseDate?: string;
    releaseNotes?: string | null;
  } | null;
  downloaded: { version: string; releaseDate?: string } | null;
  lastError: string | null;
  lastCheckAt: number;
};

export type UpdaterEvent =
  | "checking"
  | "available"
  | "progress"
  | "downloaded"
  | "not-available"
  | "error";

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
      platform: string;
      getAISignal: (data: unknown) => Promise<unknown>;
      telegram?: {
        status: () => Promise<TelegramStatus>;
        send: (
          text: string,
          parseMode?: "Markdown" | "MarkdownV2" | "HTML",
        ) => Promise<TelegramSendResult>;
        sendSignal: (
          signal: unknown,
          symbol: string,
          interval: string,
          extra?: { currentPrice?: number; change24h?: number },
        ) => Promise<TelegramSendResult>;
        sendAlert: (event: unknown) => Promise<TelegramSendResult>;
        test: () => Promise<TelegramTestResult>;
      };
      updater?: {
        status: () => Promise<UpdaterStatus | null>;
        check: () => Promise<{ ok: boolean; error?: string } | null>;
        install: () => Promise<{ ok: boolean; error?: string } | null>;
        onEvent: (
          callback: (channel: string, payload: unknown) => void,
        ) => () => void;
      };
    };
  }
}

export function isElectron(): boolean {
  return typeof window !== "undefined" && !!window.electronAPI?.isElectron;
}

export async function fetchAISignal(
  data: AIPayload,
): Promise<Awaited<ReturnType<typeof getAISignal>>> {
  if (isElectron()) {
    return (await window.electronAPI!.getAISignal(data)) as Awaited<
      ReturnType<typeof getAISignal>
    >;
  }
  return await getAISignal({ data });
}

// ---- LLM explainer (#14) ----

export async function fetchExplanation(
  data: ExplainInput,
): Promise<ExplainResult> {
  return await explainSignal({ data });
}

// ---- Telegram helpers (Electron-only — returns null in web) ----

export async function telegramStatus(): Promise<TelegramStatus | null> {
  if (!isElectron() || !window.electronAPI?.telegram) return null;
  return await window.electronAPI.telegram.status();
}

export async function telegramSend(
  text: string,
  parseMode: "Markdown" | "MarkdownV2" | "HTML" = "Markdown",
): Promise<TelegramSendResult | null> {
  if (!isElectron() || !window.electronAPI?.telegram) return null;
  return await window.electronAPI.telegram.send(text, parseMode);
}

export async function telegramSendSignal(
  signal: unknown,
  symbol: string,
  interval: string,
  extra?: { currentPrice?: number; change24h?: number },
): Promise<TelegramSendResult | null> {
  if (!isElectron() || !window.electronAPI?.telegram) return null;
  return await window.electronAPI.telegram.sendSignal(
    signal,
    symbol,
    interval,
    extra,
  );
}

export async function telegramSendAlert(
  event: unknown,
): Promise<TelegramSendResult | null> {
  if (!isElectron() || !window.electronAPI?.telegram) return null;
  return await window.electronAPI.telegram.sendAlert(event);
}

export async function telegramTest(): Promise<TelegramTestResult | null> {
  if (!isElectron() || !window.electronAPI?.telegram) return null;
  return await window.electronAPI.telegram.test();
}
