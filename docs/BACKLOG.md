# BACKLOG — sequenciado

> **Data:** 2026-08-11 · Origem: [`ESTADO.md`](./ESTADO.md) §2 e §3
>
> Três camadas, com critério explícito de ordenação: **T1 destrava caixa, T2 destrava
> credibilidade, T3 é depois.** Estimativas são honestas, não otimistas.
>
> O critério não é "o que é mais interessante". É o que o projeto precisa **agora**: o
> Gabriel está se realocando como AI Engineer e o workflow de prospecção é o que gera
> contrato no meio do caminho.

---

## ✅ T1 — destrava caixa (concluído em 2026-08-11)

Estado final entregue: **um run produz uma tabela de leads qualificados, cada um com
mensagem pronta que o Gabriel edita e dispara num clique — e o sistema lembra quem já foi
contatado.**

| # | Item | Onde |
|---|---|---|
| ✅ 1 | Guarda de loop: `researchAttempts` + branch de saída + `recursionLimit: 12` | `nodes/supervisor.ts`, `types.ts`, `nodes/researcher.ts`, `api/workflow/route.ts` |
| ✅ 2 | `qualified` derivado de `score >= 6` em código; campo fora do `responseSchema` | `nodes/qualifier.ts` |
| ✅ 3 | Token Apify no header `Authorization` | `nodes/researcher.ts` |
| ✅ 5 | `leadKey` estável + `buildWhatsAppLink` com `?text=` | `lib/workflows/lead-key.ts`, `lib/workflows/whatsapp.ts` |
| ✅ 6 | Copywriter em batch, correlacionado por `index`, mesclando `message` | `nodes/copywriter.ts` |
| ✅ 7 | Copywriter roteado pelo branch 6 (derivado do estado) | `nodes/supervisor.ts` |
| ✅ 7b | Nó `enricher` (Firecrawl) + rubrica do qualifier reescrita sobre fato | `nodes/enricher.ts`, `lib/workflows/firecrawl.ts`, `prompts.ts` |
| ✅ 8 | Persistência de runs e leads, dedupe na frente, `POST /api/leads/contacted` | `supabase/prospect.sql`, `lib/prospect/repository.ts` |
| ✅ 9 | UI: textarea por lead, link remontado no clique, Copiar, Descartar, marcar contatado | `WorkflowPanel.tsx` |
| ✅ 10 | Exportar CSV (`Blob`, zero dependência, BOM para o Excel) | `WorkflowPanel.tsx` |
| ➕ | Grafo compilado memoizado no `globalThis` (era item T2) | `lib/workflows/graph.ts` |
| ⏭ 4 | **`SEARCH_API_KEY` real, ou anunciar o mock** — não feito; segue em T2 | `.env.local`, `lib/ai/tools.ts` |

**Pendências deixadas de propósito:**
- O item 4 continua aberto: a busca web ainda cai num mock silencioso. Agora com o Apify
  no caminho feliz, ela só importa no fallback — mas é exatamente a classe de falha do
  [ADR-0004](./adr/0004-fallbacks-em-cascata.md) e sobe para T2 junto com o item de
  visibilidade de fallback.
- `supabase/prospect.sql` precisa ser **rodado à mão** no dashboard antes do primeiro run
  com persistência. Sem isso, tudo funciona e nada é gravado (fail-safe por desenho).

### Três detalhes de implementação que custam caro se descobertos tarde

**O copywriter não precisa de campo novo no estado.** `qualifiedLeads` já usa reducer de
substituição. O nó pega `qualifiedLeads.filter(l => l.qualified)`, gera todas as mensagens
numa chamada estruturada (mesmo formato do `qualifier.ts`, que já está debugado 40 linhas
ao lado), mescla `message` e devolve o array inteiro. Sem problema de chaveamento, sem
dessincronização.

**A persistência vai na rota, não num nó.** LangGraph **reexecuta o nó do topo** ao retomar
de um `interrupt()` — então qualquer escrita acima do `interrupt` em `human-review.ts`
roda **duas vezes**. Esta é a armadilha mais desagradável do LangGraph e é exatamente onde
uma implementação desavisada colocaria o insert. A rota já tem `finalState.values` em mãos
no momento em que emite o evento de interrupt: é a fronteira transacional natural.
Reavaliar se o grafo um dia rodar fora do HTTP (cron).

**A dedupe que economiza dinheiro vai na frente, não atrás.** Filtrar já-contatados no
`researcherNode`, logo depois do Apify, poupa tokens de qualifier **e** de copywriter. Só
gravar no fim não evita gasto nenhum.

### E o insight que molda o desenho todo

**O grafo não consegue observar o envio.** O `wa.me` abre o WhatsApp e nada reporta de
volta. Então o workflow só pode afirmar "encontrado" e "qualificado". **"Contatado" é
afirmado pelo clique**, na UI — consequência estrutural do [ADR-0007](./adr/README.md).
Distinguir o que um sistema *fez* do que ele *consegue saber* é o tipo de precisão que o
resto do desenho herda.

---

## T2 — destrava credibilidade (~2–3 dias)

| # | Item | Est. |
|---|---|---|
| 0 | **Zerar os 15 erros de lint existentes** — regras do React Compiler em `use-speech-synthesis.ts`, `kinetic-grid.tsx`, `idle-controller.ts` + 3 `no-explicit-any`. **Vem antes da CI:** subir CI sobre lint quebrado só produz build vermelho permanente, que todo mundo aprende a ignorar | 2h |
| 1 | **`typecheck` + `format` + CI** (lint, typecheck e build no push) | 2h |
| 2 | **Testes do supervisor** + puros (`leadKey`, `normalizePhoneBR`, `buildWhatsAppLink`, `chunkText`) | 3h |
| 3 | **Harness de eval** — copywriter e qualifier. Ver [`EVAL.md`](./EVAL.md) | 4h |
| 4 | **Parsear frontmatter no sync** + backfill SQL ([ADR-0010](./adr/0010-metadado-do-frontmatter.md)) | 3h |
| 5 | **Threshold + teto de chunks por arquivo** em `retrieveContext` | 1h |
| 6 | **`match_documents_scoped`** + `searchSecondBrain(query, dominio?, tipo?)` | 3h |
| 7 | **Eval de recall** (15 casos) — **escrever antes** dos itens 5 e 6, para ter número de antes | 2h |
| 8 | **Visibilidade de fallback** — todo caminho degradado aparece no log e na UI ([ADR-0004](./adr/0004-fallbacks-em-cascata.md)). Inclui o item 4 do T1 que ficou aberto: `SEARCH_API_KEY` real ou mock anunciado | 1h30 |
| ~~9~~ | ~~Memoizar o grafo compilado~~ — **feito no T1** | — |
| 10 | **ADRs restantes** (0005, 0006, 0007 por extenso) + ADR sobre persistência fora do nó + limpeza de código morto | 2h30 |

**O item 1 é o sinal mais barulhento que falta.** Um repositório sem script de `typecheck`
e sem CI é lido como "não sênior" antes de qualquer pessoa abrir um arquivo — que é
exatamente o feedback que o Gabriel recebeu no desligamento. Duas horas.

**O item 2 tem um argumento melhor que cobertura.** `supervisorNode` é função pura de
estado: testar é montar objeto e conferir `nextAgent`, sem mock nem rede. Estas asserções
cobrem os dois bugs mais caros que o T1 consertou — e são a rede que impede o retorno
deles:

```
leads: [], tentativas: 0                          → "researcher"
leads: [], tentativas: 1                          → "__end__"     (o loop caro)
lead com site, siteAnalysis undefined             → "enricher"
lead qualificado sem message                      → "copywriter"  (o nó morto)
zero qualificados                                 → "human_review" (não chama copywriter)
```

**A ordem do 7 antes do 5 e 6 é o ponto.** Não discutir se scoping/threshold/chunking
ajudam. Medir. Escrever os 15 casos primeiro é o que transforma opinião em número.

---

## T3 — depois, com gatilho explícito

| Item | Gatilho |
|---|---|
| Redis + deploy (Railway/Fly) | Quando um run precisar sobreviver a um restart, ou alguém além dele precisar ver rodando. **Não serverless:** SSE longo + Apify síncrono de 120s não cabem no modelo |
| Chunking consciente de markdown | Depois que o eval de recall existir para provar o ganho. É a maior melhoria de RAG disponível, ~2h |
| Tracing (LangSmith/OTel) | Quando depurar um run pelo `console.log` doer |
| Segundo workflow (pauta do canal) | Só depois que a prospecção der dinheiro, e só se passar na [Regra do Turno](./adr/0009-regra-do-turno.md) |
| Índice GIN em `metadata` | ~50k linhas. Hoje são ~300 chunks — o planner ignoraria |
| Agentes por domínio | `tools > 12` ou erro de seleção > 10% no eval ([ADR-0008](./adr/0008-um-cerebro-nao-cinco.md)) |
| Persistência de conversas | Quando perder um histórico incomodar de verdade |
| Visão multimodal | Baixo custo, alto "wow" — mas não gera contrato |

---

## Explicitamente NÃO fazer agora

- **Cinco agentes de domínio.** [ADR-0008](./adr/0008-um-cerebro-nao-cinco.md).
- **Reranking ou busca híbrida.** São ~300 chunks e não há medição — não dá para saber se
  ajudou. Threshold, teto por arquivo e chunking são mais baratos e vêm antes.
- **Índice GIN.** O Postgres ignoraria.
- **API de WhatsApp (Uazapi/Z-API) — ainda não, e o critério importa.** O `wa.me` + clique
  humano é *melhor* enquanto a mensagem não estiver provada: custo zero, risco de ban zero,
  humano no loop por construção. Automatizar o envio antes de ter **um negócio fechado**
  não escala vendas — escala queima de lead, e destrói a propriedade que o
  `COPYWRITER_PROMPT` mais persegue ("parece digitada no celular, não gerada por IA").
  **Gatilho para reavaliar:** primeiro contrato fechado *e* o envio manual virando gargalo
  medido. Automatize a pesquisa e a redação agora; o disparo, depois da prova.
- **Refatorar `app/page.tsx`** (553 linhas). Funciona, é superfície de demo, e não rende nada.
- **Segundo workflow antes de a prospecção pagar.**
- **LangGraph em qualquer lugar do caminho de chat.** `streamOdinResponse` streama; o grafo
  não. É a cláusula de custo do [ADR-0009](./adr/0009-regra-do-turno.md).
- **Voz nativa (Gemini Live).** Salto grande, alto impacto de imersão, zero impacto em caixa.
- **`writeObsidianNote`** antes de decidir a ambiguidade §3.3 do [`ESTADO.md`](./ESTADO.md) —
  ele revoga o [ADR-0002](./adr/0002-vault-fonte-de-verdade.md).
- **Deploy no T1.** É single-user local. Deploy é item de credibilidade, não de caixa.
