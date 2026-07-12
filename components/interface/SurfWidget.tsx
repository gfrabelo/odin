"use client";

import { Waves } from "lucide-react";
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

interface SurfWidgetProps {
  data: SurfData | null;
  loading: boolean;
  error: string | null;
}

function MiniCompass({ deg, label, colorClass = "text-[var(--odin-accent)]" }: { deg: number; label: string; colorClass?: string }) {
  // A agulha aponta na direção de rotação da bússola.
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[10px] uppercase tracking-wider text-neutral-500 font-mono">{label}</span>
      <div className="relative size-16 rounded-full border border-white/5 bg-neutral-950/20 flex items-center justify-center">
        {/* Marcações */}
        <span className="absolute top-0.5 text-[6.5px] text-neutral-600 font-bold leading-none">N</span>
        <span className="absolute bottom-0.5 text-[6.5px] text-neutral-600 font-bold leading-none">S</span>
        <span className="absolute left-0.5 text-[6.5px] text-neutral-600 font-bold leading-none">W</span>
        <span className="absolute right-0.5 text-[6.5px] text-neutral-600 font-bold leading-none">E</span>
        
        {/* Agulha */}
        <div 
          className="absolute inset-0 flex items-center justify-center transition-transform duration-1000"
          style={{ transform: `rotate(${deg}deg)` }}
        >
          <div className="relative w-full h-full flex items-center justify-center">
            {/* Seta superior */}
            <div className={cn("absolute top-1 w-0 h-0 border-l-[3.5px] border-l-transparent border-r-[3.5px] border-r-transparent border-b-[8px] border-b-current", colorClass)} />
            {/* Haste central */}
            <div className="w-[1px] h-7 bg-neutral-800 absolute" />
          </div>
        </div>
      </div>
    </div>
  );
}

function WaveSparkline({ waveHours }: { waveHours: Array<{ wave_height: number }> }) {
  if (!waveHours || waveHours.length === 0) return null;
  const heights = waveHours.map((h) => h.wave_height ?? 0);
  
  const width = 270;
  const height = 64;
  const paddingY = 4;
  const paddingX = 4;
  const maxVal = Math.max(...heights, 1.5); // Escala no mínimo até 1.5m
  const minVal = 0;
  
  const points = heights.map((val, idx) => {
    const x = (idx / (heights.length - 1)) * (width - paddingX * 2) + paddingX;
    const y = height - ((val - minVal) / (maxVal - minVal)) * (height - paddingY * 2) - paddingY;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  
  const linePath = `M ${points.join(" L ")}`;
  const areaPath = `${linePath} L ${width - paddingX},${height} L ${paddingX},${height} Z`;
  
  return (
    <div className="flex flex-col gap-1 w-full bg-neutral-950/10 rounded-lg p-3 border border-white/5">
      <div className="flex justify-between text-[9px] uppercase tracking-wider text-neutral-500 font-mono">
        <span>Tendência de Onda (12h)</span>
        <span>Máx: {maxVal.toFixed(1)}m</span>
      </div>
      <div className="relative w-full h-16">
        <svg className="w-full h-full overflow-visible" viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <linearGradient id="waveGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--odin-accent)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--odin-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" y1={height / 2} x2={width} y2={height / 2} stroke="rgba(255,255,255,0.03)" strokeDasharray="3 3" />
          <path d={areaPath} fill="url(#waveGradient)" />
          <path d={linePath} fill="none" stroke="var(--odin-accent)" strokeWidth="1.5" className="drop-shadow-[0_0_4px_var(--odin-accent-soft)]" />
          
          {points.length > 0 && (
            <>
              <circle cx={points[0].split(",")[0]} cy={points[0].split(",")[1]} r="2" fill="var(--odin-accent)" />
              <circle cx={points[points.length - 1].split(",")[0]} cy={points[points.length - 1].split(",")[1]} r="2" fill="var(--odin-accent)" />
            </>
          )}
        </svg>
      </div>
      <div className="flex justify-between text-[8px] text-neutral-500 font-mono">
        <span>Agora</span>
        <span>+12h</span>
      </div>
    </div>
  );
}

export function SurfWidget({ data, loading, error }: SurfWidgetProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-4 py-4 animate-pulse">
        <div className="h-4 bg-white/5 rounded w-1/3"></div>
        <div className="h-28 bg-white/5 rounded"></div>
        <div className="h-16 bg-white/5 rounded"></div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-center">
        <Waves className="size-6 text-neutral-600 mb-2" />
        <span className="text-[10px] text-neutral-500 font-mono uppercase tracking-wider">Surf Report Indisponível</span>
        <span className="text-[9px] text-neutral-600 font-mono mt-1">{error || "Falha na resposta do Open-Meteo"}</span>
      </div>
    );
  }

  const { wave, wind, weather, quality } = data;

  const isTerral = wind.type === "Terral";
  const isMaral = wind.type === "Maral";

  return (
    <div className="flex flex-col gap-5 font-mono text-xs">
      {/* Qualidade e Spot */}
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[11px] uppercase tracking-wider text-neutral-500">Localização</span>
          <span className="text-neutral-100 font-bold text-sm tracking-wide">{data.spot}</span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[11px] uppercase tracking-wider text-neutral-500">Qualidade</span>
          <span className={cn(
            "font-bold uppercase tracking-wider text-sm px-3 py-1 rounded border transition-all duration-300",
            quality === "Clássico" && "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.15)]",
            quality === "Bom" && "bg-teal-500/10 border-teal-500/30 text-teal-400",
            quality === "Regular" && "bg-amber-500/10 border-amber-500/30 text-amber-400",
            quality === "Fraco" && "bg-neutral-500/10 border-neutral-500/30 text-neutral-400",
            quality === "Flat/Marolinha" && "bg-neutral-800/10 border-neutral-800/30 text-neutral-500"
          )}>
            {quality}
          </span>
        </div>
      </div>

      {/* Grid de Informações Visuais (Bússolas) */}
      <div className="grid grid-cols-2 gap-6 py-4 border-y border-white/5">
        <MiniCompass 
          deg={wave.swell_direction_deg} 
          label={`Swell (${wave.swell_direction_compass})`} 
          colorClass="text-[var(--odin-accent)]" 
        />
        <MiniCompass 
          deg={wind.direction_deg} 
          label={`Vento (${wind.direction_compass})`} 
          colorClass={cn(
            isTerral ? "text-emerald-400" : isMaral ? "text-red-400" : "text-amber-400"
          )} 
        />
      </div>

      {/* Métricas Numéricas */}
      <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 text-xs">
        <div className="flex justify-between border-b border-white/5 pb-1.5">
          <span className="text-neutral-500">Altura:</span>
          <span className="text-neutral-100 font-bold">{wave.height.toFixed(1)}m</span>
        </div>
        <div className="flex justify-between border-b border-white/5 pb-1.5">
          <span className="text-neutral-500">Período:</span>
          <span className="text-neutral-100 font-bold">{wave.period}s</span>
        </div>
        <div className="flex justify-between border-b border-white/5 pb-1.5">
          <span className="text-neutral-500">Vento:</span>
          <span className="text-neutral-100">{wind.speed.toFixed(0)} km/h</span>
        </div>
        <div className="flex justify-between border-b border-white/5 pb-1.5">
          <span className="text-neutral-500">Rajadas:</span>
          <span className="text-neutral-100">{wind.gusts.toFixed(0)} km/h</span>
        </div>
        <div className="flex justify-between border-b border-white/5 pb-1.5 col-span-2">
          <span className="text-neutral-500">Condição:</span>
          <span className={cn(
            "font-semibold uppercase tracking-wider text-[10px]",
            isTerral && "text-emerald-400",
            isMaral && "text-red-400/80",
            !isTerral && !isMaral && "text-neutral-300"
          )}>
            {wind.type}
          </span>
        </div>
        <div className="flex justify-between border-b border-white/5 pb-1.5 col-span-2">
          <span className="text-neutral-500">Temp. Local:</span>
          <span className="text-neutral-100 font-semibold">{weather.temp.toFixed(1)}°C</span>
        </div>
      </div>

      {/* Sparkline de Ondas */}
      {data.next_hours?.mar && (
        <WaveSparkline waveHours={data.next_hours.mar} />
      )}
    </div>
  );
}
