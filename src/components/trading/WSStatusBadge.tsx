import { useWSStatus, type WSStatus } from "@/lib/binance-ws";

function classify(s: WSStatus): {
  label: string;
  classes: string;
  dot: string;
} {
  if (s.connected && s.lastMessageAt > 0) {
    const age = Date.now() - s.lastMessageAt;
    if (age > 60000) {
      return {
        label: "WS estagnado",
        classes: "bg-[color:var(--warning)]/10 text-[color:var(--warning)]",
        dot: "bg-[color:var(--warning)]",
      };
    }
    return {
      label: `WS · ${s.activeStreams} stream${s.activeStreams === 1 ? "" : "s"}`,
      classes: "bg-bull/10 text-bull",
      dot: "bg-bull",
    };
  }
  if (s.reconnecting) {
    return {
      label: `Reconectando… (${s.attempt})`,
      classes: "bg-[color:var(--warning)]/10 text-[color:var(--warning)]",
      dot: "bg-[color:var(--warning)]",
    };
  }
  return {
    label: "WS offline",
    classes: "bg-bear/10 text-bear",
    dot: "bg-bear",
  };
}

export function WSStatusBadge() {
  const s = useWSStatus();
  const { label, classes, dot } = classify(s);
  return (
    <div
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-wider ${classes}`}
      title={
        s.lastError
          ? `Erro: ${s.lastError}`
          : `Tentativas: ${s.attempt} · Streams: ${s.activeStreams}`
      }
    >
      <span className={`pulse-dot size-1.5 rounded-full ${dot}`} />
      {label}
    </div>
  );
}
