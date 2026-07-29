/**
 * Odin Workflows — Schema de Estado Tipado
 *
 * ─── CONCEITO 1: StateGraph ────────────────────────────────────────
 * O StateGraph do LangGraph funciona como uma "prancheta compartilhada":
 * cada agente (node) lê o estado atual, faz seu trabalho, e retorna
 * um update parcial. O LangGraph aplica o update via "reducers" —
 * funções que definem COMO cada campo é atualizado.
 *
 * Dois tipos de reducer:
 *  - Replace (padrão): o novo valor sobrescreve o antigo.
 *    Ex: `currentAgent: "writer"` → `currentAgent: "critic"`
 *  - Append: o novo valor é concatenado ao array existente.
 *    Ex: `messages: [...old, newMessage]`
 *
 * Por que NÃO usamos MessageGraph:
 *  - Nosso prospect agent carrega dados estruturados (info do lead,
 *    score, draft, contagem de revisões) que não cabem numa lista
 *    de mensagens pura.
 *  - StateGraph nos dá campos tipados, reducers explícitos e
 *    type-safety completo — o compilador do TypeScript garante que
 *    cada node retorna o formato correto.
 * ────────────────────────────────────────────────────────────────────
 */

import { Annotation } from "@langchain/langgraph";

// ─── Tipos auxiliares ──────────────────────────────────────────────

/** Nomes dos agentes especialistas no workflow de prospecção. */
export type AgentName =
  | "supervisor"
  | "researcher"
  | "qualifier"
  | "copywriter"
  | "human_review";

/** Status geral do workflow. */
export type WorkflowStatus =
  | "idle"
  | "running"
  | "waiting_human"
  | "completed"
  | "failed";

/** Informações de um lead encontrado pelo Researcher. */
export interface LeadInfo {
  /** Nome do negócio/empresa. */
  name: string;
  /** Segmento/nicho do negócio. */
  segment: string;
  /** Telefone (para WhatsApp). */
  phone: string | null;
  /** Website atual (null = não tem — oportunidade!). */
  website: string | null;
  /** Endereço ou região. */
  location: string | null;
  /** Avaliação no Google Maps (se disponível). */
  rating: number | null;
  /** Fonte de onde veio o lead. */
  source: string;
}

/** Resultado da qualificação do lead pelo Qualifier. */
export interface QualificationResult {
  /** Score de 0 a 10 (quanto maior, melhor o fit). */
  score: number;
  /** O lead é qualificado para abordagem? */
  qualified: boolean;
  /** Razão da decisão (para log e transparência). */
  reasoning: string;
  /** Oportunidades identificadas (sem site, site ruim, sem IA, etc). */
  opportunities: string[];
}

/** Uma mensagem interna do workflow (diferente do Message do chat). */
export interface WorkflowMessage {
  /** Qual agente enviou. */
  agent: AgentName;
  /** Conteúdo da mensagem. */
  content: string;
  /** Timestamp ISO. */
  timestamp: string;
}

// ─── Schema do Estado (Annotation.Root) ────────────────────────────
//
// Cada campo usa um reducer:
//  - `(_, y) => y` → replace (último valor ganha)
//  - `(x, y) => [...x, ...y]` → append (acumula)
//
// O `default` define o valor inicial quando o workflow começa.

export const WorkflowState = Annotation.Root({
  /** Tarefa original do usuário (ex: "Prospectar restaurantes em SP"). */
  task: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  /** Status geral do workflow. */
  status: Annotation<WorkflowStatus>({
    reducer: (_, y) => y,
    default: () => "idle" as WorkflowStatus,
  }),

  /** Qual agente está rodando agora. */
  currentAgent: Annotation<AgentName | "__end__">({
    reducer: (_, y) => y,
    default: () => "supervisor" as AgentName,
  }),

  /** Qual agente o supervisor decidiu acionar a seguir. */
  nextAgent: Annotation<AgentName | "__end__">({
    reducer: (_, y) => y,
    default: () => "supervisor" as AgentName,
  }),

  /** Leads encontrados pelo Researcher (append — pode achar mais de um). */
  leads: Annotation<LeadInfo[]>({
    reducer: (current, next) => [...current, ...next],
    default: () => [],
  }),

  /** Índice do lead atualmente sendo processado. */
  currentLeadIndex: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),

  /** Resultado da qualificação do lead atual. */
  qualification: Annotation<QualificationResult | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  /** Rascunho da mensagem de abordagem gerado pelo Copywriter. */
  outreachDraft: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  /** Feedback do Critic ou do humano sobre o draft. */
  feedback: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  /** O draft foi aprovado (pelo critic/humano)? */
  approved: Annotation<boolean>({
    reducer: (_, y) => y,
    default: () => false,
  }),

  /** Quantas revisões o draft já passou (evita loop infinito). */
  revisionCount: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),

  /** Log de mensagens internas do workflow (append — histórico completo). */
  messages: Annotation<WorkflowMessage[]>({
    reducer: (current, next) => [...current, ...next],
    default: () => [],
  }),

  /** Resultado final do humano: "approve" | "reject" | "edit". */
  humanDecision: Annotation<"approve" | "reject" | "edit" | null>({
    reducer: (_, y) => y,
    default: () => null,
  }),

  /** Mensagem editada pelo humano (se humanDecision === "edit"). */
  humanEditedMessage: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),
});

/**
 * Tipo inferido do estado — use para tipar os parâmetros dos nodes.
 *
 * Exemplo:
 * ```ts
 * async function researcherNode(state: OdinWorkflowState) {
 *   // state.task, state.leads, etc. — tudo tipado
 * }
 * ```
 */
export type OdinWorkflowState = typeof WorkflowState.State;

// ─── Tipos de eventos SSE para a UI ────────────────────────────────

/** Eventos emitidos via SSE para o WorkflowPanel na UI. */
export type WorkflowEventType =
  | "workflow_start"
  | "node_start"
  | "node_end"
  | "token"
  | "interrupt"
  | "workflow_end"
  | "error";

export interface WorkflowEvent {
  type: WorkflowEventType;
  /** Qual node emitiu (null para eventos globais do workflow). */
  node: AgentName | null;
  /** Dados do evento (conteúdo varia por tipo). */
  data: Record<string, unknown>;
  /** Timestamp ISO. */
  timestamp: string;
}
