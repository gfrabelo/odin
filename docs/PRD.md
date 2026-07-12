# PRD — Odin

> **Documento único e vivo.** Reúne propósito, produto, arquitetura técnica, estado atual,
> roadmap e decisões em aberto do Odin. Feito para ser **carregado como contexto em qualquer
> LLM** — seja para desenvolver o projeto, seja para pedir feedback crítico.
>
> **Autor:** Gabriel Rabelo · **Última atualização:** 2026-07-08
> **Estado do produto:** protótipo pessoal funcional (single-user), em evolução ativa.

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

## 4. Estado Atual — O que já funciona (v0)

| # | Capacidade | Estado |
|---|---|---|
| 1 | **Cockpit imersivo** — robô 3D (Spline) em tela cheia, glass UI, shader de fundo, HUD lateral | ✅ |
| 2 | **Chat em streaming** com Gemini (markdown, stop/abort, histórico em memória) | ✅ |
| 3 | **RAG** sobre o vault Obsidian (pgvector), fail-safe, com citações `[n]` | ✅ |
| 4 | **Sync incremental** `wiki/ → Supabase` (hash por arquivo) + auto-sync via git hook | ✅ |
| 5 | **Voz — entrada (STT):** Web Speech (pt-BR), transcrição ao vivo, auto-envio na pausa | ✅ |
| 6 | **Voz — saída (TTS):** OpenAI (`onyx`, 1.15x), fila por frase | ✅ |
| 7 | **Modo conversa contínua** (hands-free, meia-duplex, sem eco) + barge-in (rede de segurança) | ✅ |
| 8 | **Glow Pulse** — anel neon pulsa no ritmo da voz, passando atrás da cabeça do robô (profundidade 3D) | ✅ |
| 9 | **Function calling** — loop de tools no servidor (4 ferramentas, ver §6) | ✅ |
| 10 | **Fallback de provider** — Gemini primário; OpenAI (`gpt-4o-mini`) assume em erro/rate-limit | ✅ |
| 11 | **Retry/backoff** exponencial p/ erros transitórios do Gemini (429/503) | ✅ |
| 12 | **Chips de follow-up** — após cada resposta, 3 sugestões clicáveis (structured output) | ✅ |

**Limitações conhecidas (v0):**
- Sem persistência: refresh limpa a conversa (só estado React).
- Sem multimodal de **entrada** (não vê imagens/PDF/tela).
- Voz é um "Frankenstein" (STT nativo + TTS OpenAI + meia-duplex), não voz nativa full-duplex.
- Single-user, sem auth, roda local.

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

## 9. Decisões Estratégicas em Aberto (a parte para debater com outras LLMs)

> **Estas são as perguntas em que quero feedback variado.** Não há resposta certa ainda.

1. **Pessoal vs. Produto.** Odin deve continuar um cockpit single-user (otimizado 100% para o
   Gabriel), virar um **produto multi-tenant**, ou um **open-source/template** que outros
   clonam e plugam no próprio vault? Isso muda quase todas as outras decisões (auth, custo,
   privacidade, arquitetura).

2. **Próximo salto: profundidade vs. amplitude.** Investir em **voz nativa (Gemini Live)** —
   tornar a experiência atual excelente — ou em **novas capacidades** (visão, memória,
   integrações) — cobrir mais superfície? Qual entrega mais valor por hora de trabalho?

3. **Quebrar o fluxo unidirecional?** Hoje o Odin só **lê** o cérebro. Deixá-lo **escrever**
   (`writeObsidianNote`, capturar decisões, criar notas) o torna um parceiro ativo — mas
   arrisca a integridade da "única fonte de verdade". Vale? Com quais salvaguardas?

4. **Memória: onde e como.** Persistência simples (threads no Supabase) resolve o básico. Uma
   "memória de longo prazo" de verdade (o Odin aprende preferências, fatos, padrões) é bem mais
   complexa. Qual o nível certo agora?

5. **Diferencial defensável.** Se qualquer um pode montar um "chat + RAG + voz", qual é o fosso
   do Odin? É a **integração profunda com o segundo cérebro do Gabriel** (dado proprietário)?
   A **experiência/imersão**? A **orquestração multi-modelo**? Onde dobrar a aposta?

6. **Custo & sustentabilidade.** Uso pessoal com Gemini/OpenAI/Supabase é barato. Se escalar
   (voz nativa ~contínua, mais usuários), o custo muda de figura. Quando isso vira restrição?

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
