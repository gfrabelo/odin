/**
 * Odin Workflows — Node: Researcher (Apify Google Maps)
 *
 * O Researcher usa a API REST do Apify com o actor Google Maps Scraper
 * (compass/crawler-google-places) para encontrar leads REAIS com dados
 * estruturados: nome, telefone, website, rating, endereço, URL do Maps.
 *
 * Fallback: se APIFY_API_TOKEN não estiver configurado ou a chamada
 * falhar, cai no webSearch (Tavily) + extração por LLM como antes.
 */

import { getGemini } from "@/lib/ai/client";
import { executeTool } from "@/lib/ai/tools";
import { RESEARCHER_PROMPT } from "../prompts";
import { leadKey } from "../lead-key";
import { normalizePhoneBR } from "../whatsapp";
import { findContactedKeys } from "@/lib/prospect/repository";
import type { OdinWorkflowState, LeadInfo, WorkflowMessage } from "../types";

const RESEARCHER_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

// ─── Apify Google Maps Integration ─────────────────────────────────

/** Resultado bruto do actor compass/crawler-google-places. */
interface ApifyPlaceResult {
  title?: string;
  categoryName?: string;
  phone?: string;
  website?: string;
  address?: string;
  city?: string;
  state?: string;
  totalScore?: number;
  url?: string;
  [key: string]: unknown;
}

/**
 * Busca leads no Google Maps via API REST do Apify.
 *
 * Usa o endpoint `run-sync-get-dataset-items` que:
 * 1. Inicia o actor
 * 2. Espera ele finalizar (síncrono)
 * 3. Retorna o dataset diretamente na response
 */
async function searchGoogleMaps(
  query: string,
  maxResults: number = 10
): Promise<{ leads: LeadInfo[]; error?: string }> {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) {
    const err = "APIFY_API_TOKEN não encontrado no ambiente. Reinicie o `npm run dev` após salvar o .env.local.";
    console.warn(`[Odin Workflow] Researcher: ${err}`);
    return { leads: [], error: err };
  }

  const actorId = "compass~crawler-google-places";
  // Token no header, não na query string: query string vaza em log de proxy,
  // histórico e trace de erro.
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items`;

  const input = {
    searchStringsArray: [query],
    maxCrawledPlacesPerSearch: maxResults,
    language: "pt-BR",
    deeperCityScrape: false,
    includeWebResults: false,
    includeReviews: false,
    includeImages: false,
  };

  console.log(`[Odin Workflow] Researcher: chamando Apify Google Maps para "${query}" (max ${maxResults})`);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(120_000), // 2 min timeout
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      const err = `Apify HTTP ${response.status}: ${errorText.slice(0, 100)}`;
      console.error(`[Odin Workflow] Researcher: ${err}`);
      return { leads: [], error: err };
    }

    const results: ApifyPlaceResult[] = await response.json();
    console.log(`[Odin Workflow] Researcher: Apify retornou ${results.length} resultados`);

    const leads = results.map((place) => {
      const name = place.title ?? "Sem nome";
      const phone = normalizePhoneBR(place.phone);
      const location =
        [place.address, place.city, place.state].filter(Boolean).join(", ") || null;

      return {
        leadKey: leadKey({ name, phone, location }),
        name,
        segment: place.categoryName ?? "Não categorizado",
        phone,
        website: place.website || null,
        location,
        rating: place.totalScore ?? null,
        source: "google_maps_apify",
        googleMapsUrl: place.url ?? null,
      };
    });

    return { leads };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Erro de conexão";
    console.error(`[Odin Workflow] Researcher: erro ao chamar Apify: ${errorMessage}`);
    return { leads: [], error: `Apify error: ${errorMessage}` };
  }
}

// ─── Fallback: webSearch + LLM extraction ───────────────────────────

async function searchViaWebFallback(
  state: OdinWorkflowState
): Promise<LeadInfo[]> {
  console.log("[Odin Workflow] Researcher: usando fallback webSearch + LLM");

  const searchResult = await executeTool("webSearch", {
    query: state.task,
  });

  const extractionPrompt = `Com base nos resultados abaixo, extraia uma lista de leads (empresas/negócios).

**Tarefa:** ${state.task}

**Resultados:**
${JSON.stringify(searchResult, null, 2)}

Extraia os leads encontrados no formato JSON.`;

  const response = await getGemini().models.generateContent({
    model: RESEARCHER_MODEL,
    contents: [
      { role: "user", parts: [{ text: extractionPrompt }] },
    ],
    config: {
      systemInstruction: RESEARCHER_PROMPT,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object" as const,
        properties: {
          leads: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                name: { type: "string" as const },
                segment: { type: "string" as const },
                phone: { type: "string" as const, nullable: true },
                website: { type: "string" as const, nullable: true },
                location: { type: "string" as const, nullable: true },
                rating: { type: "number" as const, nullable: true },
                source: { type: "string" as const },
              },
              required: ["name", "segment", "source"],
            },
          },
        },
        required: ["leads"],
      },
    },
  });

  const text = response.text ?? '{"leads":[]}';
  try {
    const parsed = JSON.parse(text) as { leads: LeadInfo[] };
    return parsed.leads.map((l) => {
      const phone = normalizePhoneBR(l.phone);
      return {
        ...l,
        phone,
        googleMapsUrl: null,
        leadKey: leadKey({ name: l.name, phone, location: l.location }),
      };
    });
  } catch {
    return [];
  }
}

// ─── Node principal ─────────────────────────────────────────────────

export async function researcherNode(
  state: OdinWorkflowState
): Promise<Partial<OdinWorkflowState>> {
  console.log(`[Odin Workflow] Researcher iniciando: "${state.task}"`);

  // 1. Tenta Apify Google Maps (dados reais)
  const apifyResult = await searchGoogleMaps(state.task);
  let leads = apifyResult.leads;

  // 2. Fallback se Apify não retornou nada
  if (leads.length === 0) {
    leads = await searchViaWebFallback(state);
  }

  // 3. Filtra leads sem nome útil
  leads = leads.filter((l) => l.name && l.name !== "Sem nome");

  // 4. Descarta quem já foi contatado num run anterior.
  //
  //    Isto vai AQUI, na frente, e não no fim: filtrar antes do Qualifier
  //    e do Copywriter economiza as duas chamadas de LLM. Gravar só no fim
  //    não evitaria gasto nenhum. Fail-safe: sem Supabase, `findContactedKeys`
  //    devolve Set vazio e nada é descartado.
  const foundCount = leads.length;
  const contacted = await findContactedKeys(leads.map((l) => l.leadKey));
  if (contacted.size > 0) {
    leads = leads.filter((l) => !contacted.has(l.leadKey));
  }

  const isApify = apifyResult.leads.length > 0;
  const sourceText = isApify
    ? "Google Maps (Apify)"
    : `Web Search (fallback${apifyResult.error ? `: ${apifyResult.error}` : ""})`;

  const skippedText =
    contacted.size > 0 ? ` ${contacted.size} já contatados, pulados.` : "";

  const logMessage: WorkflowMessage = {
    agent: "researcher",
    content:
      `Encontrados ${foundCount} leads via ${sourceText}.${skippedText}` +
      (leads.length > 0
        ? ` Novos: ${leads.map((l) => `${l.name} (${l.segment})`).join(", ")}.`
        : " Nenhum lead novo."),
    timestamp: new Date().toISOString(),
  };

  console.log(
    `[Odin Workflow] Researcher: ${foundCount} encontrados, ${contacted.size} já contatados, ${leads.length} novos (${sourceText})`
  );

  return {
    leads,
    // Incrementa SEMPRE, inclusive quando não veio nada — é o que permite ao
    // supervisor encerrar em vez de re-acionar o researcher em loop.
    researchAttempts: state.researchAttempts + 1,
    currentAgent: "researcher",
    messages: [logMessage],
  };
}
