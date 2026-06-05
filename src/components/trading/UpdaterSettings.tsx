import { useEffect, useState, useCallback } from "react";
import {
  RefreshCw,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Github,
  Package,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { isElectron } from "@/lib/ai-client";

type UpdaterStatus = {
  enabled: boolean;
  currentVersion: string;
  checking: boolean;
  downloading: boolean;
  progress: number; // 0..1
  available: {
    version: string;
    releaseDate?: string;
    releaseNotes?: string | null;
  } | null;
  downloaded: { version: string; releaseDate?: string } | null;
  lastError: string | null;
  lastCheckAt: number;
};

const initial: UpdaterStatus = {
  enabled: false,
  currentVersion: "—",
  checking: false,
  downloading: false,
  progress: 0,
  available: null,
  downloaded: null,
  lastError: null,
  lastCheckAt: 0,
};

type Channel =
  | "checking"
  | "available"
  | "progress"
  | "downloaded"
  | "not-available"
  | "error";

export function UpdaterSettings() {
  const [status, setStatus] = useState<UpdaterStatus>(initial);
  const [busy, setBusy] = useState(false);
  const [unsub, setUnsub] = useState<(() => void) | null>(null);

  const refresh = useCallback(async () => {
    if (!isElectron() || !window.electronAPI?.updater) {
      setStatus((s) => ({ ...s, enabled: false }));
      return;
    }
    const s = await window.electronAPI.updater.status();
    if (s) setStatus((cur) => ({ ...cur, ...s }));
  }, []);

  useEffect(() => {
    void refresh();
    if (isElectron() && window.electronAPI?.updater?.onEvent) {
      const off = window.electronAPI.updater.onEvent(
        (channel: string, payload: unknown) => {
          const ch = channel as Channel;
          setStatus((cur) => {
            if (ch === "checking") {
              return { ...cur, checking: true, lastError: null };
            }
            if (ch === "available") {
              return {
                ...cur,
                checking: false,
                downloading: true,
                available: payload as { version: string; releaseDate?: string },
              };
            }
            if (ch === "progress") {
              const p = (payload as { percent?: number })?.percent ?? 0;
              return { ...cur, progress: p / 100, downloading: true };
            }
            if (ch === "downloaded") {
              return {
                ...cur,
                downloading: false,
                progress: 1,
                downloaded: payload as {
                  version: string;
                  releaseDate?: string;
                },
              };
            }
            if (ch === "not-available") {
              return { ...cur, checking: false, lastCheckAt: Date.now() };
            }
            if (ch === "error") {
              return {
                ...cur,
                checking: false,
                downloading: false,
                lastError:
                  (payload as { error?: string })?.error ?? "Erro desconhecido",
              };
            }
            return cur;
          });
        },
      );
      setUnsub(() => off);
    }
    return () => {
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onCheck = async () => {
    if (!isElectron() || !window.electronAPI?.updater) return;
    setBusy(true);
    setStatus((s) => ({ ...s, checking: true, lastError: null }));
    const r = await window.electronAPI.updater.check();
    if (r && !r.ok) {
      setStatus((s) => ({
        ...s,
        checking: false,
        lastError: r.error ?? "erro",
      }));
    }
    setBusy(false);
  };

  const onInstall = async () => {
    if (!isElectron() || !window.electronAPI?.updater) return;
    await window.electronAPI.updater.install();
  };

  if (!isElectron()) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <RefreshCw className="h-4 w-4" />
            Atualizações
          </CardTitle>
          <CardDescription>
            Disponível apenas na versão desktop (Electron).
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const hasUpdate = !!status.downloaded;
  const downloading = status.downloading;
  const checking = status.checking || busy;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <RefreshCw className="h-4 w-4" />
          Atualizações
        </CardTitle>
        <CardDescription>
          Auto-update via GitHub Releases — silencioso, sem reinstalar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between rounded-md border p-3 text-sm">
          <div className="flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="font-medium">v{status.currentVersion}</div>
              <div className="text-[10px] text-muted-foreground">
                {status.lastCheckAt
                  ? `Última verificação: ${new Date(status.lastCheckAt).toLocaleTimeString()}`
                  : "Nunca verificado"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {hasUpdate ? (
              <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-500">
                <CheckCircle2 className="h-3 w-3" />v
                {status.downloaded!.version} pronto
              </span>
            ) : status.available ? (
              <span className="flex items-center gap-1 rounded bg-blue-500/15 px-2 py-0.5 text-[10px] text-blue-500">
                <Download className="h-3 w-3" />v{status.available.version}{" "}
                baixando…
              </span>
            ) : (
              <span className="rounded bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                Em dia
              </span>
            )}
          </div>
        </div>

        {downloading && status.available && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Baixando v{status.available.version}…</span>
              <span>{Math.round(status.progress * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${Math.round(status.progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        {status.lastError && (
          <div className="flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{status.lastError}</span>
          </div>
        )}

        <div className="flex gap-2">
          {hasUpdate ? (
            <Button size="sm" onClick={onInstall} className="flex-1">
              <RefreshCw className="h-3.5 w-3.5" />
              Reiniciar e atualizar
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={onCheck}
              disabled={checking || downloading}
              className="flex-1"
            >
              {checking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {checking ? "Verificando..." : "Verificar atualizações"}
            </Button>
          )}
        </div>

        <details className="text-[10px] text-muted-foreground">
          <summary className="cursor-pointer hover:text-foreground">
            Como funciona?
          </summary>
          <div className="ml-4 mt-1 space-y-1">
            <div>1. O app checa GitHub Releases 5s após iniciar</div>
            <div>2. Se houver versão nova, baixa em background</div>
            <div>3. Quando termina, você clica "Reiniciar e atualizar"</div>
            <div className="flex items-center gap-1">
              <Github className="h-3 w-3" />
              Configure o repo em <code>electron-builder.yml</code>
            </div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
