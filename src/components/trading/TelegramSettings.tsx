import { useEffect, useState, useCallback } from "react";
import {
  Send,
  TestTube2,
  Trash2,
  MessageCircle,
  AlertCircle,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  isElectron,
  telegramStatus,
  telegramTest,
  telegramSend,
} from "@/lib/ai-client";
import type { TelegramStatus as Status } from "@/lib/ai-client";
import { formatSimpleMessage } from "@/lib/telegram-helpers";

type LogEntry = {
  id: number;
  ts: number;
  level: "info" | "success" | "warn" | "error";
  message: string;
};

let logIdCounter = 0;

export function TelegramSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<"test" | "send" | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);

  const pushLog = useCallback((level: LogEntry["level"], message: string) => {
    setLogs((prev) => [
      { id: ++logIdCounter, ts: Date.now(), level, message },
      ...prev.slice(0, 9),
    ]);
  }, []);

  const refresh = useCallback(async () => {
    const s = await telegramStatus();
    setStatus(s);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onTest = async () => {
    setBusy("test");
    pushLog("info", "Testando conexão com Telegram...");
    const r = await telegramTest();
    if (r && r.ok) {
      pushLog("success", `Conectado a @${r.botUsername} (chat ${r.chatId})`);
    } else {
      pushLog("error", `Falha: ${r?.error ?? "electronAPI indisponível"}`);
    }
    await refresh();
    setBusy(null);
  };

  const onSendTest = async () => {
    setBusy("send");
    const msg = formatSimpleMessage(
      "Teste manual",
      "Esta é uma mensagem de teste enviada pelo RoboTrader AI.\n\nSe você recebeu isto, a integração está funcionando!",
      "info",
    );
    pushLog("info", "Enviando mensagem de teste...");
    const r = await telegramSend(msg);
    if (r && r.ok) {
      pushLog("success", `Mensagem enviada (id ${r.messageId})`);
    } else {
      pushLog("error", `Falha: ${r?.error ?? "electronAPI indisponível"}`);
    }
    await refresh();
    setBusy(null);
  };

  if (!isElectron()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MessageCircle className="h-4 w-4" />
            Telegram
          </CardTitle>
          <CardDescription>
            Disponível apenas na versão desktop (Electron).
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const ok = !!status?.configured;
  const tokMissing = status && !status.botTokenSet;
  const chatMissing = status && !status.chatIdSet;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MessageCircle className="h-4 w-4" />
          Telegram
        </CardTitle>
        <CardDescription>
          Alertas do bot enviados direto pro seu Telegram pessoal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div className="flex items-center gap-2 text-sm">
            {ok ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
            <span className="font-medium">
              {ok ? "Conectado" : "Não configurado"}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {status && (
              <>
                <span>📤 {status.totalSent}</span>
                <span>❌ {status.totalFailed}</span>
              </>
            )}
          </div>
        </div>

        {!ok && (
          <div className="flex items-start gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/5 p-3 text-xs">
            <AlertCircle className="h-4 w-4 shrink-0 text-yellow-500" />
            <div className="space-y-1">
              {tokMissing && (
                <div>
                  • <code>TELEGRAM_BOT_TOKEN</code> ausente no env
                </div>
              )}
              {chatMissing && (
                <div>
                  • <code>TELEGRAM_CHAT_ID</code> ausente no env
                </div>
              )}
              <div className="text-muted-foreground">
                Crie o bot com <code>@BotFather</code> no Telegram, defina as
                env vars e reabra o app.
              </div>
            </div>
          </div>
        )}

        {status?.lastError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-400">
            Último erro: {status.lastError}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={onTest}
            disabled={busy !== null || !ok}
          >
            <TestTube2 className="h-3.5 w-3.5" />
            {busy === "test" ? "Testando..." : "Testar"}
          </Button>
          <Button
            size="sm"
            onClick={onSendTest}
            disabled={busy !== null || !ok}
          >
            <Send className="h-3.5 w-3.5" />
            {busy === "send" ? "Enviando..." : "Enviar teste"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={refresh}
            disabled={busy !== null}
          >
            Atualizar
          </Button>
        </div>

        {logs.length > 0 && (
          <div className="space-y-1 rounded-md border bg-muted/30 p-2 text-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="font-medium">Histórico recente</span>
              <button
                className="hover:text-foreground"
                onClick={() => setLogs([])}
                type="button"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
            <div className="max-h-32 space-y-1 overflow-y-auto">
              {logs.map((l) => (
                <div key={l.id} className="flex items-start gap-2">
                  <span className="text-muted-foreground">
                    {new Date(l.ts).toLocaleTimeString()}
                  </span>
                  <span
                    className={
                      l.level === "success"
                        ? "text-emerald-500"
                        : l.level === "error"
                          ? "text-red-500"
                          : l.level === "warn"
                            ? "text-yellow-500"
                            : "text-foreground"
                    }
                  >
                    {l.message}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">
            Como configurar?
          </summary>
          <ol className="ml-4 mt-2 list-decimal space-y-1">
            <li>
              Telegram → procure <code>@BotFather</code> → <code>/newbot</code>
            </li>
            <li>
              Copie o token → <code>TELEGRAM_BOT_TOKEN</code>
            </li>
            <li>
              Procure <code>@userinfobot</code> → copie seu ID →{" "}
              <code>TELEGRAM_CHAT_ID</code>
            </li>
            <li>
              Abra conversa com seu bot e clique <strong>Start</strong>
            </li>
            <li>Defina as env vars e reabra o app</li>
          </ol>
        </details>
      </CardContent>
    </Card>
  );
}
