# PRD — Odin

> **Documento único e vivo.** Reúne propósito, produto, arquitetura técnica, estado atual,
> roadmap e decisões em aberto do Odin. Feito para ser **carregado como contexto em qualquer
> LLM** — seja para desenvolver o projeto, seja para pedir feedback crítico.
>
> **Autor:** Gabriel Rabelo · **Última atualização:** 2026-08-11
> **Estado do produto:** protótipo pessoal funcional (single-user), em evolução ativa.
>
> **Escopo deste documento:** propósito, usuário, princípios e decisões em aberto.
> Ele **não** é mais a fonte do estado técnico nem das decisões fechadas:
>
> | Pergunta | Documento |
> |---|---|
> | O que existe / falta / está ambíguo, verificado no código | [`ESTADO.md`](./ESTADO.md) |
> | Por que foi decidido assim, e o que foi descartado | [`adr/`](./adr/) |
> | O que vem depois, sequenciado | [`BACKLOG.md`](./BACKLOG.md) |
>
> Se este documento divergir do `ESTADO.md`, **o `ESTADO.md` está certo** — ele descreve
> o código, este descreve a intenção.

---

## 0. TL;DR (para quem tem 30 segundos)

Odin é um **cockpit de IA pessoal** — um "segundo cérebro externo" com cara de Jarvis.
Um robô 3D em tela cheia, chat por texto **e voz** (fala e ouve), que responde ancorado nas
anotações reais do Gabriel (RAG sobre um vault Obsidian) e sabe **agir** via ferramentas
(buscar no segundo cérebro, ler notas, buscar na web, ver a previsão de surf). Roda em
Next.js, usa Gemini como cérebro principal (OpenAI como fallback) e Supabase/pgvector como
memória vetorial. Hoje é de uso pessoal; o objetivo deste doc é decidir **os próximos passos**.

---

## 1. Visão & Propósito

### 1.1 Visão de longo prazo
Um **"Jarvis" pessoal**: uma interface de IA única, ambiente e multimodal (texto → voz → visão
→ ações), que conhece o contexto do Gabriel melhor que qualquer ferramenta genérica e executa
tarefas no mundo real. A trajetória é: **chat → RAG → multimodal (voz/visão) → ações via tools
→ orquestração de múltiplos modelos**.

### 1.2 Problema que resolve
Ferramentas de IA genéricas (ChatGPT, etc.) não conhecem o contexto pessoal do Gabriel: seus
projetos, decisões, metodologias, valores, o "sistema operacional" de vida que ele mantém num
vault Obsidian. Toda conversa começa do zero. O conhecimento fica **preso** em markdown, sem
uma interface viva que o consulte, converse sobre ele e aja a partir dele.

Odin transforma o segundo cérebro estático (arquivos) num **agente conversacional** que:
- responde com a voz e o contexto do Gabriel (não um assistente genérico);
- é acessível por voz, hands-free, como um copiloto ambiente;
- executa ações (buscar, ler, consultar web/serviços) sem sair da conversa.

### 1.3 Por que existe (motivação real)
1. **Uso pessoal:** um copiloto que realmente conhece o Gabriel.
2. **Laboratório de AI engineering:** terreno para dominar RAG, function calling, voz,
   multimodal, orquestração — na prática, com um produto de verdade.
3. **Ativo de conteúdo:** Gabriel é criador (@GabrielRabeloIA); o Odin é matéria-prima de
   conteúdo técnico e uma vitrine de capacidade.

---

## 2. Usuário & Persona

**Usuário primário (hoje, único):** Gabriel Rabelo — Software/AI Engineer e criador de
conteúdo. Mantém um "segundo cérebro" em Obsidian (projetos, wiki, sistema operacional de
decisões, visão de vida até 2031). Surfa em Peruíbe/SP. Fala português.

**Necessidades:**
- Consultar o próprio conhecimento conversando, não caçando arquivos.
- Uma interface que impressione e dê gosto de usar (é também demo e conteúdo).
- Extensibilidade: cada nova capacidade de IA vira um experimento plugável.

**Não-usuários (hoje):** o público geral. Odin **não** é um produto multi-tenant. Ver §9 (a
maior decisão em aberto: continuar pessoal vs. virar produto).

---

## 3. Princípios de Produto & Design

1. **Agnóstico de provider.** Toda a lógica de IA vive atrás de um contrato estável
   (`Message[] → AsyncGenerator<string>`). A rota HTTP e a UI não sabem qual modelo/contexto
   está por trás. Trocar Gemini↔OpenAI↔Claude não toca a interface.
2. **Fail-safe por padrão.** Cada capacidade degrada com elegância: sem Supabase, o RAG
   retorna `[]` e o chat responde normal; sem chave de busca, `webSearch` cai num mock; se as
   sugestões falham, os chips somem. Nada derruba a conversa.
3. **Simplicidade > over-engineering.** Contratos estáveis como pontos de extensão, não
   abstrações prematuras.
4. **Fonte de verdade única e fluxo unidirecional.** O **vault Obsidian (markdown + git)** é a
   única verdade. Dado só flui ladeira abaixo:
   `cérebro → Obsidian → wiki/ → Supabase → Odin`. **Nunca para cima** (o Odin lê, não escreve
   no cérebro — ainda; ver `writeObsidianNote` no roadmap).
5. **Confidencialidade.** Material sensível (`it-lean-confidencial`) **nunca** é indexado
   (hard guard no sync e na leitura de notas).
6. **Imersão importa.** A UI é deliberadamente cinematográfica (robô 3D, glass, shader, glow
   pulse sincronizado à voz). O "encanto" é feature, não enfeite.

---

## 4. Estado Atual

> **Movido.** A tabela de capacidades vive agora em [`ESTADO.md`](./ESTADO.md) §1, com
> citação de `arquivo:linha` para cada linha, e §2 lista o que falta. Foi movido porque
> esta seção ficou desatualizada entre `6b7ba86` e a auditoria de 2026-08-11 — descrevendo
> um pipeline que não existia mais.
>
> Manter estado técnico em dois lugares garante que um dos dois vai mentir. Este documento
> ficou com a intenção; o `ESTADO.md` ficou com o fato.

**Resumo de uma linha:** cockpit de IA pessoal funcional — chat em streaming com RAG sobre
o vault, voz bidirecional, function calling com 4 tools, e um workflow LangGraph de
prospecção B2B com revisão humana.

**Limitações estruturais (as que definem o que o produto é hoje):**
- Single-user, sem auth, roda local.
- Sem persistência de conversa: refresh limpa o histórico.
- Sem multimodal de **entrada** (não vê imagens/PDF/tela).
- Voz é um "Frankenstein" (STT nativo + TTS OpenAI + meia-duplex), não voz nativa full-duplex.
- O workflow de prospecção **não gera a mensagem de abordagem** — o nó Copywriter existe e
  não é roteado. Ver [`ESTADO.md`](./ESTADO.md) §2.1.

---

## 5. Arquitetura Técnica

### 5.1 Stack (versões reais)

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16.2.7 (App Router, Turbopack) |
| UI | React 19.2, TypeScript estrito, Tailwind CSS v4, shadcn/ui |
| 3D / visual | @splinetool/react-spline, WebGL shader custom, Spotlight (aceternity) |
| LLM (chat) | `@google/genai` — **`gemini-3.5-flash`** (default, via `GEMINI_MODEL`); fallback OpenAI `gpt-4o-mini` |
| LLM (structured) | `gemini-3.1-flash-lite` (chips de follow-up, `responseSchema` JSON) |
| Embeddings | `gemini-embedding-001`, `outputDimensionality: 768` |
| RAG / DB | `@supabase/supabase-js` + Postgres `pgvector` (índice HNSW cosine) |
| STT | Web Speech API nativa (`SpeechRecognition`), pt-BR, sem deps |
| TTS | OpenAI `/v1/audio/speech` (`tts-1`, voz `onyx`, `speed` 1.15) |
| Busca web | Tavily API (via tool `webSearch`); sem chave → mock |
| Surf/tempo | Open-Meteo (Marine + Weather), sem chave |
| Scripts | `tsx` + `dotenv` |

> Nota: `@anthropic-ai/sdk` ainda consta nas deps (inativo), mantido para a orquestração
> multi-modelo futura.

### 5.2 Estrutura de pastas (essencial)

```
odin/
├── app/
│   ├── page.tsx                 # Cockpit (client): chat, stream, abort, modo conversa, glow, chips
│   └── api/
│       ├── chat/route.ts        # POST → streamOdinResponse → ReadableStream de texto
│       ├── suggestions/route.ts # POST → chips de follow-up (structured output)
│       ├── tts/route.ts         # POST → áudio (OpenAI TTS)
│       ├── stats/route.ts       # GET → contagem de chunks (HUD)
│       ├── surf/route.ts        # GET → widget de surf
│       └── sync/route.ts        # POST → dispara npm run sync
├── components/interface/        # CommandInput, ResponseStream, VoiceVisualizer, SurfWidget, FollowUpChips
├── lib/
│   ├── ai/
│   │   ├── chat.ts              # streamOdinResponse() — RAG + loop de function calling + retry + fallback [PONTO DE EXTENSÃO]
│   │   ├── tools.ts             # odinFunctionDeclarations + executeTool()
│   │   ├── suggestions.ts       # getFollowUpSuggestions() — structured output, blindado → []
│   │   └── client.ts            # getGemini() lazy singleton
│   ├── prompts/odin.ts          # ODIN_SYSTEM_PROMPT (identidade + uso das tools + tom de surfista)
│   ├── rag/                     # supabase.ts, embeddings.ts, retrieve.ts
│   ├── voice/                   # use-speech-recognition.ts, use-speech-synthesis.ts, strip.ts
│   └── vault.ts                 # readNote() seguro (guard de path-traversal + HARD_EXCLUDE)
├── scripts/sync.ts              # Sync incremental wiki → Supabase
└── supabase/schema.sql          # pgvector + documents + match_documents()
```

### 5.3 Fluxo de dados (ciclo de uma mensagem)

```
CommandInput.onSubmit
 → page.tsx handleSend: monta history (Message[]), POST /api/chat (AbortController.signal)
   → route.ts: streamOdinResponse(messages) → ReadableStream<Uint8Array> (text/plain)
     → chat.ts:
        1. pega a última msg do user
        2. retrieveContext(query)         ← RAG automático (embed → match_documents) [fail-safe → []]
        3. buildSystemInstruction(chunks)  ← injeta contexto no system prompt
        4. LOOP de function calling (até MAX_TOOL_TURNS=5):
             stream do Gemini → yields chunk.text + acumula functionCalls
             se há functionCalls: executeTool() no Node → functionResponse → repete
             senão: resposta final → fim
        (em erro/rate-limit → fallback transparente para OpenAI)
   → page lê o ReadableStream, acumula em `streaming`, ao fim faz commit em `messages`
   → (se TTS ligado) fatia por frase → tts.speak() → fila FIFO → áudio + glow pulse
 → ao terminar: POST /api/suggestions (fire-and-forget) → 3 chips de follow-up
```

**Detalhes:** streaming é texto puro (sem SSE). Stop/barge-in via `AbortController`
(preserva texto parcial). Retry com backoff 1s→2s→4s (3 tentativas). Histórico só em memória.

### 5.4 Variáveis de ambiente

| Var | Uso |
|---|---|
| `GEMINI_API_KEY` | Chat + embeddings. **Obrigatória.** |
| `GEMINI_MODEL` (opcional) | Modelo do chat (default `gemini-3.5-flash`; alt.: `gemini-2.5-pro`, `gemini-3.1-pro-preview`). |
| `LLM_PROVIDER` (opcional) | `gemini` (default) ou `openai`. |
| `OPENAI_API_KEY` | TTS (voz) + fallback do chat. |
| `OPENAI_TTS_VOICE` / `OPENAI_TTS_SPEED` (opcional) | Voz (`onyx`) e velocidade (`1.15`). |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | RAG (server-side). |
| `VAULT_PATH` / `INGEST_DIRS` (opcional) | Caminho do vault (`../segundo-cerebro`) e pastas indexadas (`wiki`). |
| `SEARCH_API_KEY` (opcional) | Liga a busca web real (Tavily). Sem ela → mock. |

---

## 6. Ferramentas (Function Calling)

O Odin decide sozinho quando chamar cada uma. `executeTool` é blindado (nunca lança; erro
vira `{ error }` para o modelo se recuperar). Loop unificado no servidor (`chat.ts`).

| Tool | O que faz |
|---|---|
| `searchSecondBrain(query)` | Busca semântica no vault (reusa o RAG). Híbrido com a injeção automática. |
| `readObsidianNote(path)` | Lê uma nota inteira (guard de path-traversal + exclusão de confidencial). |
| `webSearch(query)` | Busca web real via **Tavily** (`answer` + resultados); sem chave → mock. |
| `getSurfForecast(lat?, lon?)` | Condições de surf/tempo (Open-Meteo), default Peruíbe/SP; agora + ~12h. |

> **Por que `webSearch` é custom e não o `googleSearch` nativo:** o Gemini não permite misturar
> o tool nativo de busca com `functionDeclarations` na mesma chamada. Função custom mantém tudo
> no mesmo loop.

---

## 7. Métricas de Sucesso (propostas)

Como é um projeto pessoal, "sucesso" é qualitativo — mas vale ancorar:

- **Uso real:** o Gabriel abre o Odin em vez do ChatGPT para consultas sobre o próprio contexto.
- **Fidelidade do RAG:** respostas citam a nota certa; poucas alucinações sobre fatos pessoais.
- **Fluidez da voz:** conversa hands-free sem fricção (latência aceitável, sem eco, barge-in ok).
- **Velocidade de experimentação:** cada nova capacidade de IA entra sem quebrar o contrato/UI.
- **(Se virar conteúdo)** engajamento dos vídeos/demos derivados do Odin.

---

## 8. Roadmap / Próximos Passos

Candidatos discutidos, agrupados. Todos se plugam no contrato existente sem quebrar a UI.

### 8.1 Cérebro / Modelo
- ✅ **Upgrade para Gemini 3.5 Flash** + structured output (feito).
- **Modo profundo:** rotear pedidos difíceis para `gemini-2.5-pro`/`gemini-3.1-pro-preview`.
- **Prompt caching** do system prompt (latência/custo).

### 8.2 Voz nativa (o maior salto para um cockpit voice-first)
- **Gemini Live API:** voz full-duplex nativa (áudio→áudio, WebSocket). Substituiria o stack
  atual (STT nativo + TTS OpenAI + meia-duplex) e resolveria **barge-in e eco nativamente**.
  Alto impacto, maior complexidade.

### 8.3 Multimodal de entrada
- **Visão:** colar/soltar imagem, screenshot, PDF → `parts` multimodais pro Gemini (já é
  multimodal). Baixo custo, alto "wow".

### 8.4 Memória & Persistência (inspirado no que faz agentes "vivos")
- Persistir conversas (localStorage → Supabase threads) + sidebar de histórico.
- **Memória de longo prazo:** o Odin lembra do usuário entre sessões.
- `writeObsidianNote`: primeira escrita de volta ao vault (quebra o fluxo unidirecional de
  propósito — decisão sensível, ver §9).

### 8.5 Ações & Alcance
- Novas tools: agenda/calendário, tarefas, automações.
- **Multi-plataforma:** falar com o Odin por Telegram/WhatsApp (não só no cockpit).

### 8.6 Orquestração multi-modelo
- Roteador em `chat.ts` que escolhe Gemini/Claude/GPT por intenção; contrato e UI intactos.

---

## 9. Decisões Estratégicas em Aberto

> **Estas são as perguntas em que quero feedback variado.** Não há resposta certa ainda.

### Fechadas desde a última versão

Duas perguntas que estavam aqui foram respondidas em 2026-08-11 e viraram ADR:

- **"Um cérebro ou um agente por domínio?"** → [ADR-0008](./adr/0008-um-cerebro-nao-cinco.md).
  Um cérebro. "Domínio" é metadado de recuperação, não fronteira de agente — a proposta
  confundia três eixos independentes e resolvia com arquitetura um problema de filtro.
- **"Quais problemas merecem um workflow LangGraph?"** → [ADR-0009](./adr/0009-regra-do-turno.md).
  A Regra do Turno. Aplicada aos domínios propostos, **1 de 6** justifica um grafo — e ele
  já existe.

### Ainda em aberto

1. **Pessoal vs. Produto.** Odin deve continuar um cockpit single-user (otimizado 100% para o
   Gabriel), virar um **produto multi-tenant**, ou um **open-source/template** que outros
   clonam e plugam no próprio vault? Isso muda quase todas as outras decisões (auth, custo,
   privacidade, arquitetura). *Aberta desde julho; trava o argumento de portfólio, porque
   "protótipo pessoal" e "produto" pedem demos diferentes.*

2. **Próximo salto: profundidade vs. amplitude.** Investir em **voz nativa (Gemini Live)** —
   tornar a experiência atual excelente — ou em **novas capacidades** (visão, memória,
   integrações)? *Nota de 2026-08-11: enquanto caixa for a restrição ativa, nenhuma das
   duas ganha do T1 do [`BACKLOG.md`](./BACKLOG.md) — ambas são impacto de imersão, não de
   receita.*

3. **Quebrar o fluxo unidirecional?** Hoje o Odin só **lê** o cérebro. Deixá-lo **escrever**
   (`writeObsidianNote`) o torna um parceiro ativo — mas **revoga o
   [ADR-0002](./adr/0002-vault-fonte-de-verdade.md)**, não o estende. Se for aceito, precisa
   de um ADR que substitua aquele; a alternativa mais defensável já registrada lá é uma área
   de staging (`inbox/`) com ritual de revisão.

4. **Memória: onde e como.** Persistência simples (threads no Supabase) resolve o básico. Uma
   "memória de longo prazo" de verdade é bem mais complexa. Qual o nível certo agora?

5. **Diferencial defensável.** Se qualquer um pode montar um "chat + RAG + voz", qual é o fosso
   do Odin? É a **integração profunda com o segundo cérebro** (dado proprietário)? A
   **experiência/imersão**? A **orquestração**? Onde dobrar a aposta?

6. **Custo & sustentabilidade.** Uso pessoal é barato. Se escalar (voz contínua, mais
   usuários), o custo muda de figura. Quando isso vira restrição?

7. **Degradação silenciosa é feature ou bug?** *(nova)* O [ADR-0004](./adr/0004-fallbacks-em-cascata.md)
   garante que nada derruba a conversa — e o efeito colateral é que o sistema nunca avisa
   que está respondendo pior. A busca web ficou em modo mock por semanas sem ninguém notar.
   Avisar sempre? Ou recusar, em vez de fingir, quando a capacidade é factual?

---

## 10. Não-Objetivos (fora de escopo — hoje)

- **Não** é um produto multi-tenant com auth/billing (decisão em aberto — §9.1).
- **Não** substitui o Obsidian; é uma interface sobre ele.
- **Não** escreve no cérebro (ainda).
- **Não** busca paridade de features com ChatGPT/assistentes genéricos — o valor é o
  **contexto pessoal + imersão + extensibilidade**, não amplitude genérica.

---

## 11. Como dar feedback sobre este PRD (instruções para a LLM leitora)

Se você é uma LLM lendo este doc para dar feedback, o Gabriel busca crítica **honesta e
específica**, não elogio. Por favor:

1. Comece pela **§9 (Decisões em Aberto)** — é onde o feedback vale mais. Escolha uma posição
   e defenda com trade-offs concretos, não "depende".
2. Aponte **riscos e pontos cegos** que o PRD não menciona (técnicos, de produto ou de foco).
3. Se você fosse o Gabriel com ~1 semana de tempo ocioso, **o que construiria a seguir e por
   quê?** Seja concreto (uma feature, um escopo, um critério de pronto).
4. Desafie as premissas: o "Jarvis pessoal" é a visão certa? O fluxo unidirecional é dogma útil
   ou limitação? A imersão 3D é diferencial ou distração?
5. Formato: direto, em tópicos, priorizado (o que importa mais primeiro). Português.
```
