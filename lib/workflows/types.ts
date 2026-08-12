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
  | "enricher"
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

/**
 * Análise do site do lead, feita pelo Enricher (Firecrawl).
 *
 * Existe porque a rubrica do Qualifier dá pontos por "site desatualizado/ruim"
 * e, sem isso, o modelo recebia só a string da URL — ou seja, adivinhava.
 * Ver ADR-0011.
 */
export interface SiteAnalysis {
  /** O scrape deu certo? Se false, `error` explica e o Qualifier ignora. */
  ok: boolean;
  /** Título da página (metadata). */
  title: string | null;
  /**
   * Markdown da home, TRUNCADO (~2000 chars). O estado inteiro é
   * checkpointado a cada transição — markdown bruto de 10 sites incharia
   * o checkpoint sem melhorar o julgamento.
   */
  markdown: string | null;
  /** Motivo da falha, quando `ok` é false. */
  error: string | null;
}

/** Informações de um lead encontrado pelo Researcher. */
export interface LeadInfo {
  /**
   * Chave estável do lead — telefone normalizado, ou hash de nome+localização.
   * É o mecanismo de nunca re-contatar o mesmo negócio entre runs.
   */
  leadKey: string;
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
  /** URL direta do Google Maps (deep-link). */
  googleMapsUrl: string | null;
  /**
   * Análise do site. Três estados distintos, de propósito:
   *  - `undefined` → ainda não passou pelo Enricher (é o que o supervisor testa)
   *  - `null`      → não tem site para analisar
   *  - objeto      → foi analisado (veja `ok` para saber se deu certo)
   */
  siteAnalysis?: SiteAnalysis | null;
}

/** Lead + qualificação unificados — um item da tabela de resultados. */
export interface QualifiedLead extends LeadInfo {
  /** Score de qualificação (0-10). */
  score: number;
  /** Derivado em código de `score >= 6`, nunca vindo do modelo. */
  qualified: boolean;
  /** Justificativa do score. */
  reasoning: string;
  /** Oportunidades identificadas. */
  opportunities: string[];
  /** Mensagem de abordagem gerada pelo Copywriter (null = ainda não gerada). */
  message: string | null;
  /** Link wa.me — com `?text=` quando já há mensagem. */
  whatsappLink: string | null;
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

  /**
   * Contexto da demo disponível para este nicho, informado pelo humano.
   * Ex: "site pronto pra chocolateria, feito pra chocoLaura em Peruíbe".
   *
   * Existe porque a regra 6 do COPYWRITER_PROMPT manda mencionar a demo — e
   * sem este campo a menção era mentira. Ver ADR-0011.
   */
  demoContext: Annotation<string>({
    reducer: (_, y) => y,
    default: () => "",
  }),

  /**
   * Leads encontrados pelo Researcher.
   *
   * REPLACE, não append. O append era o que fazia uma nova passada do
   * researcher duplicar leads; "o researcher é dono da lista" é o contrato
   * honesto. Se um dia houver fan-out de várias queries, isto muda.
   */
  leads: Annotation<LeadInfo[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  /**
   * Quantas vezes o Researcher já rodou.
   *
   * É a correção do loop caro: sem este contador, `leads.length === 0`
   * mandava o supervisor de volta ao researcher indefinidamente, pagando
   * uma chamada Apify de 120s por volta.
   */
  researchAttempts: Annotation<number>({
    reducer: (_, y) => y,
    default: () => 0,
  }),

  /** Leads qualificados em batch (replace — qualifier substitui tudo de uma vez). */
  qualifiedLeads: Annotation<QualifiedLead[]>({
    reducer: (_, y) => y,
    default: () => [],
  }),

  /** Log de mensagens internas do workflow (append — histórico completo). */
  messages: Annotation<WorkflowMessage[]>({
    reducer: (current, next) => [...current, ...next],
    default: () => [],
  }),

  /**
   * Decisão final do humano sobre a tabela.
   *
   * Não existe mais "edit": a edição da mensagem acontece direto no textarea
   * da tabela e o link wa.me é remontado no clique. Uma volta pelo grafo para
   * revisar uma mensagem é estritamente pior — o caminho é obsoleto por
   * arquitetura, não inacabado.
   */
  humanDecision: Annotation<"approve" | "reject" | null>({
    reducer: (_, y) => y,
    default: () => null,
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
