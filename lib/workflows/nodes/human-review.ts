/**
 * Odin Workflows — Node: Human Review
 *
 * ─── CONCEITO 5: Human-in-the-Loop ─────────────────────────────────
 * Este é o conceito mais poderoso do LangGraph para produção real.
 *
 * A função `interrupt()` faz o grafo PAUSAR. O estado é salvo no
 * checkpointer (MemorySaver ou Redis) e a execução para. O endpoint
 * retorna um evento "interrupt" para a UI, que mostra o draft e
 * botões de aprovação/rejeição.
 *
 * Quando o humano decide, o endpoint recebe a decisão e RE-INVOCA
 * o grafo com o mesmo thread_id. O LangGraph carrega o estado salvo
 * e CONTINUA de onde parou — a função `interrupt()` retorna o valor
 * que o humano enviou.
 *
 * Tradeoff de usar vs. não usar:
 *  - SEM interrupt: o workflow roda do início ao fim sem parar.
 *    Serve para pipelines automatizados (ETL, indexação). Mas para
 *    prospecção, mandar mensagem errada QUEIMA o lead. Inaceitável.
 *  - COM interrupt: o workflow para antes da ação destrutiva (enviar
 *    mensagem), dá controle ao humano, e só continua com aprovação.
 *    Mais lento, mas seguro.
 *
 * No Odin: SEMPRE pausar antes de qualquer ação que afete o mundo
 * externo (enviar mensagem, salvar no vault, publicar).
 * ────────────────────────────────────────────────────────────────────
 */

import { interrupt } from "@langchain/langgraph";
import type { OdinWorkflowState, WorkflowMessage } from "../types";

/** Payload enviado ao humano quando o workflow pausa. */
interface HumanReviewPayload {
  leadName: string;
  leadSegment: string;
  leadPhone: string | null;
  qualificationScore: number;
  opportunities: string[];
  outreachDraft: string;
  revisionCount: number;
}

/** Resposta que o humano envia de volta. */
interface HumanReviewResponse {
  decision: "approve" | "reject" | "edit";
  feedback?: string;
  editedMessage?: string;
}

/**
 * Node de Human Review — pausa o workflow para aprovação humana.
 *
 * 1. Monta o payload com todos os dados relevantes
 * 2. Chama `interrupt()` — o grafo PARA aqui
 * 3. Quando retomado, `interrupt()` retorna a decisão do humano
 * 4. Atualiza o estado com a decisão
 */
export async function humanReviewNode(
  state: OdinWorkflowState
): Promise<Partial<OdinWorkflowState>> {
  const lead = state.leads[state.currentLeadIndex];

  if (!lead) {
    return {
      humanDecision: "reject",
      currentAgent: "human_review",
      messages: [
        {
          agent: "human_review",
          content: "Nenhum lead para revisar.",
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  console.log(`[Odin Workflow] Human Review: pausando para aprovação de "${lead.name}"`);

  // Monta o payload que a UI vai exibir
  const payload: HumanReviewPayload = {
    leadName: lead.name,
    leadSegment: lead.segment,
    leadPhone: lead.phone,
    qualificationScore: state.qualification?.score ?? 0,
    opportunities: state.qualification?.opportunities ?? [],
    outreachDraft: state.outreachDraft,
    revisionCount: state.revisionCount,
  };

  // ══════════════════════════════════════════════════════════════
  // INTERRUPT — O grafo PARA aqui e salva o estado.
  //
  // O valor retornado por interrupt() é o que o humano enviar
  // quando retomar o workflow (via PUT /api/workflow).
  // ══════════════════════════════════════════════════════════════
  const humanResponse = interrupt(payload) as HumanReviewResponse;

  // Quando o humano retoma, a execução continua aqui ↓

  const logMessage: WorkflowMessage = {
    agent: "human_review",
    content: `Decisão humana: ${humanResponse.decision}${humanResponse.feedback ? ` — "${humanResponse.feedback}"` : ""}`,
    timestamp: new Date().toISOString(),
  };

  console.log(`[Odin Workflow] Human Review: decisão = ${humanResponse.decision}`);

  return {
    humanDecision: humanResponse.decision,
    feedback: humanResponse.feedback ?? "",
    humanEditedMessage: humanResponse.editedMessage ?? "",
    approved: humanResponse.decision === "approve",
    currentAgent: "human_review",
    status: "running",
    messages: [logMessage],
  };
}
