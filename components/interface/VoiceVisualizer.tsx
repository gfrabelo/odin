"use client";

import { useEffect, useRef, type CSSProperties, type RefObject } from "react";

/**
 * Glow Pulse — overlay neon que pulsa no ritmo da voz do Odin.
 *
 * Caminho CONFIÁVEL da sincronização visual (independe dos objetos internos da
 * cena Spline). Lê `volumeRef.current` (0..1) num rAF próprio e escreve numa CSS
 * var `--p`; toda a animação é CSS via `calc()` — zero re-render do React.
 *
 * Pensado para ser posicionado DENTRO da camada do robô (absolute inset-0).
 */
export function VoiceVisualizer({
  volumeRef,
  active,
}: {
  volumeRef: RefObject<number>;
  active: boolean;
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

  return (
    <div
      ref={elRef}
      aria-hidden
      className="pointer-events-none absolute inset-0 z-[5] grid place-items-center"
      style={{ "--p": 0 } as CSSProperties}
    >
      {/* Halo difuso */}
      <div
        className="aspect-square w-[55%] max-w-[520px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--odin-accent) 38%, transparent) 0%, transparent 62%)",
          opacity: "calc(0.10 + var(--p) * 0.65)",
          transform: "scale(calc(0.9 + var(--p) * 0.35))",
          filter: "blur(22px)",
          transition: "opacity 60ms linear",
        }}
      />
      {/* Anel/visor fino */}
      <div
        className="absolute aspect-square w-[40%] max-w-[380px] rounded-full border"
        style={{
          borderColor: "color-mix(in srgb, var(--odin-accent) 55%, transparent)",
          boxShadow:
            "0 0 calc(6px + var(--p) * 55px) color-mix(in srgb, var(--odin-accent) 75%, transparent)",
          opacity: "calc(0.18 + var(--p) * 0.8)",
          transform: "scale(calc(0.95 + var(--p) * 0.14))",
          transition: "opacity 60ms linear",
        }}
      />
    </div>
  );
}
