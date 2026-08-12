/**
 * Odin Workflows — Node: Supervisor
 *
 * Roteador DETERMINÍSTICO: if/else sobre o estado, zero LLM. Nasceu de um
 * bug de loop infinito em produção, onde delegar a manutenção de ponteiros
 * a um prompt fazia o Qualifier re-qualificar o mesmo lead para sempre.
 * Ver ADR-0003.
 *
 * Todo branch aqui é FUNÇÃO DO ESTADO — nenhum depende de flag que precise
 * ser resetada. É o que garante que não existe estado "sujo" entre etapas:
 *
 *  1. humano já decidiu                          → __end__ (completed)
 *  2. sem leads, researcher ainda não rodou      → researcher
 *  3. sem leads, researcher já rodou             → __end__ (failed)
 *  4. tem lead com site ainda não analisado      → enricher
 *  5. leads ainda não qualificados               → qualifier
 *  6. tem lead qualificado sem mensagem          → copywriter
 *  7. senão                                      → human_review
 *
 * O branch 3 é a correção do loop caro: sem ele, `leads.length === 0`
 * mandava de volta ao researcher indefinidamente, pagando uma chamada
 * Apify de 120s por volta até estourar o recursionLimit.
 */

import type { OdinWorkflowState, AgentName, WorkflowMessage } from "../types";

/** Monta a mensagem de log do supervisor (todo branch produz uma). */
function log(content: string): WorkflowMessage {
  return {
    agent: "supervisor",
    content,
    timestamp: new Date().toISOString(),
  };
}

export async function supervisorNode(
  state: OdinWorkflowState
): Promise<Partial<OdinWorkflowState>> {
  const { leads, qualifiedLeads, humanDecision, researchAttempts } = state;

  // 1. O humano já revisou a tabela — encerra.
  if (humanDecision !== null) {
    const count = qualifiedLeads.filter((l) => l.qualified).length;
    const verb = humanDecision === "approve" ? "concluída" : "descartada";
    console.log(`[Odin Workflow] Supervisor → __end__ (revisão ${verb})`);
    return {
      nextAgent: "__end__",
      currentAgent: "supervisor",
      status: "completed",
      messages: [log(`Revisão ${verb}. ${count} leads qualificados.`)],
    };
  }

  // 2. Ainda não buscamos — aciona o Researcher.
  if (leads.length === 0 && researchAttempts === 0) {
    console.log("[Odin Workflow] Supervisor → researcher (primeira busca)");
    return {
      nextAgent: "researcher" as AgentName,
      currentAgent: "supervisor",
      messages: [log("Nenhum lead ainda. Acionando Researcher.")],
    };
  }

  // 3. Já buscamos e sobrou nada — encerra em vez de circular.
  //
  //    "Sobrou nada" tem duas causas e o supervisor não distingue: ou a
  //    busca não achou ninguém, ou achou e todos já haviam sido contatados
  //    (o Researcher filtra na frente). O log dele conta qual foi; aqui a
  //    mensagem cobre os dois casos em vez de afirmar o errado.
  if (leads.length === 0) {
    console.warn(
      `[Odin Workflow] Supervisor → __end__ (nenhum lead novo após ${researchAttempts} tentativa(s))`
    );
    return {
      nextAgent: "__end__",
      currentAgent: "supervisor",
      status: "failed",
      messages: [
        log(
          `Nenhum lead novo para trabalhar. Ou a busca não encontrou negócios, ` +
            `ou todos os encontrados já foram contatados antes — veja o log do ` +
            `Pesquisador acima. Tente outra região ou outro nicho.`
        ),
      ],
    };
  }

  // 4. Tem lead com site que ainda não foi analisado — enriquece antes de qualificar.
  //    `siteAnalysis === undefined` = nunca passou pelo Enricher.
  const pendingEnrichment = leads.filter(
    (l) => l.website && l.siteAnalysis === undefined
  ).length;
  if (pendingEnrichment > 0) {
    console.log(
      `[Odin Workflow] Supervisor → enricher (${pendingEnrichment} sites a analisar)`
    );
    return {
      nextAgent: "enricher" as AgentName,
      currentAgent: "supervisor",
      messages: [log(`${pendingEnrichment} leads com site. Analisando antes de qualificar.`)],
    };
  }

  // 5. Leads prontos, ainda não qualificados — batch único.
  if (qualifiedLeads.length === 0) {
    console.log(`[Odin Workflow] Supervisor → qualifier (batch de ${leads.length})`);
    return {
      nextAgent: "qualifier" as AgentName,
      currentAgent: "supervisor",
      messages: [log(`${leads.length} leads encontrados. Qualificando em batch.`)],
    };
  }

  // 6. Tem lead qualificado sem mensagem — aciona o Copywriter.
  //    Derivado do estado: nada para resetar. No caso vazio (zero qualificados),
  //    `some` devolve false e cai direto no human_review, sem gastar uma chamada.
  const pendingCopy = qualifiedLeads.filter((l) => l.qualified && !l.message).length;
  if (pendingCopy > 0) {
    console.log(`[Odin Workflow] Supervisor → copywriter (${pendingCopy} mensagens)`);
    return {
      nextAgent: "copywriter" as AgentName,
      currentAgent: "supervisor",
      messages: [log(`Escrevendo mensagem para ${pendingCopy} leads qualificados.`)],
    };
  }

  // 7. Tudo pronto — mostra a tabela para o humano.
  const qualifiedCount = qualifiedLeads.filter((l) => l.qualified).length;
  console.log(`[Odin Workflow] Supervisor → human_review (${qualifiedCount} leads)`);
  return {
    nextAgent: "human_review" as AgentName,
    currentAgent: "supervisor",
    messages: [log(`${qualifiedCount} leads prontos para revisão. Exibindo tabela.`)],
  };
}
