# ESTADO — retrato honesto do Odin

> **Data:** 2026-09-01 · **Commit de referência:** T1 do [`BACKLOG.md`](./BACKLOG.md) implementado,
> mais a limpeza para abertura do repositório (guard de confidencialidade via env, guard da
> rota de sync, seção de segurança no `README.md`)
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
| 12 | Supervisor determinístico | `lib/workflows/nodes/supervisor.ts` | Puro `if/else`, zero LLM, 7 branches todos derivados do estado. Ver [ADR-0003](./adr/0003-supervisor-deterministico.md) |
| 13 | Fallback em cascata no researcher | `lib/workflows/nodes/researcher.ts` | Apify → Tavily → mock |
| 14 | **Enriquecimento de site (Firecrawl)** | `lib/workflows/nodes/enricher.ts`, `lib/workflows/firecrawl.ts` | Scrapes paralelos; markdown truncado em 2000 chars. Nó separado por granularidade de checkpoint. Ver [ADR-0011](./adr/0011-apify-descoberta-firecrawl-enriquecimento.md) |
| 15 | **Copywriter em batch, com mensagem no link** | `lib/workflows/nodes/copywriter.ts` | Uma chamada estruturada para N leads; `?text=` preenchido. Correlação por `index`, não por ordem |
| 16 | **Persistência de leads e runs** | `supabase/prospect.sql`, `lib/prospect/repository.ts` | `lead_key` único; upsert nunca sobrescreve `contact_status` |
| 17 | **Dedupe de já-contatados** | `lib/workflows/nodes/researcher.ts` | Filtra na frente do pipeline, poupando tokens de qualifier e copywriter |
| 18 | Guarda de confidencialidade | `lib/vault.ts` (`getHardExclude`) | Bloqueia no sync **e** na leitura, com guard de path-traversal. Default `confidencial` + `VAULT_EXCLUDE` do env; falha **fechado** (env vazio cai no default, nunca em lista vazia) |
| 19 | Widget de surf | `app/api/surf/route.ts`, `components/interface/SurfWidget.tsx` | Peruíbe/SP fixo, `revalidate: 900` |
| 20 | Guard da rota de sync | `app/api/sync/route.ts` (`isAuthorized`) | Única rota que spawna processo. Liberada em dev; em produção exige `SYNC_TOKEN` e **recusa se o token não existir** |

**O caminho feliz da prospecção, como ele roda hoje:**

```
START → supervisor → researcher (Apify: QUEM existe, - já contatados)
      → supervisor → enricher   (Firecrawl: COMO é o site)
      → supervisor → qualifier  (1 chamada batch, rubrica sobre fato)
      → supervisor → copywriter (1 chamada batch, mensagem por lead)
      → supervisor → human_review → interrupt ⏸ → [PUT resume] → supervisor → END
```

**Os seis nós executam.** O `copywriter`, que era código morto, é roteado pelo branch 6
do supervisor — derivado de `qualifiedLeads.some(l => l.qualified && !l.message)`.

---

## 2. Falta

Ordenado por impacto, não por dificuldade.

| # | Lacuna | Onde | Impacto |
|---|---|---|---|
| 1 | Zero evals | não existe | **O maior sinal de senioridade ausente.** `wiki/conceitos/eval-de-agente.md` existe no vault — o conceito está estudado, não aplicado. Agora que o copywriter gera mensagem de verdade, há o que medir: ver [`EVAL.md`](./EVAL.md) |
| 2 | Zero testes / CI / `typecheck` | `package.json` (scripts: `dev`, `build`, `start`, `lint`, `sync`) | Nada entre "compila" e "está na main". `supervisorNode`, `leadKey` e `buildWhatsAppLink` são funções puras: testá-las é construir objetos e conferir a saída, sem mock nem rede |
| 3 | **`npm run lint` falha na `main`** | `app/page.tsx`, `components/interface/ThoughtBubble.tsx`, `components/ui/kinetic-grid.tsx`, `components/ui/web-gl-shader.tsx`, `lib/ai/idle-controller.ts`, `lib/voice/use-speech-recognition.ts`, `lib/voice/use-speech-synthesis.ts`, `lib/workflows/checkpointer.ts` | **15 erros e 4 warnings** — em maioria regras do React Compiler (`Cannot access refs during render`, `Calling setState synchronously within an effect`, `Existing memoization could not be preserved`) mais 3 `no-explicit-any`. O único portão de qualidade que existe já está vermelho, e como nada o executa automaticamente, ninguém notou. **Consertar isso vem antes de montar CI** — subir CI sobre um lint quebrado só produz build vermelho permanente, que todo mundo aprende a ignorar. `npm run build` passa |
| 4 | Frontmatter descartado no ingest | `lib/vault.ts` (`stripFrontmatter`), usado em `scripts/sync.ts:80` | **O metadado de recuperação mais rico do sistema vai pro lixo.** Todas as 93 notas têm YAML consistente (`type`, `status`, `ultima_atualizacao`, `fontes`, `maturidade`) e nada disso chega ao índice. Ver [ADR-0010](./adr/0010-metadado-do-frontmatter.md) |
| 5 | RAG sem threshold nem teto por arquivo | `lib/rag/retrieve.ts` | Top-6 incondicional: um "e aí, tudo bem?" injeta 6 chunks irrelevantes (~7.200 chars) no `systemInstruction` **a cada turno**, mais uma chamada de embedding e uma query vetorial. E sem teto por `path`, os 6 podem ser 6 chunks da *mesma* nota |
| 6 | Só `MemorySaver` | `lib/workflows/checkpointer.ts` | Restart mata workflow parado esperando revisão. O caminho Redis existe mas o pacote não está no `package.json` |
| 7 | Chunking cego a markdown | `scripts/sync.ts:44-55` | Corta a 1200 chars no meio de seção e tabela |
| 8 | Comentário do schema mente sobre o modelo | `supabase/schema.sql:13` | Diz `text-embedding-004`; o código usa `gemini-embedding-001` truncado a 768 (`lib/rag/embeddings.ts`) |
| 9 | Código morto | `components/ui/web-gl-shader.tsx`, `button.tsx`, `card.tsx` | Sedimento de refactors que nunca removeram o antigo. Na limpeza de 2026-09-01 saíram o `@anthropic-ai/sdk` (zero imports) e o `copywriter-system.md` da raiz — duplicata desatualizada do prompt vivo em `lib/workflows/prompts.ts:84` |
| 10 | Sem guarda de idempotência na persistência | `app/api/workflow/route.ts` (`persistState`) | A gravação vive na rota justamente para evitar a reexecução do nó no resume. Se um dia o grafo rodar fora do HTTP (cron), isso migra para um nó e **precisa** de guarda — o upsert por `lead_key` cobre, mas o run não |

**Resolvido no T1** (2026-08-11), mantido aqui como histórico do que foi consertado:
copywriter inalcançável · zero persistência · `qualified` vindo do modelo · 20% da rubrica
alucinada · loop caro do researcher · grafo recompilado a cada request · token Apify na
query string · deriva da UI (nó que nunca acendia, `reject` sem gatilho).

### 2.1 A lição que gerou a regra deste documento

Em 2026-08-11 uma auditoria encontrou o `README.md` afirmando **cinco features que o
código não tinha** — entre elas "link WhatsApp com mensagem pré-carregada" (o `?text=`
nunca existiu) e "[x] Copywriter battle-tested" (o nó era inalcançável). Nenhuma era
mentira deliberada: o código andou em `6b7ba86` e a documentação não.

O próprio código já sabia. `nodes/qualifier.ts` comentava *"a real será gerada pelo
Copywriter no futuro"*. A lacuna era conhecida; o README é que não acompanhou.

**Documentação que promete mais do que o código entrega é pior que documentação
nenhuma**, porque quem conferir não conclui "está desatualizado" — conclui "esse cara
exagera". Num projeto que também é portfólio, é o pior resultado possível.

Daí a regra deste arquivo: **só afirma o que dá para conferir abrindo o `arquivo:linha`
citado.** As cinco afirmações foram corrigidas no mesmo dia, e o T1 (2026-08-11) tornou
verdadeiras as que descreviam a intenção certa — o `?text=` e o Copywriter agora existem.

---

## 3. Ambíguo

Onde o sistema não decidiu — e o que a indecisão está custando.

**1. Pessoal vs. produto vs. template open-source** (`PRD.md` §9.1, aberto desde julho)
Trava auth, custo, multi-tenancy — e trava o argumento de portfólio, porque "protótipo pessoal" e "produto" pedem demos diferentes.

**2. Quebrar o fluxo unidirecional?**
`writeObsidianNote` está no roadmap e conflita direto com o [ADR-0002](./adr/0002-vault-fonte-de-verdade.md). Precisa de decisão explícita, não de deriva — o risco é isso entrar sem ninguém perceber que revoga um princípio.

**3. Falha silenciosa é feature ou bug?**
O [ADR-0004](./adr/0004-fallbacks-em-cascata.md) garante que nada derruba a conversa. O efeito colateral é que **o sistema nunca cai e por isso nunca grita**: foi assim que o `webSearch` ficou em modo mock sem ninguém notar, e é assim que `LLM_PROVIDER=openai` desliga os chips de follow-up em silêncio. Degradar sem avisar vira mentira de UX.
→ Encaminhamento: todo fallback tem que ser visível no log e na UI. Consequência obrigatória do ADR-0004, não feature nova.

**4. Surf é capacidade de produto ou cor de persona?**
Tem tool (`tools.ts`), rota (`api/surf`), dois componentes, e heurística de vento/qualidade **duplicada** entre `api/surf/route.ts` e `tools.ts`. Mas não existe nenhuma nota de surf no vault. Está sobre-construído para o que é.

**5. Onde mora a memória de conversa** (`PRD.md` §9.4)
Hoje: em lugar nenhum. Refresh apaga.

---

## 4. Como usar este documento

- **Antes de planejar qualquer coisa**, leia §2 e §3. Metade das ideias boas já está lá, priorizada.
- **Ao fechar uma ambiguidade de §3**, escreva um ADR em [`adr/`](./adr/) e remova o item daqui.
- **Ao corrigir uma lacuna de §2**, remova a linha. Este documento encolhe quando o projeto melhora — se ele só cresce, é sinal de que o backlog está ganhando.
- **Revalide as citações `arquivo:linha` quando o código mudar.** Documento com citação quebrada perde a única propriedade que o torna confiável.
