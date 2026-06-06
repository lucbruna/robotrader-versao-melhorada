// #19 — Global keyboard shortcuts.
//
// Bind once at the dashboard root. Active only when no input/textarea is
// focused and no modal is open (caller can pass `enabled=false` to suspend).
//
// The mapping is documented in a help dialog (KeyboardShortcutsModal) and
// also listed inline in src/components/ui/keyboard-shortcuts.tsx.

import { useEffect } from "react";

export type ShortcutHandler = (e: KeyboardEvent) => void;

export type ShortcutMap = Record<string, ShortcutHandler>;

/**
 * Build a stable key signature from a KeyboardEvent so handlers can be
 * looked up regardless of casing / modifier order.
 */
function keySignature(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("mod");
  if (e.shiftKey) parts.push("shift");
  if (e.altKey) parts.push("alt");
  // Use lowercase for letter keys; for non-letters keep as-is
  parts.push(e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return parts.join("+");
}

/**
 * Register global keyboard shortcuts. Returns nothing — pass a memoised
 * map to avoid re-binding on every render.
 */
export function useKeyboardShortcuts(map: ShortcutMap, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      // Don't fire while typing in inputs / textareas / contentEditable
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === "INPUT" ||
          tag === "TEXTAREA" ||
          tag === "SELECT" ||
          target.isContentEditable
        ) {
          return;
        }
      }
      const sig = keySignature(e);
      const handler = map[sig];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map, enabled]);
}
