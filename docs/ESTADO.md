# ESTADO — retrato honesto do Odin

> **Data:** 2026-08-11 · **Commit de referência:** `6b7ba86` (feat: pipeline workflow)
>
> Este documento é o retrato do sistema **como ele é**, não como foi planejado.
> Regra de escrita: toda afirmação cita `arquivo:linha`. Nada aqui vem de memória
> ou de outro documento — se não dá pra conferir abrindo o arquivo, não entra.
>
> O `PRD.md` diz o que o Odin quer ser. Este diz o que ele é hoje. Quando os dois
> divergirem, **este aqui está certo** e o PRD é que precisa ser atualizado.

---

## 1. Existe e funciona

Verificado contra o código, não contra o roadmap.

| # | Capacidade | Onde | Nota |
|---|---|---|---|
| 1 | Cockpit imersivo — robô Spline 3D, glass UI, grid canvas reativo | `app/page.tsx`, `components/ui/kinetic-grid.tsx` | Página única; não há rotas além de `/` |
| 2 | Chat em streaming com abort | `lib/ai/chat.ts`, `app/api/chat/route.ts` | Texto puro (`text/plain`), **não** SSE |
| 3 | RAG automático sobre o vault | `lib/ai/chat.ts` → `retrieveContext` | Top-6 injetado em `systemInstruction`, todo turno |
| 4 | Sync incremental por hash | `scripts/sync.ts:110` | Diff por `sha1(body)`; pula inalterados, remove sumidos |
| 5 | Function calling com 4 tools | `lib/ai/tools.ts` | `MAX_TOOL_TURNS=5`; tools removidas no último turno pra forçar texto (`chat.ts`) |
| 6 | Voz — STT nativo + TTS OpenAI, meia-duplex | `lib/voice/`, `app/api/tts/route.ts` | Mic é travado enquanto o Odin fala, pra evitar eco |
| 7 | Glow pulse sincronizado à voz | `app/page.tsx` (rAF sobre `tts.volumeRef`) | Muta `scale.y` e cor do objeto `Visor` do Spline |
| 8 | Comportamentos idle do robô | `lib/ai/idle-controller.ts` | 8 estados, animações com easing e `AbortSignal` |
| 9 | Retry com backoff + fallback de provider | `lib/ai/chat.ts` | 1s→2s→4s; cai pro `gpt-4o-mini` em erro. **O fallback não tem tools** |
| 10 | Chips de follow-up | `lib/ai/suggestions.ts` | Structured output; blindado → `[]` |
| 11 | Workflow de prospecção com HITL | `lib/workflows/`, `app/api/workflow/route.ts` | Grafo hub-and-spoke, `interrupt()` + `Command({resume})`, SSE |
| 12 | Supervisor determinístico | `lib/workflows/nodes/supervisor.ts` | Puro `if/else`, zero LLM. Ver [ADR-0003](./adr/0003-supervisor-deterministico.md) |
| 13 | Fallback em cascata no researcher | `lib/workflows/nodes/researcher.ts` | Apify → Tavily → mock |
| 14 | Guarda de confidencialidade | `lib/vault.ts` (`HARD_EXCLUDE`) | `it-lean-confidencial` bloqueado no sync **e** na leitura, com guard de path-traversal |
| 15 | Widget de surf | `app/api/surf/route.ts`, `components/interface/SurfWidget.tsx` | Peruíbe/SP fixo, `revalidate: 900` |

**O caminho feliz da prospecção, como ele realmente roda hoje:**

```
START → supervisor → researcher (Apify) → supervisor → qualifier (1 chamada batch)
      → supervisor → human_review → interrupt ⏸ → [PUT resume] → supervisor → END
```

O nó `copywriter` **não aparece neste caminho**. Ver §2.

---

## 2. Falta

Ordenado por impacto, não por dificuldade.

| # | Lacuna | Onde | Impacto |
|---|---|---|---|
| 1 | **Copywriter inalcançável** | `nodes/supervisor.ts` (3 branches, nenhum emite `"copywriter"`) + `nodes/copywriter.ts:16-18` | **Bloqueia caixa.** Morto de duas formas independentes: o supervisor nunca roteia pra ele, *e* ele lê `state.leads[state.currentLeadIndex]` e `state.qualification`, campos legados que o pipeline em batch parou de popular. O pipeline entrega tabela com link `wa.me` **sem mensagem** — falta justo a peça que fecha contrato, e o `COPYWRITER_PROMPT` (~78 linhas) é o prompt mais bem trabalhado do repo, parado em código morto |
| 2 | **Zero persistência de leads** | não existe | Refresh apaga tudo. Sem histórico de contatados, ele re-aborda o mesmo negócio — o que queima o lead e a reputação |
| 3 | **`qualified` vem do modelo, não da rubrica** | `nodes/qualifier.ts:109-112` (schema) e `:162` (merge) | O `responseSchema` pede `qualified` como campo booleano e a linha 162 confia nele, enquanto o `QUALIFIER_PROMPT` declara "Lead qualificado: score ≥ 6" em outro lugar. **Nada reconcilia os dois.** O modelo pode devolver `score: 8, qualified: false` e o lead some silenciosamente do filtro em `nodes/human-review.ts`. Correção de uma linha: derivar em código e tirar o campo do schema |
| 4 | **Risco de loop caro no researcher** | `types.ts` (reducer append em `leads`), `nodes/supervisor.ts:43` (`leads.length === 0`), `app/api/workflow/route.ts` (sem `recursionLimit`) | Researcher sem resultado volta ao supervisor, que volta ao researcher. Até o `recursionLimit` default (25) estourar, **pagando uma chamada Apify de 120s por volta**. E não é caso de borda: `SEARCH_API_KEY` não está no `.env.local`, então o fallback Tavily devolve o mock de `example.com` e zero leads é o caminho *provável* |
| 5 | Zero evals | não existe | **O maior sinal de senioridade ausente.** `wiki/conceitos/eval-de-agente.md` existe no vault — o conceito está estudado, não aplicado |
| 6 | Zero testes / CI / `typecheck` | `package.json` (scripts: `dev`, `build`, `start`, `lint`, `sync`) | Nada entre "compila" e "está na main". O `supervisorNode` é função pura de estado: testá-lo é construir objetos e conferir `nextAgent`, sem mock nem rede — e três asserções pegariam as lacunas #1 e #4 |
| 6b | **`npm run lint` falha na `main`** | `lib/voice/use-speech-synthesis.ts`, `components/ui/kinetic-grid.tsx`, `lib/ai/idle-controller.ts`, `lib/workflows/checkpointer.ts` | **15 erros e 4 warnings** — em maioria regras do React Compiler (`Cannot access refs during render`, `Calling setState synchronously within an effect`, `Existing memoization could not be preserved`) mais 3 `no-explicit-any`. Verificado em 2026-08-11. O único portão de qualidade que existe já está vermelho, e como nada o executa automaticamente, ninguém notou. **Consertar isso vem antes de montar CI** — subir CI sobre um lint quebrado só produz build vermelho permanente, que todo mundo aprende a ignorar. `npm run build` passa |
| 7 | Frontmatter descartado no ingest | `lib/vault.ts` (`stripFrontmatter`), usado em `scripts/sync.ts:80` | **O metadado de recuperação mais rico do sistema vai pro lixo.** Todas as 93 notas têm YAML consistente (`type`, `status`, `ultima_atualizacao`, `fontes`, `maturidade`) e nada disso chega ao índice. Ver [ADR-0010](./adr/0010-metadado-do-frontmatter.md) |
| 8 | RAG sem threshold nem teto por arquivo | `lib/rag/retrieve.ts` | Top-6 incondicional: um "e aí, tudo bem?" injeta 6 chunks irrelevantes (~7.200 chars) no `systemInstruction` **a cada turno**, mais uma chamada de embedding e uma query vetorial. E sem teto por `path`, os 6 podem ser 6 chunks da *mesma* nota |
| 9 | Só `MemorySaver` | `lib/workflows/checkpointer.ts` | Restart mata workflow parado esperando revisão. O caminho Redis existe mas o pacote não está no `package.json` |
| 10 | Grafo recompilado a cada request | `lib/workflows/graph.ts` (`createProspectWorkflow()` chamado em todo handler) | Só o checkpointer é memoizado. Correção: mesmo padrão `globalThis` do `checkpointer.ts` |
| 11 | Token Apify na query string | `nodes/researcher.ts` | Vaza em log de proxy, histórico e trace de erro. Mover pro header |
| 12 | Chunking cego a markdown | `scripts/sync.ts:44-55` | Corta a 1200 chars no meio de seção e tabela |
| 13 | Comentário do schema mente sobre o modelo | `supabase/schema.sql:13` | Diz `text-embedding-004`; o código usa `gemini-embedding-001` truncado a 768 (`lib/rag/embeddings.ts`) |
| 14 | Deriva na UI do workflow | `components/interface/WorkflowPanel.tsx:45` | `AGENT_ORDER` renderiza um nó "Redator" que nunca acende. `reject`/`edit` têm código e CSS, sem gatilho na UI |
| 15 | Código morto | `components/ui/web-gl-shader.tsx`, `button.tsx`, `card.tsx`, `copywriter-system.md` (raiz), `@anthropic-ai/sdk` no `package.json` | Sedimento de refactors que nunca removeram o antigo |

### 2.1 O achado mais grave: o README está factualmente errado

O `README.md` é a superfície de portfólio — é o que um recrutador ou CTO lê antes de abrir o código. Antes desta revisão ele declarava como entregue:

| Afirmação | Realidade |
|---|---|
| "gera link `wa.me/{phone}?text={mensagem}` com a mensagem pronta" | `nodes/qualifier.ts:31` devolve `https://wa.me/${digits}` — **sem `?text=`**. Nunca houve mensagem |
| "[x] Link wa.me — botão WhatsApp com mensagem pré-carregada" | Idem |
| "Revisão com botões Aprovar / Rejeitar / Revisar" | Só existe **Concluir** |
| "[x] Copywriter battle-tested" | O nó é inalcançável |
| "[x] Rotação determinística de leads" | Design v1, **substituído** pelo qualifier em batch em `6b7ba86` |

O próprio código já sabia: `nodes/qualifier.ts:25` comenta *"Mensagem padrão curta — a real será gerada pelo Copywriter no futuro"*. A lacuna era conhecida; o README é que não acompanhou.

**Um README que promete mais do que o código entrega é pior que não ter README**, porque quem for conferir encontra a diferença — e a conclusão dele não vai ser "documentação desatualizada", vai ser "esse cara exagera". Corrigido em 2026-08-11.

---

## 3. Ambíguo

Onde o sistema não decidiu — e o que a indecisão está custando.

**1. Copywriter: reviver ou deletar?**
O código diz uma coisa (nó morto, campos legados), o investimento no prompt diz outra. Enquanto for ambíguo, a UI mostra um nó que nunca acende e o pipeline não fecha negócio.
→ Proposta: reviver. É a peça que converte pipeline em contrato. Vira ADR quando implementado.

**2. Pessoal vs. produto vs. template open-source** (`PRD.md` §9.1, aberto desde julho)
Trava auth, custo, multi-tenancy — e trava o argumento de portfólio, porque "protótipo pessoal" e "produto" pedem demos diferentes.

**3. Quebrar o fluxo unidirecional?**
`writeObsidianNote` está no roadmap e conflita direto com o [ADR-0002](./adr/0002-vault-fonte-de-verdade.md). Precisa de decisão explícita, não de deriva — o risco é isso entrar sem ninguém perceber que revoga um princípio.

**4. Falha silenciosa é feature ou bug?**
O [ADR-0004](./adr/0004-fallbacks-em-cascata.md) garante que nada derruba a conversa. O efeito colateral é que **o sistema nunca cai e por isso nunca grita**: foi assim que o `webSearch` ficou em modo mock sem ninguém notar, e é assim que `LLM_PROVIDER=openai` desliga os chips de follow-up em silêncio. Degradar sem avisar vira mentira de UX.
→ Encaminhamento: todo fallback tem que ser visível no log e na UI. Consequência obrigatória do ADR-0004, não feature nova.

**5. Surf é capacidade de produto ou cor de persona?**
Tem tool (`tools.ts`), rota (`api/surf`), dois componentes, e heurística de vento/qualidade **duplicada** entre `api/surf/route.ts` e `tools.ts`. Mas não existe nenhuma nota de surf no vault. Está sobre-construído para o que é.

**6. Onde mora a memória de conversa** (`PRD.md` §9.4)
Hoje: em lugar nenhum. Refresh apaga.

---

## 4. Como usar este documento

- **Antes de planejar qualquer coisa**, leia §2 e §3. Metade das ideias boas já está lá, priorizada.
- **Ao fechar uma ambiguidade de §3**, escreva um ADR em [`adr/`](./adr/) e remova o item daqui.
- **Ao corrigir uma lacuna de §2**, remova a linha. Este documento encolhe quando o projeto melhora — se ele só cresce, é sinal de que o backlog está ganhando.
- **Revalide as citações `arquivo:linha` quando o código mudar.** Documento com citação quebrada perde a única propriedade que o torna confiável.
