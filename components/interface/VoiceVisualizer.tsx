"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

/**
 * Glow Pulse - overlay neon que pulsa no ritmo da voz do Odin.
 *
 * Caminho CONFIÁVEL da sincronização visual (independe dos objetos internos da
 * cena Spline). Lê `volumeRef.current` (0..1) num rAF próprio e escreve numa CSS
 * var `--p`; toda a animação é CSS via `calc()` - zero re-render do React.
 *
 * Duas camadas, ambas posicionadas DENTRO da camada do robô (absolute inset-0):
 *  - `back`:  anel nítido na altura da CABEÇA, renderizado ANTES do canvas Spline
 *             no DOM e SEM z positivo → o robô opaco o oclui (efeito de profundidade,
 *             o círculo "passa atrás da cabeça"). `topOffset` ajusta a altura.
 *  - `front`: halo difuso sutil por cima (brilho que "vaza" na frente). Default.
 */
export function VoiceVisualizer({
  volumeRef,
  active,
  layer = "front",
  topOffset = "25%",
}: {
  volumeRef: RefObject<number>;
  active: boolean;
  layer?: "front" | "back";
  /** Altura do centro do anel `back` (top), pra alinhar com a cabeça do robô. */
  topOffset?: string;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      elRef.current?.style.setProperty("--p", "0");
      return;
    }
    const loop = () => {
      const el = elRef.current;
      if (el) el.style.setProperty("--p", (volumeRef.current ?? 0).toFixed(3));
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, [active, volumeRef]);

  // ─── Camada de trás: anel nítido atrás da cabeça ────────────────────────
  if (layer === "back") {
    return (
      <div
        ref={elRef}
        aria-hidden
        // Sem z positivo: fica abaixo do canvas Spline (que vem depois no DOM).
        className="pointer-events-none absolute inset-x-0 flex justify-center"
        style={{ top: topOffset, "--p": 0 } as CSSProperties}
      >
        <div className="relative -translate-y-1/2">
          {/* Disco de brilho - invisível em silêncio (opacidade ∝ volume). */}
          <div
            className="aspect-square w-[34vh] max-w-[420px] rounded-full"
            style={{
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--odin-accent) 55%, transparent) 0%, color-mix(in srgb, var(--odin-accent) 18%, transparent) 45%, transparent 70%)",
              opacity: "calc(var(--p) * 0.85)",
              transform: "scale(calc(0.92 + var(--p) * 0.32))",
              filter: "blur(8px)",
              transition: "opacity 90ms linear",
            }}
          />
          {/* Anel definido - invisível em silêncio (opacidade ∝ volume). */}
          <div
            className="absolute inset-0 m-auto aspect-square w-[34vh] max-w-[420px] rounded-full border-2"
            style={{
              borderColor: "color-mix(in srgb, var(--odin-accent) 70%, transparent)",
              boxShadow:
                "0 0 calc(10px + var(--p) * 70px) color-mix(in srgb, var(--odin-accent) 85%, transparent)",
              opacity: "calc(var(--p) * 0.95)",
              transform: "scale(calc(0.95 + var(--p) * 0.18))",
              transition: "opacity 90ms linear",
            }}
          />
        </div>
      </div>
    );
  }

  // ─── Camada da frente: halo difuso sutil ────────────────────────────────
  return (
    <div
      ref={elRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[5] grid place-items-center"
      style={{ "--p": 0 } as CSSProperties}
    >
      <div
        className="aspect-square w-[55%] max-w-[520px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--odin-accent) 28%, transparent) 0%, transparent 62%)",
          opacity: "calc(var(--p) * 0.45)",
          transform: "scale(calc(0.9 + var(--p) * 0.35))",
          filter: "blur(26px)",
          transition: "opacity 90ms linear",
        }}
      />
    </div>
  );
}
