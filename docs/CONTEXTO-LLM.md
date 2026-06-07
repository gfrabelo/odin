# CONTEXTO-LLM - Odin (fonte de verdade técnica)

> **Documento vivo.** Carregue este arquivo como contexto ao trabalhar no Odin com qualquer LLM.
> Mantém o estado real do projeto: arquitetura, decisões, o que existe e o que vem.
> Última atualização: **Function Calling (4 tools) + Glow Pulse + Modo Conversa Contínua + TTS OpenAI + retry**.

---

## 1. Identidade

**Odin** é o assistente de IA pessoal de Gabriel Rabelo - um "knowledge orchestrator" / segundo cérebro externo. Visão de longo prazo: um "Jarvis" pessoal (chat → RAG → multimodal voz/visão → ações via tools).

- **Localização:** `C:\Users\Gabriel Oliveira\Projects\odin` (repo git próprio; diretório irmão do vault Obsidian `segundo-cerebro`).
- **Fonte de conhecimento (RAG):** o vault Obsidian em `../segundo-cerebro` (apenas `wiki/` por padrão).

## 2. Filosofia / princípios de design

- **Agnóstico de provider:** toda a lógica de IA fica em `lib/ai/chat.ts` atrás de um contrato estável (`Message[] → AsyncGenerator<string>`). Rota e UI não conhecem o provider.
- **Fail-safe:** o RAG é best-effort. Sem Supabase configurado ou em erro, `retrieveContext` retorna `[]` e o chat responde normalmente.
- **Lazy clients:** clients (Gemini, Supabase) são construídos na primeira chamada (lê env em runtime, não no build).
- **Simplicidade > over-engineering.** Contratos estáveis como pontos de extensão, não abstrações prematuras.
- **Confidencialidade:** material `it-lean-confidencial` NUNCA é ingerido (hard guard em `scripts/sync.ts`).
- **Fonte de verdade:** o **vault Obsidian (markdown + git)** é a única fonte de verdade. `wiki/` é projeção do pensamento; Supabase é projeção descartável de `wiki/` (reconstruível via `npm run sync`). Dado flui só ladeira abaixo: cérebro → Obsidian → wiki → Supabase → Odin. Nunca pra cima.

## 3. Stack (versões reais)

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16.2.7 (App Router, Turbopack) |
| UI | React 19.2.4, TypeScript, Tailwind CSS v4, shadcn/ui |
| Ícones / 3D | lucide-react, @splinetool/react-spline (+ runtime), WebGLShader custom |
| Markdown | react-markdown + remark-gfm |
| IA (chat) | `@google/genai` - modelo `gemini-2.5-flash` |
| IA (embeddings) | `gemini-embedding-001` com `outputDimensionality: 768` (default do modelo é 3072) |
| RAG / DB | `@supabase/supabase-js` + Postgres `pgvector` |
| Tools (function calling) | `webSearch` (mock→API), `readObsidianNote`, `searchSecondBrain`, `getSurfForecast` (Open-Meteo) |
| Scripts | `tsx` + `dotenv` |
| STT (escuta) | Web Speech API nativa (`SpeechRecognition`), pt-BR. Sem deps. Modo click-to-talk **ou** conversa contínua. |
| TTS (voz) | **OpenAI** `/v1/audio/speech` (`tts-1`, voz `onyx`, `speed` 1.15) via rota `/api/tts`. Fila FIFO por frase + AnalyserNode p/ glow pulse. |
| Fonte | Inter (sans) + Geist Mono (terminal) |

> Nota: `@anthropic-ai/sdk` ainda consta nas deps (uso original com Claude). Hoje inativo; mantido pensando na orquestração multi-modelo futura.

## 4. Estrutura de pastas

```
odin/
├── app/
│   ├── page.tsx               # Cockpit (client): chat, stream, AbortController, modo conversa, glow pulse
│   ├── layout.tsx             # Root: fontes (Inter/Geist Mono), dark, metadata
│   ├── globals.css            # Tailwind v4 @theme, tokens glass/accent, scrollbar, .odin-md
│   └── api/
│       ├── chat/route.ts       # POST: consome streamOdinResponse → ReadableStream de texto
│       ├── tts/route.ts        # POST: texto → áudio (OpenAI TTS, voz onyx, speed configurável)
│       ├── stats/route.ts      # GET: contagem de chunks vetoriais (HUD direito)
│       └── sync/route.ts       # POST: dispara `npm run sync` (botão "Sincronizar Vault")
├── components/
│   ├── interface/
│   │   ├── OdinBackground.tsx  # Background fixo: WebGLShader + Spotlight + scrims (pointer-events-none)
│   │   ├── CommandInput.tsx    # Input terminal/glass; envia↔parar; STT; modo conversa + barge-in
│   │   ├── ResponseStream.tsx  # Conversa: scroll bottom-anchored + markdown nas respostas
│   │   └── VoiceVisualizer.tsx # Glow pulse: anel `back` (atrás da cabeça) + halo `front`, via CSS var --p
│   └── ui/
│       ├── splite.tsx          # SplineScene (lazy + Suspense) - expõe onLoad(app)
│       ├── spotlight.tsx       # Spotlight (aceternity, SVG)
│       ├── web-gl-shader.tsx   # Shader de fundo (adicionado pelo usuário)
│       └── card.tsx            # shadcn
├── lib/
│   ├── ai/
│   │   ├── client.ts           # getGemini() - singleton lazy (GEMINI_API_KEY)
│   │   ├── chat.ts             # streamOdinResponse() - RAG + Gemini + LOOP de function calling + retry [PONTO DE EXTENSÃO]
│   │   └── tools.ts            # odinFunctionDeclarations + executeTool() (webSearch, readObsidianNote, searchSecondBrain, getSurfForecast)
│   ├── prompts/odin.ts         # ODIN_SYSTEM_PROMPT (identidade + uso das tools + tom de surfista)
│   ├── rag/
│   │   ├── supabase.ts         # getSupabase()/isSupabaseConfigured() - lazy, service role
│   │   ├── embeddings.ts       # embedQuery()/embedDocuments() - gemini-embedding-001
│   │   └── retrieve.ts         # retrieveContext() - embed query → match_documents (fail-safe)
│   ├── voice/
│   │   ├── use-speech-recognition.ts # STT (Web Speech); opção `continuous` (auto-restart) + onSpeechStart
│   │   ├── use-speech-synthesis.ts   # TTS (OpenAI) fila FIFO + AudioContext/AnalyserNode → volumeRef (0..1)
│   │   └── strip.ts            # stripMarkdownForSpeech()
│   ├── vault.ts                # getVaultPath()/stripFrontmatter()/readNote() - acesso seguro ao vault (path-traversal guard)
│   └── utils.ts                # cn()
├── scripts/sync.ts             # Sync incremental wiki → Supabase (npm run sync) - usa lib/vault.ts
├── supabase/schema.sql         # pgvector + tabela documents + função match_documents
├── types/{index,speech}.d.ts   # Message/Role/ChatRequest; tipos da Web Speech API
└── .env.local.example          # GEMINI_API_KEY, OPENAI_API_KEY, SUPABASE_*, [VAULT_PATH, INGEST_DIRS, SEARCH_API_KEY, OPENAI_TTS_*]
```

## 5. Fluxo de dados (ciclo de uma mensagem)

```
CommandInput.onSubmit
  → page.tsx handleSend: monta history (Message[]), POST /api/chat com AbortController.signal
    → route.ts: streamOdinResponse(messages) → ReadableStream<Uint8Array> (text/plain)
      → chat.ts streamOdinResponse:
          1. pega a última msg do user
          2. retrieveContext(query)  ← RAG automático (embed → match_documents) [fail-safe → []]
          3. buildSystemInstruction(chunks)  ← injeta contexto no system
          4. LOOP de function calling (até MAX_TOOL_TURNS=5):
               createStreamWithRetry(...)  → yields chunk.text + acumula chunk.functionCalls
               se há functionCalls: executeTool() no Node → devolve functionResponse → repete o loop
               senão: era a resposta final → fim
    → route enfileira cada chunk de texto
  → page lê response.body.getReader(), acumula em `streaming`, ao fim faz commit em `messages`
  → ResponseStream renderiza (markdown nas respostas do Odin), auto-scroll
  → (se TTS ligado) page fatia o stream por frase → tts.speak() → fila FIFO → áudio + glow pulse
```

Detalhes:
- **Streaming:** texto puro (sem SSE). Mais simples; client só lê o ReadableStream.
- **Stop / Barge-in:** `AbortController` no fetch. Em `AbortError`, preserva o texto parcial. O barge-in (modo conversa) chama `tts.cancel()` + `abort()`.
- **Retry:** `createStreamWithRetry` (em `chat.ts`) repete erros transitórios do Gemini (429/503/500, overloaded) com backoff exponencial 1s→2s→4s (teto 6s, 3 tentativas); se esgota, lança mensagem amigável de rate limit.
- **Histórico:** estado React em `page.tsx` (sem persistência ainda; refresh limpa).

## 6. RAG - detalhes

- **Embeddings:** `gemini-embedding-001` com `outputDimensionality: 768` (o default do modelo é 3072; truncamos pra 768 e bate com `vector(768)`; cosine é invariante a escala, sem normalização extra). `taskType: RETRIEVAL_QUERY` (busca) vs `RETRIEVAL_DOCUMENT` (ingestão). Embedagem sequencial (1 por chamada) por robustez.
- **Schema (`supabase/schema.sql`):** tabela `documents(id, content, metadata jsonb, embedding vector(768), created_at)`; índice HNSW cosine; função `match_documents(query_embedding, match_count, filter)` retornando `similarity = 1 - (embedding <=> query)`.
- **Sync (`scripts/sync.ts`, `npm run sync`):** INCREMENTAL. Varre `VAULT_PATH` (default `../segundo-cerebro`), pastas `INGEST_DIRS` (default `wiki`), exclui `HARD_EXCLUDE=["it-lean-confidencial"]`. Chunk ~1200 chars / overlap 150. Hash SHA-1 do conteúdo por arquivo em `metadata.hash`: re-embeda só arquivos com hash diferente, remove os que sumiram do wiki, pula inalterados. Metadata: `{path, title, chunk, hash}`.
- **Auto-sync:** git hook `post-commit` no vault (`segundo-cerebro/.git/hooks/post-commit`) - quando um commit mexe em `wiki/`, roda `npm run sync` no Odin automaticamente.
- **Estado:** ✅ RAG VALIDADO E ATIVO. 62 chunks no Supabase. Retrieval testado ("visão 2031" → `visao-2031` sim. 0.786). Chat UI cita fontes `[n]`. Incremental + hook validados.

## 6b. Function Calling (tools / ações)

- **Loop no servidor (`chat.ts`):** o `config.tools` declara `odinFunctionDeclarations`. A cada turno o stream é consumido; se vierem `functionCall`, o servidor executa via `executeTool()`, devolve `functionResponse` (role `"user"`, `createPartFromFunctionResponse`) e repete (teto `MAX_TOOL_TURNS=5`). Contrato `Message[] → AsyncGenerator<string>` **inalterado** - rota/UI não sabem que houve ação.
- **Tools (`lib/ai/tools.ts`):** `executeTool` é blindado (nunca lança; erro vira `{ error }`).
  - `searchSecondBrain(query)` - reusa `retrieveContext()` (RAG **híbrido**: injeção automática + busca dirigida).
  - `readObsidianNote(path)` - lê nota inteira via `lib/vault.ts` (guard de path-traversal + `HARD_EXCLUDE`).
  - `webSearch(query)` - busca web real via **Tavily** (`SEARCH_API_KEY`); sem a chave, cai num mock. Retorna `answer` (resumo) + results (title/url/snippet).
  - `getSurfForecast(latitude?, longitude?)` - Open-Meteo Marine + Weather (sem chave), default Peruíbe/SP (`-24.32 / -46.99`); retorna condições agora + amostra das próximas ~12h. Tom de surfista vem do system prompt.
- **Por que `webSearch` não é o tool nativo do Gemini:** o Gemini API não permite misturar o `googleSearch` nativo com `functionDeclarations` na mesma chamada. Função custom mantém o loop unificado.

## 6c. Voz & Glow Pulse

- **STT (`use-speech-recognition.ts`):** Web Speech, pt-BR, `interimResults`. Opção `continuous` → reabre o mic no `onend` (loop hands-free) com flag `wantStop` p/ desligar limpo; `onSpeechStart` p/ barge-in.
- **TTS (`use-speech-synthesis.ts`):** OpenAI `/api/tts`, fila FIFO por frase (`new Audio()`). Cada áudio passa por `AudioContext`+`AnalyserNode`; um rAF calcula amplitude média (0..1, suavizada) em `volumeRef` - **sem setState por frame**. `initAudio()` é chamado num gesto do usuário (autoplay policy).
- **Glow Pulse (`VoiceVisualizer.tsx`):** lê `volumeRef` num rAF próprio e escreve a CSS var `--p`; animação 100% CSS. Camada `back` (anel atrás da cabeça, renderizada antes do canvas Spline → oclusão = profundidade) + `front` (halo difuso). Opacidade ∝ volume → só aparece quando o Odin fala.
- **Spline best-effort (`page.tsx`):** `onLoad` captura o `splineApp`; um rAF tenta animar `scale.y`/cor do objeto `SPLINE_FACE_OBJECT` ("Visor"); se não existir, no-op silencioso (o overlay cobre).
- **Modo Conversa Contínua (botão headset):** liga TTS + escuta hands-free **meia-duplex** - o mic **desliga enquanto o Odin fala** e religa (com debounce de 350ms) quando ele cala. Evita eco no alto-falante. Barge-in fica como rede de segurança (só dispara se o mic estiver ativo, ex. com fones).

## 7. Variáveis de ambiente

| Var | Uso |
|---|---|
| `GEMINI_API_KEY` | Chat + embeddings (Gemini). Obrigatória. |
| `OPENAI_API_KEY` | TTS (voz do Odin) via `/api/tts`. Sem ela, a voz não funciona (chat segue normal). |
| `OPENAI_TTS_VOICE` (opcional) | Voz da OpenAI (default `onyx`). |
| `OPENAI_TTS_SPEED` (opcional) | Velocidade da fala 0.25–4.0 (default `1.15`). |
| `SUPABASE_URL` | Projeto Supabase (`https://zvcuahmxipijphqhyfox.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Acesso server-side ao DB (RAG + ingestão). |
| `VAULT_PATH` (opcional) | Caminho do vault (default `../segundo-cerebro`). Usado pelo sync E pela tool `readObsidianNote`. |
| `INGEST_DIRS` (opcional) | Pastas a indexar (default `wiki`). `it-lean-confidencial` sempre excluída. |
| `SEARCH_API_KEY` (opcional) | Liga a busca web real em `webSearch`. Sem ela → mock. |

## 8. Harness / infra de desenvolvimento

- Construído via **Claude Code** (harness do agente).
- **Supabase MCP** do projeto Odin em `segundo-cerebro/.mcp.json` (`project_ref=zvcuahmxipijphqhyfox`). Requer auth (`claude /mcp`) + restart da sessão pro agente usar. **O runtime do app NÃO depende do MCP** (usa service role key); o MCP é conveniência de dev pra provisionar/inspecionar o DB.
- **Skills:** `ui-ux-pro-max` instalada em `~/.claude/skills` (usada no redesign). Skills do Supabase em `odin/.agents/skills/` (referência).

## 9. Estado atual (o que funciona)

- ✅ Cockpit imersivo (robô 3D fullscreen, glass UI, shader de fundo).
- ✅ Chat com Gemini em streaming (markdown, stop/abort, histórico em memória).
- ✅ Scroll bottom-anchored + scrollbar estilizada.
- ✅ Camada RAG construída e fail-safe (ativa sozinha quando Supabase é configurado).
- ✅ RAG ativo: `npm run sync` incremental + auto-sync via git hook no commit do wiki.
- ✅ Voz: STT (microfone → transcrição ao vivo → auto-envia na pausa) + TTS **OpenAI** (`onyx`, speed 1.15) com fila FIFO por frase. Toggle de voz + **botão headset** (modo conversa contínua meia-duplex) no header.
- ✅ **Function Calling**: loop de tools no servidor com 4 ferramentas (`searchSecondBrain`, `readObsidianNote`, `webSearch` [mock], `getSurfForecast` [Open-Meteo]). `executeTool` blindado.
- ✅ **Glow Pulse**: `VoiceVisualizer` pulsa no ritmo da voz (anel atrás da cabeça + halo frontal); Spline best-effort.
- ✅ **Modo Conversa Contínua**: hands-free meia-duplex (sem eco) + barge-in (rede de segurança c/ fones).
- ✅ **Retry**: backoff exponencial p/ erros transitórios do Gemini (429/503), com mensagem amigável de rate limit.

## 10. Roadmap (e como cada peça se pluga)

**Chat / produto:**
- Persistência de conversa (localStorage → Supabase). Hoje só estado React.
- Múltiplas threads / sidebar de histórico.

**Cérebro:**
- RAG incremental (re-ingerir só arquivos alterados, em vez de rebuild total).
- Citações clicáveis → abrir a nota fonte.

**Multimodal (caminho Jarvis) - todos se plugam no contrato existente:**
- ✅ **Voz (entrada/saída):** feito. STT (Web Speech) + TTS (OpenAI), **modo conversa contínua** (meia-duplex) e **barge-in**. Próximo: voz premium / streaming de TTS.
- ✅ **Ações (function calling):** feito (loop de tools em `chat.ts`). Próximas tools: `writeObsidianNote`, agenda/calendário, automações.
- **Visão:** webcam/screen capture → frames como `parts` multimodais pro Gemini (já é multimodal). Estende `toGeminiContents` em `chat.ts`.
- **Busca web real:** trocar o mock de `webSearch` por Search API (Brave/Serper/Tavily) quando `SEARCH_API_KEY` existir.

**Orquestração multi-modelo:**
- Roteador em `chat.ts` que escolhe Gemini/Claude/GPT por intenção. O contrato `Message[] → AsyncGenerator<string>` não muda; rota e UI ficam intactas.

## 11. Convenções de código

- TypeScript estrito. Imports via alias `@/*` no app; **relativos** no grafo do script de ingestão (evita depender de path-resolution do tsx).
- Comentários em PT-BR, diretos.
- `route.ts` runtime = `nodejs` (SDKs server-side).
- Clients lazy; nunca importar `lib/ai/*` ou `lib/rag/*` em componentes client.
- Tom do Odin definido só em `lib/prompts/odin.ts`.

## 12. Como rodar

```bash
cd odin
cp .env.local.example .env.local   # preencher GEMINI_API_KEY (+ Supabase p/ RAG)
npm run dev                        # http://localhost:3000

# RAG (após aplicar supabase/schema.sql e setar as keys):
npm run sync                       # sincroniza o wiki/ no pgvector (incremental)
# Auto: commit no wiki/ do vault dispara o sync via git hook post-commit.
```
