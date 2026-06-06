// #19 — Help dialog listing all keyboard shortcuts.

import { useEffect, useState } from "react";
import { Keyboard, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type ShortcutEntry = {
  keys: string[]; // e.g. ["G", "D"] for the "g then d" sequence, or ["?"] for a single key
  label: string;
};

export const DEFAULT_SHORTCUTS: ShortcutEntry[] = [
  { keys: ["?"], label: "Abrir este diálogo" },
  { keys: ["Esc"], label: "Fechar modal / cancelar" },
  { keys: ["G", "D"], label: "Ir para Dashboard (/)" },
  { keys: ["G", "B"], label: "Ir para Backtest" },
  { keys: ["G", "S"], label: "Ir para Scanner" },
  { keys: ["G", "J"], label: "Ir para Journal" },
  { keys: ["R"], label: "Atualizar sinal IA" },
  { keys: ["Shift", "R"], label: "Executar trade sugerido" },
  { keys: ["T"], label: "Enviar sinal ao Telegram" },
  { keys: ["C"], label: "Toggle modo Consenso / IA única" },
];

export function KeyboardShortcutsButton({
  shortcuts = DEFAULT_SHORTCUTS,
}: {
  shortcuts?: ShortcutEntry[];
}) {
  const [open, setOpen] = useState(false);

  // Open with "?" key
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA")
      )
        return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        title="Atalhos de teclado (?)"
        onClick={() => setOpen(true)}
        className="size-7"
      >
        <Keyboard className="size-3.5" />
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 p-4 anim-fade-in-fast"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-surface p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Keyboard className="size-4 text-primary" /> Atalhos de teclado
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="space-y-1.5">
              {shortcuts.map((s, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded border border-border/40 bg-background/40 px-2 py-1.5 text-[11px]"
                >
                  <span className="text-muted-foreground">{s.label}</span>
                  <span className="flex items-center gap-1">
                    {s.keys.map((k, j) => (
                      <kbd
                        key={j}
                        className="rounded border border-border bg-accent px-1.5 py-0.5 font-mono text-[10px] text-foreground"
                      >
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 text-center text-[10px] text-muted-foreground">
              Pressione{" "}
              <kbd className="rounded border border-border bg-accent px-1 font-mono">
                ?
              </kbd>{" "}
              a qualquer momento para reabrir.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
