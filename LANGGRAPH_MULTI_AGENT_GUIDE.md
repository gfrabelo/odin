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

> ### ⚠️ Como ler este documento (atualizado em 2026-08-26)
>
> Este é um **documento didático** — ele ensina LangGraph usando o Odin como caso.
> Ele **não é mais a fonte canônica das decisões de arquitetura**. As decisões que
> estavam dissolvidas aqui foram extraídas para ADRs, onde carregam status, alternativas
> descartadas e gatilho de revisão:
>
> | O que estava aqui | Agora vive em |
> |---|---|
> | §4 — Bug do loop infinito de estado | [ADR-0003 — Supervisor determinístico](./docs/adr/0003-supervisor-deterministico.md) |
> | §5 — `globalThis` e hot-reload | ADR-0005 ([índice](./docs/adr/README.md)) |
> | §6 — Fallbacks em cascata | [ADR-0004 — Fallbacks em cascata](./docs/adr/0004-fallbacks-em-cascata.md) |
> | §6 — `wa.me` como sender | ADR-0007 ([índice](./docs/adr/README.md)) |
> | §1 — quando **não** usar grafo | [ADR-0009 — A Regra do Turno](./docs/adr/0009-regra-do-turno.md) |
> | §6 — dois scrapers, papéis distintos | [ADR-0011 — Apify descobre, Firecrawl enriquece](./docs/adr/0011-apify-descoberta-firecrawl-enriquecimento.md) |
>
> **O que mudou no código desde a escrita original (T1, 2026-08-11):**
>
> 1. **A rotação lead-a-lead da §4 foi aposentada.** O código da "solução" mostrado ali
>    (com `currentLeadIndex++`) é histórico: o pipeline hoje qualifica e escreve para
>    **todos os leads em chamadas batch**, correlacionadas por `index`, e
>    `currentLeadIndex` é campo legado. A *lição* segue valendo integralmente — só a
>    implementação mudou.
> 2. **O Copywriter agora é roteado.** Quando este guia foi escrito, ele era código morto.
>    Hoje o branch 6 do supervisor o alcança, derivado de
>    `qualifiedLeads.some(l => l.qualified && !l.message)`.
> 3. **Existe um sexto nó: o `enricher`.** Ele abre o site de cada lead via Firecrawl,
>    em paralelo, **antes** do qualifier — que passou a pontuar sobre o conteúdo real do
>    site em vez de adivinhar pela URL. Nó separado, e não um passo dentro do researcher,
>    por granularidade de checkpoint.
> 4. **Leads e runs são persistidos** (`supabase/prospect.sql`), com `lead_key` estável e
>    dedupe **na frente** do pipeline — quem já foi contatado nunca volta a consumir
>    token de qualifier ou copywriter.
>
> Para o estado real do sistema, use sempre [`docs/ESTADO.md`](./docs/ESTADO.md). Para a
> versão didática destes conceitos (analogias, sem código), ver
> [`docs/GUIA-DIDATICO.md`](./docs/GUIA-DIDATICO.md) Parte 5.
>
> **Sobre a §1 abaixo:** ela argumenta por que grafos, mas não diz quando *não* usá-los —
> e essa é a parte que faltava. O critério está em
> [ADR-0009 — A Regra do Turno](./docs/adr/0009-regra-do-turno.md): se o trabalho cabe num
> turno, é loop de tools; se precisa sobreviver ao turno, é grafo. O padrão é o loop; o
> grafo é a exceção que se justifica.

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
        S <--> A2[🌐 Enricher]
        S <--> A3[📊 Qualifier]
        S <--> A4[✍️ Copywriter]
        S <--> A5[👤 Human Review]
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
| **Supervisor Determinístico** | `if/else` puro, 7 branches, todos derivados do estado — nenhum depende de flag a resetar |
| **LLM para Cognição** | Qualifier (scoring), Copywriter (redação), Researcher (extração) |
| **Chamada em Batch** | Uma requisição para N leads no qualifier e no copywriter, correlacionada por `index` — não N requisições |
| **Descobrir ≠ Enriquecer** | Apify lista o diretório fechado (Maps); Firecrawl aprofunda na web aberta. Nós separados |
| **Dedupe na Frente** | `lead_key` estável filtra já-contatados antes do primeiro token pago |
| **Fallback em Cascata** | Apify → Tavily → Mock; Firecrawl → pula o nó; Redis → MemorySaver |
| **globalThis Singleton** | Checkpointer sobrevive ao hot-reload do Next.js |
| **HITL via interrupt()** | Pausa antes de ação externa, resume com Command |
| **SSE Streaming** | Eventos em tempo real para a UI sem WebSocket |
| **wa.me Deep-Link** | Ação externa sem API adicional |

---

## 8. Próximos Passos

**Feito desde a escrita original** (T1, ver [`docs/BACKLOG.md`](./docs/BACKLOG.md)):

- [x] **Persistência de leads e runs no Supabase** — `lead_key` único, dedupe na frente
- [x] **Nó de enriquecimento (Firecrawl)** — qualificação sobre fato, não sobre URL
- [x] **Copywriter roteado e em batch** — mensagem por lead, `?text=` no link
- [x] **Guarda de loop** — `researchAttempts` + branch de saída + `recursionLimit`

**Aberto, na ordem em que destrava credibilidade:**

- [ ] **Harness de evals** — aderência do copywriter às 10 regras, consistência do
      qualifier, recall do RAG. É a lacuna #1 do [`docs/ESTADO.md`](./docs/ESTADO.md):
      hoje a saída dos nós é *admirada*, não *medida*. Especificado em
      [`docs/EVAL.md`](./docs/EVAL.md)
- [ ] **Lint zerado + `typecheck` + CI** — `npm run lint` está vermelho na `main`;
      consertar antes de montar CI, senão o build nasce vermelho e todos aprendem a ignorar
- [ ] **Deploy Railway + Redis** — `RedisSaver` para o workflow pausado sobreviver a
      restart. Hoje é só `MemorySaver`: restart mata revisão pendente
- [ ] **Templates de Workflow** — segundo grafo só depois de a prospecção dar dinheiro, e
      só se passar na Regra do Turno ([ADR-0009](./docs/adr/0009-regra-do-turno.md)). O
      único candidato hoje é o pipeline de conteúdo do canal
- [ ] ⏸ **Sender Node** — disparo automático de WhatsApp. **Adiado com gatilho explícito:**
      o `wa.me` + clique humano é *melhor* enquanto a mensagem não estiver provada (custo
      zero, risco de ban zero, HITL por construção). Gatilho: primeiro contrato fechado *e*
      envio manual virando gargalo medido

