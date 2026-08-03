/**
 * Odin Workflows — Node: Supervisor (Pipeline v2 — Batch)
 *
 * O Supervisor na v2 é simplificado: gerencia um pipeline linear
 * de 3 estágios (research → qualify → table) em vez de rotação
 * lead-a-lead.
 *
 * Fluxo:
 *  1. Se leads.length === 0          → researcher
 *  2. Se qualifiedLeads.length === 0 → qualifier (batch)
 *  3. Senão                          → human_review (mostra tabela)
 *  4. Após human_review              → __end__
 */

import type { OdinWorkflowState, AgentName, WorkflowMessage } from "../types";

export async function supervisorNode(
  state: OdinWorkflowState
): Promise<Partial<OdinWorkflowState>> {
  const {
    leads,
    qualifiedLeads,
    humanDecision,
  } = state;

  // 1. Se o humano já concluiu a revisão da tabela, encerra
  if (humanDecision === "approve" || humanDecision === "reject") {
    const log: WorkflowMessage = {
      agent: "supervisor",
      content: `Revisão concluída. Workflow finalizado com ${qualifiedLeads.filter((l) => l.qualified).length} leads qualificados.`,
      timestamp: new Date().toISOString(),
    };
    console.log("[Odin Workflow] Supervisor → __end__ (revisão humana concluída)");
    return {
      nextAgent: "__end__",
      currentAgent: "supervisor",
      status: "completed",
      messages: [log],
    };
  }

  // 2. Se ainda não há leads, aciona o Researcher
  if (leads.length === 0) {
    const log: WorkflowMessage = {
      agent: "supervisor",
      content: "Nenhum lead encontrado ainda. Acionando Researcher.",
      timestamp: new Date().toISOString(),
    };
    console.log("[Odin Workflow] Supervisor → researcher (buscando leads)");
    return {
      nextAgent: "researcher" as AgentName,
      currentAgent: "supervisor",
      messages: [log],
    };
  }

  // 3. Se tem leads mas ainda não foram qualificados em batch, aciona o Qualifier
  if (qualifiedLeads.length === 0) {
    const log: WorkflowMessage = {
      agent: "supervisor",
      content: `${leads.length} leads encontrados. Qualificando todos em batch.`,
      timestamp: new Date().toISOString(),
    };
    console.log(`[Odin Workflow] Supervisor → qualifier (batch de ${leads.length} leads)`);
    return {
      nextAgent: "qualifier" as AgentName,
      currentAgent: "supervisor",
      messages: [log],
    };
  }

  // 4. Leads qualificados prontos → mostra tabela para o humano
  const qualifiedCount = qualifiedLeads.filter((l) => l.qualified).length;
  const log: WorkflowMessage = {
    agent: "supervisor",
    content: `${qualifiedCount} leads qualificados prontos para revisão. Exibindo tabela.`,
    timestamp: new Date().toISOString(),
  };
  console.log(`[Odin Workflow] Supervisor → human_review (tabela com ${qualifiedCount} leads qualificados)`);
  return {
    nextAgent: "human_review" as AgentName,
    currentAgent: "supervisor",
    messages: [log],
  };
}
