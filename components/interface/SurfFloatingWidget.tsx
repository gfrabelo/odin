"use client";

import { useState, useRef, useEffect } from "react";
import { Waves, X, ChevronDown, RefreshCw } from "lucide-react";
import { SurfWidget } from "@/components/interface/SurfWidget";
import { cn } from "@/lib/utils";

interface SurfData {
  success: boolean;
  spot: string;
  quality: string;
  wave: {
    height: number;
    period: number;
    direction_deg: number;
    direction_compass: string;
    swell_height: number;
    swell_period: number;
    swell_direction_deg: number;
    swell_direction_compass: string;
  };
  wind: {
    speed: number;
    gusts: number;
    direction_deg: number;
    direction_compass: string;
    type: "Terral" | "Maral" | "Lateral" | "Mexido";
  };
  weather: {
    temp: number;
  };
  next_hours: {
    mar: Array<{
      time: string;
      wave_height: number;
      wave_period: number;
      swell_wave_height: number;
      swell_wave_period: number;
    }>;
  };
  updated_at: string;
}

interface SurfFloatingWidgetProps {
  data: SurfData | null;
  loading: boolean;
  error: string | null;
  onRefresh?: () => void;
}

export function SurfFloatingWidget({ data, loading, error, onRefresh }: SurfFloatingWidgetProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Fechar ao clicar fora
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const waveHeight = data?.wave?.height ? `${data.wave.height.toFixed(1)}m` : "--";
  const windType = data?.wind?.type ?? "Surf";
  const temp = data?.weather?.temp ? `${data.weather.temp.toFixed(0)}°C` : "";

  return (
    <div ref={containerRef} className="relative z-50 font-mono">
      {/* Floating Badge Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          "glass flex items-center gap-2.5 px-3.5 py-2 rounded-full cursor-pointer transition-all duration-300 select-none shadow-lg",
          "hover:border-[var(--odin-accent)]/40 hover:bg-white/[0.08] active:scale-95",
          isOpen
            ? "border-[var(--odin-accent)]/50 bg-[var(--odin-accent)]/15 shadow-[0_0_20px_rgba(74,158,255,0.2)]"
            : "border-white/10 bg-[#0a0e27]/70 text-neutral-300"
        )}
      >
        <div className="relative flex items-center justify-center">
          <Waves className="size-4 text-[var(--odin-accent)] animate-pulse" />
          <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-[var(--odin-accent)]" />
        </div>
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <span className="text-neutral-100">{waveHeight}</span>
          <span className="text-neutral-500">•</span>
          <span className="text-[var(--odin-accent)] uppercase text-[10px] tracking-wider">{windType}</span>
          {temp && (
            <>
              <span className="text-neutral-500">•</span>
              <span className="text-neutral-300 text-[11px]">{temp}</span>
            </>
          )}
        </div>
        <ChevronDown className={cn("size-3.5 text-neutral-400 transition-transform duration-300", isOpen && "rotate-180")} />
      </button>

      {/* Popover Expansível para Cima (Bottom-Up) */}
      <div
        className={cn(
          "glass absolute right-0 bottom-14 w-[330px] rounded-3xl p-5 shadow-[0_10px_40px_rgba(0,0,0,0.8)] backdrop-blur-2xl bg-[#0a0e27]/90 border border-white/10 transition-all duration-300 ease-out origin-bottom-right",
          isOpen
            ? "opacity-100 scale-100 pointer-events-auto translate-y-0"
            : "opacity-0 scale-95 pointer-events-none translate-y-2"
        )}
      >
        {/* Header do Popover */}
        <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
          <div className="flex items-center gap-2 text-[var(--odin-accent)]">
            <Waves className="size-4 animate-pulse" />
            <h3 className="text-xs font-semibold uppercase tracking-[0.2em]">Surf Report</h3>
          </div>
          <div className="flex items-center gap-1.5">
            {onRefresh && (
              <button
                type="button"
                onClick={onRefresh}
                title="Atualizar Surf Report"
                className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
              >
                <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-1 rounded-md text-neutral-400 hover:text-white hover:bg-white/10 transition-all cursor-pointer"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Conteúdo do SurfWidget */}
        <div className="max-h-[60vh] overflow-y-auto pr-1 no-scrollbar">
          <SurfWidget data={data} loading={loading} error={error} />
        </div>
      </div>
    </div>
  );
}
