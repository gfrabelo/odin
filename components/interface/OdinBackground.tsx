"use client";

import { Spotlight } from "@/components/ui/spotlight";
import KineticGrid from "@/components/ui/kinetic-grid";

/**
 * Background puramente visual do cockpit: KineticGrid shader + spotlight.
 * Posicionado na camada base z-0 (atrás do robô 3D z-10 e dos cards z-20).
 */
export function OdinBackground() {
  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none">
      {/* Background animado interativo em Canvas / Kinetic Grid */}
      <KineticGrid globalColor="default" className="fixed inset-0 w-full h-full" />

      {/* Spotlight cinematográfico */}
      <Spotlight className="-top-40 left-10 md:-top-20 md:left-1/3" fill="#7dd3fc" />

      {/* Vinheta sutil nas bordas */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 50%, rgba(10,14,39,0.5) 100%)",
        }}
      />
    </div>
  );
}
