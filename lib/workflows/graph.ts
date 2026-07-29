/**
 * Odin Workflows — Montagem do Grafo (StateGraph)
 *
 * ─── CONCEITOS 2 + 3: Nodes, Edges e Conditional Edges ─────────────
 *
 * Este arquivo monta a "máquina de estados" do workflow de prospecção:
 *
 *   ┌──────────────┐
 *   │  SUPERVISOR   │ ← Ponto de entrada. Decide quem roda a seguir.
 *   └──────┬───────┘
 *          │ conditional edge (baseado em `nextAgent`)
 *          ├──→ researcher  ──→ supervisor
 *          ├──→ qualifier   ──→ supervisor
 *          ├──→ copywriter  ──→ supervisor
 *          ├──→ human_review ──→ supervisor
 *          └──→ __end__     ──→ FIM
 *
 * O padrão é "hub and spoke": o Supervisor está no centro, todos os
 * especialistas voltam para ele após executar. O Supervisor então
 * decide o próximo passo com base no estado atualizado.
 *
 * ─── CONCEITO 3: Conditional Edges ─────────────────────────────────
 * Depois do Supervisor, o caminho NÃO é fixo — depende do valor de
 * `state.nextAgent`. Isso é implementado via `addConditionalEdges`:
 *
 *   supervisor → ???
 *     nextAgent === "researcher"    → node researcher
 *     nextAgent === "qualifier"     → node qualifier
 *     nextAgent === "copywriter"    → node copywriter
 *     nextAgent === "human_review"  → node human_review
 *     nextAgent === "__end__"       → END (workflow termina)
 *
 * Tradeoff: edges fixos (addEdge) são mais simples mas inflexíveis.
 * O Supervisor PRECISA de conditional edges porque o próximo passo
 * depende do estado (tem leads? estão qualificados? draft aprovado?).
 *
 * Por que todos voltam para o Supervisor em vez de ir direto para o
 * próximo? Porque o Supervisor centraliza a lógica de roteamento.
 * Se adicionarmos um novo agente amanhã (ex: "sender" para enviar
 * via WhatsApp), só precisamos atualizar o Supervisor — não reconfigurar
 * edges entre todos os nodes.
 * ────────────────────────────────────────────────────────────────────
 */

import { END, START, StateGraph } from "@langchain/langgraph";
import { WorkflowState } from "./types";
import type { AgentName } from "./types";
import { supervisorNode } from "./nodes/supervisor";
import { researcherNode } from "./nodes/researcher";
import { qualifierNode } from "./nodes/qualifier";
import { copywriterNode } from "./nodes/copywriter";
import { humanReviewNode } from "./nodes/human-review";
import { getCheckpointer } from "./checkpointer";

/**
 * Função de roteamento do Supervisor.
 *
 * Lê `state.nextAgent` e retorna o nome do node destino.
 * O LangGraph usa este retorno para decidir qual node executar.
 *
 * Isso é uma CONDITIONAL EDGE — o caminho muda dependendo do estado.
 */
function routeFromSupervisor(
  state: typeof WorkflowState.State
): AgentName | typeof END {
  const next = state.nextAgent;

  // Guard: se o Supervisor retornar algo inválido, encerra
  const validAgents: Array<AgentName | "__end__"> = [
    "researcher",
    "qualifier",
    "copywriter",
    "human_review",
    "__end__",
  ];

  if (!validAgents.includes(next)) {
    console.warn(
      `[Odin Workflow] Supervisor retornou agente inválido: "${next}". Encerrando.`
    );
    return END;
  }

  if (next === "__end__") return END;

  return next;
}

/**
 * Cria e compila o grafo do workflow de prospecção.
 *
 * O grafo é compilado com o checkpointer (MemorySaver ou Redis),
 * o que habilita human-in-the-loop (interrupt) e resiliência.
 *
 * @returns O grafo compilado, pronto para `.invoke()` ou `.stream()`.
 */
export async function createProspectWorkflow() {
  const checkpointer = await getCheckpointer();

  // ─── Construção do grafo ──────────────────────────────────────

  const workflow = new StateGraph(WorkflowState)

    // 1. Registrar os nodes (cada agente é uma função pura)
    .addNode("supervisor", supervisorNode)
    .addNode("researcher", researcherNode)
    .addNode("qualifier", qualifierNode)
    .addNode("copywriter", copywriterNode)
    .addNode("human_review", humanReviewNode)

    // 2. Edge de entrada: quando o workflow começa, vai pro Supervisor
    .addEdge(START, "supervisor")

    // 3. Conditional edge: o Supervisor decide para onde ir
    .addConditionalEdges("supervisor", routeFromSupervisor, {
      researcher: "researcher",
      qualifier: "qualifier",
      copywriter: "copywriter",
      human_review: "human_review",
      [END]: END,
    })

    // 4. Todos os especialistas voltam para o Supervisor (hub and spoke)
    .addEdge("researcher", "supervisor")
    .addEdge("qualifier", "supervisor")
    .addEdge("copywriter", "supervisor")
    .addEdge("human_review", "supervisor");

  // ─── Compilação com checkpointer ─────────────────────────────
  //
  // O `interruptBefore` lista os nodes que devem PAUSAR antes de
  // executar (para human-in-the-loop). Aqui, o node "human_review"
  // já usa `interrupt()` internamente, então não precisamos de
  // `interruptBefore`. Mas se quiséssemos pausar ANTES de qualquer
  // node rodar (sem mudar o código do node), usaríamos:
  //   interruptBefore: ["human_review"]

  const app = workflow.compile({
    checkpointer,
  });

  return app;
}
