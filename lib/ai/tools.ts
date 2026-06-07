/**
 * Ferramentas (function calling) do Odin.
 *
 * Duas metades, mantidas lado a lado de propósito:
 *  - `odinFunctionDeclarations`: o CONTRATO que o Gemini lê para decidir SE/QUAL
 *    ferramenta chamar. A `description` é o que mais importa para a decisão.
 *  - `executeTool`: a EXECUÇÃO real no Node. Nunca lança - qualquer erro vira
 *    `{ error }` para o modelo se recuperar e seguir o stream.
 *
 * Todas as tools vivem no mesmo loop de resolução (ver `lib/ai/chat.ts`). Por isso
 * `webSearch` é uma função nossa (e não o tool nativo do Gemini): o Gemini não
 * permite misturar o `googleSearch` nativo com `functionDeclarations`.
 */
import { Type, type FunctionDeclaration } from "@google/genai";
import { readNote } from "@/lib/vault";
import { retrieveContext } from "@/lib/rag/retrieve";

export const odinFunctionDeclarations: FunctionDeclaration[] = [
  {
    name: "searchSecondBrain",
    description:
      "Busca semântica no segundo cérebro do Gabriel (vault Obsidian indexado). " +
      "Use SEMPRE que a pergunta tocar na vida, projetos, opiniões, metodologias, " +
      "decisões ou aprendizados do Gabriel. Retorna trechos relevantes com a fonte (path).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "O que buscar, em linguagem natural (pt-BR).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "readObsidianNote",
    description:
      "Lê o conteúdo COMPLETO de uma nota específica do vault Obsidian. " +
      "Use quando o usuário citar uma nota por nome/caminho, ou para aprofundar " +
      "numa fonte retornada por searchSecondBrain (passe o `path` daquele resultado).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description:
            "Caminho relativo da nota dentro do vault, ex: 'wiki/karpathy.md'. " +
            "A extensão .md é opcional.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "webSearch",
    description:
      "Busca na web em tempo real. Use para fatos atuais, notícias, dados que " +
      "mudam com o tempo, ou qualquer coisa fora do conhecimento do Gabriel e do " +
      "seu conhecimento geral. NÃO use para assuntos pessoais do Gabriel (use searchSecondBrain).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Os termos de busca.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "getSurfForecast",
    description:
      "Condições de surf e tempo em tempo real para uma praia (default: Peruíbe/SP). " +
      "Retorna agora (altura/período/direção de onda e swell, vento, temperatura) e um " +
      "resumo das próximas ~12h. Use quando o Gabriel perguntar sobre surf, mar, ondas, " +
      "swell, vento ou se 'tá bom pra surfar'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        latitude: {
          type: Type.NUMBER,
          description: "Latitude da praia. Omita para usar Peruíbe/SP.",
        },
        longitude: {
          type: Type.NUMBER,
          description: "Longitude da praia. Omita para usar Peruíbe/SP.",
        },
      },
    },
  },
];

type ToolResult = Record<string, unknown>;
type ToolArgs = Record<string, unknown>;

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

/**
 * webSearch - busca web real via Tavily (feita pra agentes: trechos limpos +
 * uma `answer` sintetizada). Sem `SEARCH_API_KEY` configurada, cai num mock.
 * Para trocar de provedor (Brave/Serper), basta reescrever esta função.
 */
async function webSearch(args: ToolArgs): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return { error: "query vazia." };

  const apiKey = process.env.SEARCH_API_KEY;
  if (!apiKey) {
    return {
      output: {
        note: "Resultado simulado (SEARCH_API_KEY não configurada - modo mock).",
        query,
        results: [
          {
            title: `Resultado de exemplo para "${query}"`,
            url: "https://example.com/odin-mock",
            snippet:
              "Este é um resultado mockado. Configure SEARCH_API_KEY (Tavily) " +
              "para buscas de verdade.",
          },
        ],
      },
    };
  }

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      max_results: 5,
      search_depth: "basic",
      include_answer: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    return { error: `Tavily respondeu ${res.status}: ${text.slice(0, 200)}` };
  }

  const data = (await res.json()) as { answer?: string; results?: TavilyResult[] };
  return {
    output: {
      query,
      answer: data.answer ?? null, // resumo já sintetizado pelo Tavily
      results: (data.results ?? []).map((r) => ({
        title: r.title ?? null,
        url: r.url ?? null,
        snippet: r.content ?? null,
      })),
    },
  };
}

async function readObsidianNote(args: ToolArgs): Promise<ToolResult> {
  const path = String(args.path ?? "").trim();
  if (!path) return { error: "path vazio." };

  const note = await readNote(path);
  if (!note) return { error: `Nota não encontrada ou inacessível: ${path}` };
  return { output: note };
}

async function searchSecondBrain(args: ToolArgs): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return { error: "query vazia." };

  const chunks = await retrieveContext(query);
  if (chunks.length === 0) {
    return { output: { query, results: [], note: "Nada relevante no segundo cérebro." } };
  }
  return {
    output: {
      query,
      results: chunks.map((c) => ({
        title: c.title ?? null,
        path: c.path ?? null,
        content: c.content,
        similarity: c.similarity,
      })),
    },
  };
}

// Peruíbe/SP - ponto de surf padrão do Gabriel.
const PERUIBE = { latitude: -24.32, longitude: -46.99, spot: "Peruíbe/SP" };
const TZ = "America/Sao_Paulo";

/** Graus meteorológicos → ponto cardeal (de onde vem). */
function degToCompass(deg: number | undefined): string | null {
  if (typeof deg !== "number") return null;
  const dirs = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  return dirs[Math.round(deg / 22.5) % 16];
}

async function fetchJson(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo respondeu ${res.status}`);
  return res.json();
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

async function getSurfForecast(args: ToolArgs): Promise<ToolResult> {
  const lat = typeof args.latitude === "number" ? args.latitude : PERUIBE.latitude;
  const lon = typeof args.longitude === "number" ? args.longitude : PERUIBE.longitude;
  const isPeruibe = lat === PERUIBE.latitude && lon === PERUIBE.longitude;

  const marineUrl =
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
    `&current=wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_period,swell_wave_direction` +
    `&hourly=wave_height,wave_period,swell_wave_height,swell_wave_period&forecast_hours=12&timezone=${TZ}`;
  const weatherUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m` +
    `&hourly=wind_speed_10m,wind_direction_10m&forecast_hours=12&wind_speed_unit=kmh&timezone=${TZ}`;

  const [marine, weather] = await Promise.all([
    fetchJson(marineUrl),
    fetchJson(weatherUrl),
  ]);

  const mc = (marine.current as Record<string, number>) ?? {};
  const wc = (weather.current as Record<string, number>) ?? {};

  const now = {
    horario: mc.time ?? wc.time ?? null,
    onda_altura_m: mc.wave_height ?? null,
    onda_periodo_s: mc.wave_period ?? null,
    onda_direcao: degToCompass(mc.wave_direction),
    swell_altura_m: mc.swell_wave_height ?? null,
    swell_periodo_s: mc.swell_wave_period ?? null,
    swell_direcao: degToCompass(mc.swell_wave_direction),
    vento_kmh: wc.wind_speed_10m ?? null,
    vento_rajada_kmh: wc.wind_gusts_10m ?? null,
    vento_direcao: degToCompass(wc.wind_direction_10m),
    temperatura_c: wc.temperature_2m ?? null,
  };

  const next_hours = {
    mar: sampleHours(
      marine.hourly as Record<string, unknown>,
      ["wave_height", "wave_period", "swell_wave_height", "swell_wave_period"]
    ),
    vento: sampleHours(
      weather.hourly as Record<string, unknown>,
      ["wind_speed_10m", "wind_direction_10m"]
    ),
  };

  return {
    output: {
      spot: isPeruibe ? PERUIBE.spot : `lat ${lat}, lon ${lon}`,
      now,
      next_hours,
      units: {
        altura: "m",
        periodo: "s",
        vento: "km/h",
        temperatura: "°C",
        direcao: "ponto cardeal (de onde vem)",
      },
    },
  };
}

const toolExecutors: Record<string, (args: ToolArgs) => Promise<ToolResult>> = {
  webSearch,
  readObsidianNote,
  searchSecondBrain,
  getSurfForecast,
};

/**
 * Executa uma tool pelo nome. Blindado: nunca lança - erro vira `{ error }` para
 * o Gemini continuar o turno em vez de derrubar o stream.
 */
export async function executeTool(
  name: string | undefined,
  args: ToolArgs = {}
): Promise<ToolResult> {
  const exec = name ? toolExecutors[name] : undefined;
  if (!exec) return { error: `Ferramenta desconhecida: ${name}` };
  try {
    return await exec(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return { error: `Falha ao executar ${name}: ${message}` };
  }
}
