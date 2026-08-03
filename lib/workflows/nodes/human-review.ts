/**
 * Odin Workflows — Node: Human Review (Lead Table v2)
 *
 * Na pipeline v2, o Human Review exibe uma TABELA de todos os leads
 * qualificados (filtrado: só qualified === true) usando interrupt().
 *
 * O payload do interrupt contém:
 *  - type: "lead_table" (identifica o formato para a UI)
 *  - leads: QualifiedLead[] (array com scores + links wa.me)
 *  - totalFound / totalQualified (contadores para contexto)
 *
 * O humano vê a tabela, analisa, e clica "Concluir" para encerrar.
 * No futuro (Incremento 2), poderá selecionar leads para gerar mensagens.
 */

import { interrupt } from "@langchain/langgraph";
import type { OdinWorkflowState, WorkflowMessage, QualifiedLead } from "../types";

/** Payload enviado ao humano quando o workflow pausa na tabela. */
interface LeadTablePayload {
  type: "lead_table";
  /** Leads qualificados (filtrados, sorted by score). */
  leads: QualifiedLead[];
  /** Total de leads encontrados pelo Researcher. */
  totalFound: number;
  /** Total de leads qualificados. */
  totalQualified: number;
  /** Tarefa original. */
  task: string;
}

/** Resposta que o humano envia de volta. */
interface HumanResponse {
  decision: "approve" | "reject";
}

export async function humanReviewNode(
  state: OdinWorkflowState
): Promise<Partial<OdinWorkflowState>> {
  const { leads, qualifiedLeads, task } = state;

  // Filtra: só mostra leads qualificados (qualified === true)
  const displayLeads = qualifiedLeads.filter((l) => l.qualified);

  const payload: LeadTablePayload = {
    type: "lead_table",
    leads: displayLeads,
    totalFound: leads.length,
    totalQualified: displayLeads.length,
    task,
  };

  // ══════════════════════════════════════════════════════════════
  //  interrupt() — pausa o workflow e envia o payload para a UI.
  //  Quando o humano responde (via PUT /api/workflow), o LangGraph
  //  retoma a execução e o valor retornado por interrupt() é a
  //  resposta do humano.
  // ══════════════════════════════════════════════════════════════

  const humanResponse = interrupt(payload) as HumanResponse;

  const decision = humanResponse.decision ?? "approve";

  const logMessage: WorkflowMessage = {
    agent: "human_review",
    content: `Revisão concluída: ${decision === "approve" ? "✅ Tabela aprovada" : "❌ Descartada"}. ${displayLeads.length} leads qualificados revisados.`,
    timestamp: new Date().toISOString(),
  };

  console.log(`[Odin Workflow] Human Review: ${decision} (${displayLeads.length} leads na tabela)`);

  return {
    humanDecision: decision,
    currentAgent: "human_review",
    messages: [logMessage],
  };
}
