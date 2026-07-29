/**
 * Odin Workflows — Node: Supervisor
 *
 * ─── CONCEITO 2: Nodes ─────────────────────────────────────────────
 * Um node é uma FUNÇÃO PURA: recebe o estado atual, faz seu trabalho,
 * e retorna um objeto parcial com os campos que quer atualizar.
 *
 * O Supervisor é o "cérebro" do workflow — ele gerencia o estado da
 * execução e decide qual agente especialista deve agir a seguir.
 *
 * Correção de fluxo & estado:
 *  - Avança `currentLeadIndex` quando o lead atual é concluído
 *    (aprovado/rejeitado pelo humano ou desqualificado pelo qualifier).
 *  - Reseta o estado específico do lead (qualificação, draft, feedback)
 *    ao passar para o próximo lead.
 *  - Encerra (`__end__`) quando todos os leads forem processados.
 * ────────────────────────────────────────────────────────────────────
 */

import type { OdinWorkflowState, AgentName, WorkflowMessage } from "../types";

/**
 * Node do Supervisor — orquestra o fluxo de agentes e o ciclo de vida dos leads.
 */
export async function supervisorNode(
  state: OdinWorkflowState
): Promise<Partial<OdinWorkflowState>> {
  const {
    leads,
    currentLeadIndex,
    qualification,
    outreachDraft,
    humanDecision,
    revisionCount,
  } = state;

  // 1. Se ainda não há leads, aciona o Researcher
  if (leads.length === 0) {
    const log: WorkflowMessage = {
      agent: "supervisor",
      content: "Nenhum lead encontrado ainda. Acionando Researcher.",
      timestamp: new Date().toISOString(),
    };
    console.log("[Odin Workflow] Supervisor → researcher (buscando leads)");
    return {
      nextAgent: "researcher",
      currentAgent: "supervisor",
      messages: [log],
    };
  }

  // 2. Verificar se o lead atual foi concluído (aprovado/rejeitado no human review ou desqualificado)
  const isCurrentLeadDisqualified = qualification && !qualification.qualified;
  const isCurrentLeadHumanFinished =
    humanDecision === "approve" || humanDecision === "reject";

  if (isCurrentLeadDisqualified || isCurrentLeadHumanFinished) {
    const nextIndex = currentLeadIndex + 1;

    // Se processou todos os leads encontrados, encerra o workflow
    if (nextIndex >= leads.length) {
      const log: WorkflowMessage = {
        agent: "supervisor",
        content: `Todos os ${leads.length} leads foram processados. Finalizando workflow.`,
        timestamp: new Date().toISOString(),
      };
      console.log(`[Odin Workflow] Supervisor → __end__ (todos os ${leads.length} leads processados)`);
      return {
        nextAgent: "__end__",
        currentAgent: "supervisor",
        status: "completed",
        messages: [log],
      };
    }

    // Avança para o próximo lead e limpa o estado específico do lead anterior
    const nextLead = leads[nextIndex];
    const log: WorkflowMessage = {
      agent: "supervisor",
      content: `Lead #${currentLeadIndex + 1} concluído (${humanDecision ?? "desqualificado"}). Avançando para Lead #${nextIndex + 1}: ${nextLead.name}.`,
      timestamp: new Date().toISOString(),
    };
    console.log(`[Odin Workflow] Supervisor → avançando para Lead #${nextIndex + 1} (${nextLead.name})`);

    return {
      currentLeadIndex: nextIndex,
      qualification: null,
      outreachDraft: "",
      feedback: "",
      approved: false,
      revisionCount: 0,
      humanDecision: null,
      humanEditedMessage: "",
      nextAgent: "qualifier",
      currentAgent: "supervisor",
      messages: [log],
    };
  }

  // 3. Se o humano pediu edição/revisão
  if (humanDecision === "edit") {
    if (revisionCount >= 3) {
      // Teto de revisões atingido -> considera aprovado com mensagem editada
      const log: WorkflowMessage = {
        agent: "supervisor",
        content: "Limite de 3 revisões atingido. Aceitando mensagem editada.",
        timestamp: new Date().toISOString(),
      };
      return {
        approved: true,
        humanDecision: "approve",
        nextAgent: "supervisor", // No próximo ciclo vai avançar pro próximo lead
        currentAgent: "supervisor",
        messages: [log],
      };
    }

    const log: WorkflowMessage = {
      agent: "supervisor",
      content: `Solicitada revisão pelo humano. Acionando Copywriter (revisão #${revisionCount + 1}).`,
      timestamp: new Date().toISOString(),
    };
    return {
      humanDecision: null, // reseta a decisão para permitir nova revisão
      nextAgent: "copywriter",
      currentAgent: "supervisor",
      messages: [log],
    };
  }

  // 4. Fluxo normal para o lead atual:

  // A) Lead atual não foi qualificado ainda -> Qualifier
  if (!qualification) {
    const currentLead = leads[currentLeadIndex];
    const log: WorkflowMessage = {
      agent: "supervisor",
      content: `Qualificando Lead #${currentLeadIndex + 1}: ${currentLead?.name ?? "Desconhecido"}.`,
      timestamp: new Date().toISOString(),
    };
    console.log(`[Odin Workflow] Supervisor → qualifier (Lead #${currentLeadIndex + 1}: ${currentLead?.name})`);
    return {
      nextAgent: "qualifier",
      currentAgent: "supervisor",
      messages: [log],
    };
  }

  // B) Lead qualificado, mas sem draft de mensagem -> Copywriter
  if (qualification.qualified && !outreachDraft) {
    const log: WorkflowMessage = {
      agent: "supervisor",
      content: `Lead #${currentLeadIndex + 1} qualificado (${qualification.score}/10). Gerando draft com Copywriter.`,
      timestamp: new Date().toISOString(),
    };
    console.log(`[Odin Workflow] Supervisor → copywriter (Lead #${currentLeadIndex + 1})`);
    return {
      nextAgent: "copywriter",
      currentAgent: "supervisor",
      messages: [log],
    };
  }

  // C) Draft pronto, pendente de revisão humana -> Human Review
  if (outreachDraft && !humanDecision) {
    const log: WorkflowMessage = {
      agent: "supervisor",
      content: `Draft gerado para Lead #${currentLeadIndex + 1}. Aguardando revisão humana.`,
      timestamp: new Date().toISOString(),
    };
    console.log(`[Odin Workflow] Supervisor → human_review (Lead #${currentLeadIndex + 1})`);
    return {
      nextAgent: "human_review",
      currentAgent: "supervisor",
      messages: [log],
    };
  }

  // Fallback de segurança: se chegou aqui sem regra, encerra para evitar loop
  const fallbackLog: WorkflowMessage = {
    agent: "supervisor",
    content: "Fim do fluxo atingido.",
    timestamp: new Date().toISOString(),
  };
  return {
    nextAgent: "__end__",
    currentAgent: "supervisor",
    status: "completed",
    messages: [fallbackLog],
  };
}

