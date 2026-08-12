/**
 * Odin Workflows — Node: Enricher (Firecrawl)
 *
 * Abre o site de cada lead que tem um, para que o Qualifier julgue sobre
 * FATO em vez de adivinhar. Ver ADR-0011.
 *
 * ─── Por que é um nó separado, e não parte do Researcher ────────────
 * Granularidade de checkpoint. O Apify custa dinheiro e leva até 120s;
 * fronteira de nó é fronteira de retry. Com o enriquecimento num nó
 * próprio, os leads já estão salvos no checkpoint quando o Firecrawl roda
 * — se ele falhar e o grafo retomar, o Apify não é repagado.
 *
 * Os scrapes são PARALELOS: com P95 de ~3,4s por página, cinco sites em
 * sequência somariam ~17s ao run sem necessidade nenhuma.
 */

import { scrapeSite, isFirecrawlConfigured } from "../firecrawl";
import type { OdinWorkflowState, LeadInfo, WorkflowMessage } from "../types";

export async function enricherNode(
  state: OdinWorkflowState
): Promise<Partial<OdinWorkflowState>> {
  const { leads } = state;

  // Sem chave: marca todos como analisados (com o motivo) e segue. O
  // supervisor não vai re-acionar este nó porque `siteAnalysis` deixa de
  // ser `undefined` — é isso que evita o loop.
  if (!isFirecrawlConfigured()) {
    console.warn("[Odin Workflow] Enricher: FIRECRAWL_API_KEY ausente — pulando análise.");
    const skipped: LeadInfo[] = leads.map((lead) => ({
      ...lead,
      siteAnalysis: lead.website
        ? {
            ok: false,
            title: null,
            markdown: null,
            error: "FIRECRAWL_API_KEY não configurada.",
          }
        : null,
    }));
    return {
      leads: skipped,
      currentAgent: "enricher",
      messages: [
        {
          agent: "enricher",
          content:
            "⚠️ Análise de site pulada: FIRECRAWL_API_KEY não configurada. " +
            "A qualificação vai usar só os dados do Google Maps.",
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  const withSite = leads.filter((l) => l.website && l.siteAnalysis === undefined);
  console.log(`[Odin Workflow] Enricher: analisando ${withSite.length} sites em paralelo`);

  const analyses = await Promise.all(
    withSite.map(async (lead) => ({
      leadKey: lead.leadKey,
      analysis: await scrapeSite(lead.website as string),
    }))
  );
  const byKey = new Map(analyses.map((a) => [a.leadKey, a.analysis]));

  const enriched: LeadInfo[] = leads.map((lead) => {
    if (lead.siteAnalysis !== undefined) return lead;
    // Sem site: `null` distingue "não tem o que analisar" de "não tentei".
    if (!lead.website) return { ...lead, siteAnalysis: null };
    return { ...lead, siteAnalysis: byKey.get(lead.leadKey) ?? null };
  });

  const okCount = analyses.filter((a) => a.analysis.ok).length;
  const failCount = analyses.length - okCount;

  const logMessage: WorkflowMessage = {
    agent: "enricher",
    content:
      `Sites analisados: ${okCount} com sucesso` +
      (failCount > 0 ? `, ${failCount} falharam (seguem com dados do Maps)` : "") +
      `. ${leads.length - analyses.length} leads sem site.`,
    timestamp: new Date().toISOString(),
  };

  console.log(
    `[Odin Workflow] Enricher: ${okCount} ok, ${failCount} falhas, ${leads.length - analyses.length} sem site`
  );

  return {
    leads: enriched,
    currentAgent: "enricher",
    messages: [logMessage],
  };
}
