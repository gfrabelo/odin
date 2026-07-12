"use client";

import { useEffect, useRef, useState } from "react";

type Phase = "idle" | "memory" | "tool" | "synthesis" | "speaking";

// Marcador real que lib/ai/chat.ts injeta ao acionar tools. Só conta como
// "executando" se for o último conteúdo não-whitespace do stream — assim que
// chega texto de verdade depois dele, a fase volta a "synthesis".
const TOOL_MARKER_TAIL = /_⚙️ Odin acionando: ([^_\n]+)…_\s*$/;

interface ThoughtBubbleProps {
  isLoading: boolean;
  /** Texto cru acumulado do stream (com marcadores de tool intactos). */
  streaming: string;
  /** tts.speaking — Odin falando a resposta. */
  speaking: boolean;
}

function derivePhase(
  isLoading: boolean,
  streaming: string,
  speaking: boolean
): { phase: Phase; tool?: string } {
  if (isLoading) {
    if (!streaming.trim()) return { phase: "memory" };
    const m = streaming.slice(-300).match(TOOL_MARKER_TAIL);
    if (m) return { phase: "tool", tool: m[1].trim() };
    return { phase: "synthesis" };
  }
  if (speaking) return { phase: "speaking" };
  return { phase: "idle" };
}

const LABELS: Record<Exclude<Phase, "idle" | "tool">, string> = {
  memory: "Consultando memória…",
  synthesis: "Sintetizando resposta…",
  speaking: "Comunicando…",
};

/**
 * Balão de "pensamento" acima da cabeça do robô: mostra a etapa REAL do
 * pipeline (RAG → tools → stream → TTS) com timer ao vivo. Puramente visual.
 */
export function ThoughtBubble({ isLoading, streaming, speaking }: ThoughtBubbleProps) {
  const { phase, tool } = derivePhase(isLoading, streaming, speaking);
  const active = phase !== "idle";

  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      startRef.current = null;
      setElapsed(0);
      return;
    }
    if (startRef.current == null) startRef.current = performance.now();
    const id = setInterval(() => {
      setElapsed(performance.now() - (startRef.current ?? performance.now()));
    }, 100);
    return () => clearInterval(id);
  }, [active]);

  if (!active) return null;

  const label = phase === "tool" ? `Executando: ${tool}…` : LABELS[phase];

  return (
    <div className="pointer-events-none absolute left-1/2 top-[10%] z-10 hidden -translate-x-1/2 flex-col items-center md:flex animate-in fade-in slide-in-from-top-2 duration-300">
      {/* Balão vidro-ciano */}
      <div className="glass flex items-center gap-2.5 rounded-2xl border-[var(--odin-accent)]/25 bg-[var(--odin-accent)]/5 px-4 py-2.5 shadow-[0_0_24px_var(--odin-accent-soft)]">
        {/* Pulso "ao vivo" */}
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[var(--odin-accent)] shadow-[0_0_8px_var(--odin-accent)]" />
        {/* key = remount por troca de etapa → fade + slide sem estado extra */}
        <span
          key={phase + (tool ?? "")}
          className="animate-in fade-in slide-in-from-bottom-1 duration-300 whitespace-nowrap font-mono text-xs tracking-wide text-neutral-100"
        >
          {label}
        </span>
        <span className="font-mono text-[10px] tabular-nums text-[var(--odin-accent)]/80">
          {(elapsed / 1000).toFixed(1)}s
        </span>
      </div>
      {/* Fio holográfico descendo até o robô */}
      <div className="h-16 w-px bg-gradient-to-b from-[var(--odin-accent)]/60 via-[var(--odin-accent)]/25 to-transparent" />
    </div>
  );
}
