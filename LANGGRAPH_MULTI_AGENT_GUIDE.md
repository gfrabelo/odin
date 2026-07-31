---
title: "LangGraph.js & Multi-Agent Orchestration — Guia Prático de Engenharia de IA"
date: 2026-07-28
tags:
  - ai-engineering
  - langgraph
  - typescript
  - multi-agent
  - architecture
  - odin
type: wiki
---

# LangGraph.js & Multi-Agent Orchestration — Guia Prático de Engenharia

> **Resumo:** Este guia sintetiza os conceitos, padrões de arquitetura, código TypeScript e lições de engenharia aprendidas na prática durante o desenvolvimento do módulo **Odin Workflows** — um sistema de orquestração multi-agente para prospecção B2B construído com LangGraph.js, Next.js 16 e Gemini 3.5.

---

## 1. Visão Geral: Por que Grafos Estaduais?

Em aplicações simples de IA, um único prompt com *Function Calling* em loop (ex: `while (hasToolCalls)`) costuma bastar. No entanto, para tarefas complexas como prospecção B2B (pesquisar → qualificar → escrever → revisar → aprovar), a abordagem de prompt único falha por 3 motivos:

1. **Context Window Pollution:** Acumular histórico de pesquisa, extração, qualificação e rascunho em um único contexto degrada a atenção da LLM.
2. **Falta de Previsibilidade:** Uma LLM genérica pode pular etapas críticas (ex: tentar escrever mensagem antes de qualificar).
3. **Impossibilidade de Interrupção Humana (HITL):** Em scripts procedurais, pausar a execução no meio do servidor Node para esperar uma ação do usuário e retomar sem perder o contexto é extremamente difícil de implementar.

O **LangGraph.js** resolve isso modelando a aplicação como um **Grafo Orientado Estadual (StateGraph)**:
- **Estado (State):** Uma estrutura tipada compartilhada entre todos os agentes.
- **Nós (Nodes):** Funções puras especialistas (Researcher, Qualifier, Copywriter) que lêem o estado e retornam alterações parciais.
- **Arestas (Edges):** Regras de transição (estáticas ou condicionais) que controlam para onde o fluxo vai a seguir.

---

## 2. Padrões de Arquitetura Multi-Agente

Ao desenhar sistemas multi-agente, existem 3 padrões clássicos:

```mermaid
graph TD
    subgraph Pattern 1: Network (Caótico)
        N1[Agent A] <--> N2[Agent B]
        N2 <--> N3[Agent C]
        N1 <--> N3
    end

    subgraph Pattern 2: Supervisor (Hub and Spoke - Escolhido)
        S[🧠 Supervisor] <--> A1[🔍 Researcher]
        S <--> A2[📊 Qualifier]
        S <--> A3[✍️ Copywriter]
        S <--> A4[👤 Human Review]
    end
```

### Por que o padrão Supervisor (Hub-and-Spoke) foi o escolhido no Odin?

1. **Network (Rede Livre):** Cada agente pode chamar qualquer outro agente. 
   - *Problema:* Caótico, imprevisível e propenso a laços infinitos (ex: Copywriter chamando Researcher sem controle).
2. **Hierarchical (Hierárquico):** Supervisores delegam para sub-supervisores.
   - *Problema:* Over-engineering para times de 3 a 6 agentes.
3. **Supervisor (Hub-and-Spoke - Nosso Padrão):** Um orquestrador central (Supervisor) inspeciona o estado e decide quem atua a seguir. Todos os agentes especialistas executam sua tarefa e **retornam obrigatoriamente para o Supervisor**.
   - *Vantagem:* Extensibilidade total. Para adicionar um novo agente (ex: *Whatsapp Sender*), basta registrar o nó e adicionar a regra no Supervisor — sem mexer nos outros agentes.

---

## 3. Os 7 Pilares do LangGraph.js na Prática

### 1. StateGraph vs MessageGraph

- **MessageGraph:** O estado é apenas uma lista de mensagens `BaseMessage[]`. Útil para chatbots simples.
- **StateGraph (Usado no Odin):** Permite definir um schema de estado rico via `Annotation.Root` com reducers explícitos.

```typescript
// lib/workflows/types.ts
import { Annotation } from "@langchain/langgraph";

export const WorkflowState = Annotation.Root({
  task: Annotation<string>({ reducer: (_, y) => y, default: () => "" }),
  leads: Annotation<LeadInfo[]>({ reducer: (x, y) => [...x, ...y], default: () => [] }),
  currentLeadIndex: Annotation<number>({ reducer: (_, y) => y, default: () => 0 }),
  qualification: Annotation<QualificationResult | null>({ reducer: (_, y) => y, default: () => null }),
  outreachDraft: Annotation<string>({ reducer: (_, y) => y, default: () => "" }),
  humanDecision: Annotation<"approve" | "reject" | "edit" | null>({ reducer: (_, y) => y, default: () => null }),
});
```
> **Lição:** Os *reducers* definem como os campos são atualizados. Use `(_, y) => y` para substituição direta (*Replace*) e `(x, y) => [...x, ...y]` para acúmulo (*Append*).

---

### 2. Nodes (Nós Specialists)

Cada agente especialista é uma função assíncrona pura:

`Node(State) → Partial<State>`

```typescript
// Exemplo: Node do Qualifier
export async function qualifierNode(state: OdinWorkflowState): Promise<Partial<OdinWorkflowState>> {
  const lead = state.leads[state.currentLeadIndex];
  // ... executa qualificação via LLM (Gemini 3.5 com Structured Output)
  return {
    qualification: { score: 6, qualified: true, reasoning: "...", opportunities: [...] },
    currentAgent: "qualifier",
  };
}
```

---

### 3. Conditional Edges (Arestas Condicionais)

As arestas condicionais permitem roteamento dinâmico baseado no estado atual:

```typescript
// lib/workflows/graph.ts
function routeFromSupervisor(state: OdinWorkflowState) {
  if (state.nextAgent === "__end__") return END;
  return state.nextAgent;
}

workflow.addConditionalEdges("supervisor", routeFromSupervisor, {
  researcher: "researcher",
  qualifier: "qualifier",
  copywriter: "copywriter",
  human_review: "human_review",
  [END]: END,
});
```

---

### 4. Checkpointing & Persistência

O Checkpointer salva o snapshot do estado a cada transição de nó no grafo.

- **MemorySaver:** Armazena em memória RAM Node.js. Excelente para desenvolvimento local.
- **RedisSaver (`@langchain/langgraph-checkpoint-redis`):** Persiste no Redis (com suporte a RedisJSON). Ideal para produção (Railway/Docker) — permite que o workflow sobreviva a deploys ou restarts do servidor.

```typescript
// lib/workflows/checkpointer.ts
export async function getCheckpointer(): Promise<BaseCheckpointSaver> {
  if (process.env.REDIS_URL) {
    const { RedisSaver } = await import("@langchain/langgraph-checkpoint-redis");
    return await RedisSaver.fromUrl(process.env.REDIS_URL);
  }
  return new MemorySaver(); // Fallback gracioso
}
```

---

### 5. Human-in-the-Loop (HITL)

O recurso mais poderoso para ambientes críticos de negócios. Usamos a função `interrupt()` do LangGraph para **pausar** o workflow antes de ações externas (ex: enviar mensagem no WhatsApp):

```typescript
// lib/workflows/nodes/human-review.ts
import { interrupt } from "@langchain/langgraph";

export async function humanReviewNode(state: OdinWorkflowState) {
  // 1. Pausa o grafo e envia o payload para a UI
  const humanResponse = interrupt({
    lead: state.leads[state.currentLeadIndex],
    draft: state.outreachDraft,
  }) as { decision: "approve" | "reject" | "edit"; feedback?: string };

  // 2. Quando o usuário clica na UI, o grafo retoma DAQUI!
  return {
    humanDecision: humanResponse.decision,
    feedback: humanResponse.feedback ?? "",
  };
}
```

Para retomar na API Route:
```typescript
// PUT /api/workflow
const app = await createProspectWorkflow();
await app.stream(
  new Command({ resume: { decision: "approve" } }),
  { configurable: { thread_id: threadId } }
);
```

---

### 6. Streaming de Estado em Tempo Real (SSE)

Para garantir uma UX fluida e sem spinners congelados, o servidor emite Server-Sent Events (SSE) usando o `app.stream()` em tempo real:

```typescript
// app/api/workflow/route.ts
const eventStream = await app.stream(initialState, {
  configurable: { thread_id: threadId },
  streamMode: "updates", // Emite eventos a cada nó concluído
});

for await (const event of eventStream) {
  // Envia eventos tipados (node_start, node_end, interrupt, workflow_end) para a UI
}
```

---

## 4. Lição de Engenharia: O Bug do "Loop Infinito de Estado"

Durante a implementação do Prospect Agent, nos deparamos com um bug clássico de arquitetura em sistemas baseados em grafo:

### O Problema:
Após a aprovação humana de um lead (ex: Lead #1 - Scob Pet Shop), o Supervisor ordenava "qualificar o próximo lead". No entanto, o `currentLeadIndex` permaneceu preso em `0`, e os campos `qualification` e `outreachDraft` continham os dados do Lead #1. O `Qualifier` relia a posição `0` e re-qualificava o mesmo lead infinitamente!

### A Causa Raiz:
Delegar a manutenção mecânica de ponteiros (`currentLeadIndex++`) e a limpeza de estado (`qualification = null`) 100% para prompts da LLM é frágil e propenso a ambiguidades.

### A Solução (Grafo Híbrido Determinístico):
Tornamos o **Supervisor um Gerenciador de Estado Determinístico**:

```typescript
// Se o lead atual foi aprovado/rejeitado pelo humano ou desqualificado:
if (isCurrentLeadDisqualified || isCurrentLeadHumanFinished) {
  const nextIndex = currentLeadIndex + 1;
  
  if (nextIndex >= leads.length) {
    return { nextAgent: "__end__", status: "completed" };
  }

  // Avança deterministicamente o índice e limpa o estado do lead anterior
  return {
    currentLeadIndex: nextIndex,
    qualification: null,
    outreachDraft: "",
    humanDecision: null,
    revisionCount: 0,
    nextAgent: "qualifier",
  };
}
```

> 💡 **Princípio de Ouro:** *Use LLMs para tarefas cognitivas (pesquisa, avaliação, copywriting) e código TypeScript determinístico para controle de fluxo, estados e contadores.*

---

## 5. Lição de Engenharia: globalThis e Hot-Reload no Next.js

### O Problema:
Ao usar `MemorySaver` (checkpointer in-memory) com `next dev`, o Next.js faz hot-reload dos módulos a cada edição de arquivo. Isso recriava uma nova instância do `MemorySaver`, **apagando todos os workflows em andamento**. Resultado: 404 ao tentar resumir um workflow interrompido.

### A Solução:
Armazenar o checkpointer no `globalThis` do Node.js — o mesmo padrão que Next.js recomenda para Prisma, Supabase e outras conexões:

```typescript
const globalForCheckpointer = globalThis as unknown as {
  __odinCheckpointer?: BaseCheckpointSaver;
};

export async function getCheckpointer() {
  if (globalForCheckpointer.__odinCheckpointer) {
    return globalForCheckpointer.__odinCheckpointer;
  }
  const saver = new MemorySaver();
  globalForCheckpointer.__odinCheckpointer = saver;
  return saver;
}
```

> 💡 **Regra prática:** Em `next dev`, qualquer singleton que vive em memória (connection pools, caches, checkpointers) deve ser ancorado no `globalThis` para sobreviver ao hot-reload.

---

## 6. Lição de Engenharia: Integração com APIs Externas em Nodes

### Apify Google Maps no Researcher
Substituímos o `webSearch` genérico pelo Apify Google Maps Scraper (`compass/crawler-google-places`) via endpoint síncrono `run-sync-get-dataset-items`. Isso retorna dados reais com telefone, website, rating e endereço direto do Google Maps.

**Padrão aprendido:** Sempre implementar com **fallback gracioso**:
```
Apify (dados reais) → Tavily (busca web) → Mock (offline)
```

### wa.me como "Sender" Simplificado
Em vez de integrar uma API de WhatsApp (Uazapi/Z-API), usamos o deep-link `https://wa.me/{phone}?text={encodedMessage}` que abre o WhatsApp Web/App direto com a mensagem pronta. Zero infraestrutura adicional, zero custo, 1 clique para enviar.

**Lição:** Nem todo problema precisa de uma API complexa. Um link bem construído pode ser a solução mais elegante.

---

## 7. Resumo dos Padrões Extraídos

| Padrão | Aplicação no Odin |
|--------|------------------|
| **Supervisor Determinístico** | Regras em código para rotação de leads, limpeza de estado e terminação |
| **LLM para Cognição** | Qualifier (scoring), Copywriter (redação), Researcher (extração) |
| **Fallback em Cascata** | Apify → Tavily → Mock; Redis → MemorySaver |
| **globalThis Singleton** | Checkpointer sobrevive ao hot-reload do Next.js |
| **HITL via interrupt()** | Pausa antes de ação externa, resume com Command |
| **SSE Streaming** | Eventos em tempo real para a UI sem WebSocket |
| **wa.me Deep-Link** | Ação externa sem API adicional |

---

## 8. Próximos Passos

- [ ] **OpenAI como provedor alternativo nos Workflows** — gpt-4o-mini para reduzir custo
- [ ] **Persistência de Leads no Supabase** — CRM pessoal com histórico de prospecção
- [ ] **Deploy Railway + Redis** — RedisSaver para checkpointing em produção
- [ ] **Templates de Workflow** — workflows reutilizáveis (prospecção, auditoria IA, follow-up)
- [ ] **Sender Node** — disparo automático de WhatsApp via API (Uazapi/Z-API)

