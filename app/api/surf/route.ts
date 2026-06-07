import { NextResponse } from "next/server";

export const runtime = "nodejs";

const PERUIBE = { latitude: -24.32, longitude: -46.99 };
const TZ = "America/Sao_Paulo";

function degToCompass(deg: number | undefined): string | null {
  if (typeof deg !== "number") return null;
  const dirs = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  return dirs[Math.round(deg / 22.5) % 16];
}

/** Amostra o array `hourly` a cada `step` horas, a partir de agora. */
function sampleHours(
  hourly: Record<string, unknown> | undefined,
  keys: string[],
  step = 3,
  count = 4
): Array<Record<string, unknown>> {
  const times = (hourly?.time as string[]) ?? [];
  if (times.length === 0) return [];
  const out: Array<Record<string, unknown>> = [];
  for (let i = 0; i < times.length && out.length < count; i += step) {
    const sample: Record<string, unknown> = { time: times[i] };
    for (const k of keys) {
      const arr = hourly?.[k] as number[] | undefined;
      if (arr) sample[k] = arr[i];
    }
    out.push(sample);
  }
  return out;
}

export async function GET() {
  try {
    const lat = PERUIBE.latitude;
    const lon = PERUIBE.longitude;

    const marineUrl =
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
      `&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,swell_wave_direction` +
      `&hourly=wave_height,wave_period,swell_wave_height,swell_wave_period&forecast_hours=12&timezone=${TZ}`;
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
      `&hourly=wind_speed_10m,wind_direction_10m&forecast_hours=12&wind_speed_unit=kmh&timezone=${TZ}`;

    // Adiciona revalidate de 15 minutos (900s) para evitar rate limit na API pública
    const [marineRes, weatherRes] = await Promise.all([
      fetch(marineUrl, { next: { revalidate: 900 } }),
      fetch(weatherUrl, { next: { revalidate: 900 } }),
    ]);

    if (!marineRes.ok || !weatherRes.ok) {
      throw new Error(`Open-Meteo retornou erros (marine: ${marineRes.status}, weather: ${weatherRes.status})`);
    }

    const marine = await marineRes.json();
    const weather = await weatherRes.json();

    const mc = marine.current || {};
    const wc = weather.current || {};

    const waveHeight = mc.wave_height ?? 0;
    const wavePeriod = mc.wave_period ?? 0;
    const waveDir = mc.wave_direction ?? 0;
    const swellHeight = mc.swell_wave_height ?? 0;
    const swellPeriod = mc.swell_wave_period ?? 0;
    const swellDir = mc.swell_wave_direction ?? 0;
    const windSpeed = wc.wind_speed_10m ?? 0;
    const windDir = wc.wind_direction_10m ?? 0;
    const windGusts = wc.wind_gusts_10m ?? 0;
    const temp = wc.temperature_2m ?? 0;

    // Determinar a direção do vento em relação à praia de Peruíbe
    // Peruíbe é voltada para Leste / Sudeste (E/SE).
    // Terral (offshore): sopra da terra para o mar, ou seja, quadrante N/NW/W.
    // Maral (onshore): sopra do mar para a terra, ou seja, quadrante S/SE/E.
    // Lateral: de lados (NE/SW).
    const windCompass = degToCompass(windDir);
    let windType = "Mexido"; // default
    if (windCompass) {
      if (["N", "NNE", "NNW", "NW", "WNW", "W"].includes(windCompass)) {
        windType = "Terral"; // offshore (ótimo)
      } else if (["S", "SSE", "SE", "ESE", "E"].includes(windCompass)) {
        windType = "Maral"; // onshore (prejudica a formação)
      } else {
        windType = "Lateral"; // sideshore
      }
    }

    // Heurística de qualidade do surf para beachbreak de Peruíbe
    let quality = "Fraco";
    if (waveHeight >= 0.5) {
      if (wavePeriod >= 10 && windType === "Terral") {
        quality = "Clássico"; // Groundswell forte com terral
      } else if (wavePeriod >= 8 && windType !== "Maral") {
        quality = "Bom";
      } else if (wavePeriod >= 7) {
        quality = "Regular";
      }
    } else {
      quality = "Flat/Marolinha";
    }

    const next_hours = {
      mar: sampleHours(
        marine.hourly,
        ["wave_height", "wave_period", "swell_wave_height", "swell_wave_period"],
        1, // amostra de 1 em 1 hora para o sparkline
        12 // 12 pontos para preencher o sparkline
      ),
      vento: sampleHours(
        weather.hourly,
        ["wind_speed_10m", "wind_direction_10m"],
        3,
        4
      ),
    };

    return NextResponse.json({
      success: true,
      spot: "Peruíbe/SP",
      quality,
      wave: {
        height: waveHeight,
        period: wavePeriod,
        direction_deg: waveDir,
        direction_compass: degToCompass(waveDir) || "SE",
        swell_height: swellHeight,
        swell_period: swellPeriod,
        swell_direction_deg: swellDir,
        swell_direction_compass: degToCompass(swellDir) || "SE",
      },
      wind: {
        speed: windSpeed,
        gusts: windGusts,
        direction_deg: windDir,
        direction_compass: windCompass || "E",
        type: windType,
      },
      weather: {
        temp,
      },
      next_hours,
      updated_at: mc.time || wc.time || new Date().toISOString(),
    });
  } catch (err) {
    console.error("Erro ao buscar dados de surf:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : "Erro desconhecido" },
      { status: 500 }
    );
  }
}
