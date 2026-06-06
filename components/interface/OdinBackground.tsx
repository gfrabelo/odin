"use client";

import { Spotlight } from "@/components/ui/spotlight";
import { WebGLShader } from "@/components/ui/web-gl-shader";

/**
 * Background puramente visual do cockpit: shader WebGL + spotlight + scrims.
 * Nenhum elemento interativo aqui — tudo é pointer-events-none.
 * A cena 3D do Spline é renderizada separadamente em page.tsx para
 * garantir que os eventos de mouse (olhar do robô) funcionem corretamente.
 */
export function OdinBackground() {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden bg-background pointer-events-none">
      {/* Background animado em shader WebGL */}
      <WebGLShader />

      {/* Spotlight cinematográfico */}
      <Spotlight className="-top-40 left-10 md:-top-20 md:left-1/3" fill="#7dd3fc" />

      {/* Scrims: profundidade + legibilidade do texto sobre o 3D.
          - radial central: vinheta sutil
          - lateral esquerda: escurece onde fica o hero/conversa
          - inferior: ancora o input de comando */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 120% at 60% 40%, transparent 30%, rgba(10,14,39,0.55) 100%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, rgba(10,14,39,0.92) 0%, rgba(10,14,39,0.55) 32%, transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-1/2"
        style={{
          background:
            "linear-gradient(180deg, transparent 0%, rgba(10,14,39,0.6) 55%, rgba(10,14,39,0.95) 100%)",
        }}
      />
    </div>
  );
}
