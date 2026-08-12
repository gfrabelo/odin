/**
 * Odin Prospect — persistência de runs e leads.
 *
 * ─── Por que isto vive fora do grafo ────────────────────────────────
 * O LangGraph REEXECUTA o nó do topo ao retomar de um `interrupt()`.
 * Qualquer escrita colocada acima do `interrupt` em `human-review.ts`
 * rodaria DUAS VEZES — é a armadilha mais desagradável do LangGraph, e
 * exatamente onde uma implementação desavisada colocaria o insert.
 *
 * A rota (`app/api/workflow/route.ts`) já tem o estado final em mãos no
 * momento em que emite o evento de interrupt: é a fronteira transacional
 * natural. Se um dia o grafo rodar fora do HTTP (cron), isto migra para um
 * nó dedicado — e aí precisa de guarda de idempotência.
 *
 * BLINDADO: nada aqui lança. Sem Supabase configurado, todas as funções
 * viram no-op e o workflow roda igual, só sem memória (ADR-0004).
 */

import { getSupabase, isSupabaseConfigured } from "@/lib/rag/supabase";
import type { QualifiedLead } from "@/lib/workflows/types";

/** Status de contato — o ciclo de vida comercial do lead. */
export type ContactStatus =
  | "novo"
  | "contatado"
  | "respondeu"
  | "reuniao"
  | "fechado"
  | "descartado";

/**
 * Chaves de leads que JÁ foram contatados num run anterior.
 *
 * Usada pelo Researcher, na frente do pipeline: filtrar aqui economiza as
 * chamadas de LLM do Qualifier e do Copywriter. Filtrar no fim não
 * economizaria nada.
 *
 * Fail-safe: sem Supabase, devolve Set vazio → nada é filtrado.
 */
export async function findContactedKeys(
  leadKeys: string[]
): Promise<Set<string>> {
  if (!isSupabaseConfigured() || leadKeys.length === 0) return new Set();

  try {
    const { data, error } = await getSupabase()
      .from("leads")
      .select("lead_key, contact_status")
      .in("lead_key", leadKeys)
      .neq("contact_status", "novo");

    if (error || !Array.isArray(data)) return new Set();
    return new Set(data.map((r) => r.lead_key as string));
  } catch {
    return new Set();
  }
}

interface RunInput {
  threadId: string;
  task: string;
  demoContext: string;
  status: string;
  totalFound: number;
  totalQualified: number;
}

/**
 * Grava (ou atualiza) o run e todos os seus leads.
 *
 * Devolve `true` se persistiu — a rota usa isso só para logar, nunca para
 * decidir fluxo.
 */
export async function saveRun(
  run: RunInput,
  leads: QualifiedLead[]
): Promise<boolean> {
  if (!isSupabaseConfigured()) return false;

  try {
    const supabase = getSupabase();

    const { data: runRow, error: runError } = await supabase
      .from("prospect_runs")
      .upsert(
        {
          thread_id: run.threadId,
          task: run.task,
          demo_context: run.demoContext || null,
          status: run.status,
          total_found: run.totalFound,
          total_qualified: run.totalQualified,
        },
        { onConflict: "thread_id" }
      )
      .select("id")
      .single();

    if (runError || !runRow) {
      console.warn("[Odin Prospect] Falha ao gravar run:", runError?.message);
      return false;
    }

    if (leads.length === 0) return true;

    // IMPORTANTE: o upsert NÃO inclui `contact_status` nem `contacted_at`.
    // São colunas do humano, não do grafo — sobrescrevê-las aqui apagaria
    // o histórico de quem já foi abordado, que é justamente o que estas
    // tabelas existem para guardar.
    const rows = leads.map((lead) => ({
      lead_key: lead.leadKey,
      run_id: runRow.id as string,
      name: lead.name,
      segment: lead.segment,
      phone: lead.phone,
      website: lead.website,
      location: lead.location,
      rating: lead.rating,
      source: lead.source,
      google_maps_url: lead.googleMapsUrl,
      score: Math.round(lead.score),
      qualified: lead.qualified,
      reasoning: lead.reasoning,
      opportunities: lead.opportunities,
      message: lead.message,
      whatsapp_link: lead.whatsappLink,
      updated_at: new Date().toISOString(),
    }));

    const { error: leadsError } = await supabase
      .from("leads")
      .upsert(rows, { onConflict: "lead_key" });

    if (leadsError) {
      console.warn("[Odin Prospect] Falha ao gravar leads:", leadsError.message);
      return false;
    }

    console.log(
      `[Odin Prospect] Run ${run.threadId} gravado: ${leads.length} leads.`
    );
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : "erro desconhecido";
    console.warn("[Odin Prospect] Erro ao persistir:", message);
    return false;
  }
}

/**
 * Marca um lead como contatado.
 *
 * Chamado pelo clique no botão de WhatsApp — o único momento em que o
 * sistema tem evidência de que houve abordagem. O grafo não consegue saber
 * disso: o `wa.me` abre o app e não reporta nada de volta.
 */
export async function markContacted(
  leadKey: string,
  status: ContactStatus = "contatado"
): Promise<boolean> {
  if (!isSupabaseConfigured() || !leadKey) return false;

  try {
    const { error } = await getSupabase()
      .from("leads")
      .update({
        contact_status: status,
        contacted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("lead_key", leadKey);

    if (error) {
      console.warn("[Odin Prospect] Falha ao marcar contatado:", error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
