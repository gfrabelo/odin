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
 * Normaliza telefone BR para formato internacional (5511999999999).
 * Remove caracteres não-numéricos e adiciona o código do país se ausente.
 */
function normalizePhoneBR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null; // muito curto para ser válido
  // Se já começa com 55 e tem 12-13 dígitos, retorna como está
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  // Adiciona código do país BR
  return `55${digits}`;
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
  const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${token}`;

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
      headers: { "Content-Type": "application/json" },
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

    const leads = results.map((place) => ({
      name: place.title ?? "Sem nome",
      segment: place.categoryName ?? "Não categorizado",
      phone: normalizePhoneBR(place.phone),
      website: place.website || null,
      location: [place.address, place.city, place.state]
        .filter(Boolean)
        .join(", ") || null,
      rating: place.totalScore ?? null,
      source: "google_maps_apify",
      googleMapsUrl: place.url ?? null,
    }));

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
    return parsed.leads.map((l) => ({ ...l, googleMapsUrl: null }));
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

  const isApify = leads.length > 0 && leads[0].source === "google_maps_apify";
  const sourceText = isApify
    ? "Google Maps (Apify)"
    : `Web Search (fallback${apifyResult.error ? `: ${apifyResult.error}` : ""})`;

  const logMessage: WorkflowMessage = {
    agent: "researcher",
    content: `Encontrados ${leads.length} leads via ${sourceText}. ${leads.map((l) => `${l.name} (${l.segment})`).join(", ")}.`,
    timestamp: new Date().toISOString(),
  };

  console.log(`[Odin Workflow] Researcher encontrou ${leads.length} leads via ${sourceText}`);

  return {
    leads,
    currentAgent: "researcher",
    messages: [logMessage],
  };
}
