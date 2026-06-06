# CONTEXTO-LLM — Odin (fonte de verdade técnica)

> **Documento vivo.** Carregue este arquivo como contexto ao trabalhar no Odin com qualquer LLM.
> Mantém o estado real do projeto: arquitetura, decisões, o que existe e o que vem.
> Última atualização: camada RAG construída (aguardando configuração do Supabase pelo usuário).

---

## 1. Identidade

**Odin** é o assistente de IA pessoal de Gabriel Rabelo — um "knowledge orchestrator" / segundo cérebro externo. Visão de longo prazo: um "Jarvis" pessoal (chat → RAG → multimodal voz/visão → ações via tools).

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
| IA (chat) | `@google/genai` — modelo `gemini-2.5-flash` |
| IA (embeddings) | `gemini-embedding-001` com `outputDimensionality: 768` (default do modelo é 3072) |
| RAG / DB | `@supabase/supabase-js` + Postgres `pgvector` |
| Scripts | `tsx` + `dotenv` |
| Voz | Web Speech API nativa: `SpeechRecognition` (STT) + `SpeechSynthesis` (TTS), pt-BR. Sem deps. |
| Fonte | Inter (sans) + Geist Mono (terminal) |

> Nota: `@anthropic-ai/sdk` ainda consta nas deps (uso original com Claude). Hoje inativo; mantido pensando na orquestração multi-modelo futura.

## 4. Estrutura de pastas

```
odin/
├── app/
│   ├── page.tsx               # Cockpit (client): estado do chat, fetch+stream, AbortController
│   ├── layout.tsx             # Root: fontes (Inter/Geist Mono), dark, metadata
│   ├── globals.css            # Tailwind v4 @theme, tokens glass/accent, scrollbar, .odin-md
│   └── api/chat/route.ts      # POST: consome streamOdinResponse → ReadableStream de texto
├── components/
│   ├── interface/
│   │   ├── OdinBackground.tsx  # Background fixo: WebGLShader + Spotlight + scrims (pointer-events-none)
│   │   ├── CommandInput.tsx    # Input terminal/glass; botão envia↔parar; Lucide
│   │   └── ResponseStream.tsx  # Conversa: scroll bottom-anchored + markdown nas respostas
│   └── ui/
│       ├── splite.tsx          # SplineScene (lazy + Suspense)
│       ├── spotlight.tsx       # Spotlight (aceternity, SVG)
│       ├── web-gl-shader.tsx   # Shader de fundo (adicionado pelo usuário)
│       └── card.tsx            # shadcn
├── lib/
│   ├── ai/
│   │   ├── client.ts           # getGemini() — singleton lazy (GEMINI_API_KEY)
│   │   └── chat.ts             # streamOdinResponse() — RAG + Gemini streaming [PONTO DE EXTENSÃO]
│   ├── prompts/odin.ts         # ODIN_SYSTEM_PROMPT (isolado, fácil de refinar)
│   ├── rag/
│   │   ├── supabase.ts         # getSupabase()/isSupabaseConfigured() — lazy, service role
│   │   ├── embeddings.ts       # embedQuery()/embedDocuments() — Gemini text-embedding-004
│   │   └── retrieve.ts         # retrieveContext() — embed query → match_documents (fail-safe)
│   └── utils.ts                # cn()
├── scripts/sync.ts             # Sync incremental wiki → Supabase (npm run sync)
├── supabase/schema.sql         # pgvector + tabela documents + função match_documents
├── types/index.ts              # Message, Role, ChatRequest
└── .env.local.example          # GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, [VAULT_PATH, INGEST_DIRS]
```

## 5. Fluxo de dados (ciclo de uma mensagem)

```
CommandInput.onSubmit
  → page.tsx handleSend: monta history (Message[]), POST /api/chat com AbortController.signal
    → route.ts: streamOdinResponse(messages) → ReadableStream<Uint8Array> (text/plain)
      → chat.ts streamOdinResponse:
          1. pega a última msg do user
          2. retrieveContext(query)  ← RAG (embed query → match_documents) [fail-safe → []]
          3. buildSystemInstruction(chunks)  ← injeta contexto no system
          4. gemini.models.generateContentStream(...)  → yields chunk.text
    → route enfileira cada chunk de texto
  → page lê response.body.getReader(), acumula em `streaming`, ao fim faz commit em `messages`
  → ResponseStream renderiza (markdown nas respostas do Odin), auto-scroll
```

Detalhes:
- **Streaming:** texto puro (sem SSE). Mais simples; client só lê o ReadableStream.
- **Stop:** `AbortController` no fetch. Em `AbortError`, preserva o texto parcial já gerado.
- **Histórico:** estado React em `page.tsx` (sem persistência ainda; refresh limpa).

## 6. RAG — detalhes

- **Embeddings:** `gemini-embedding-001` com `outputDimensionality: 768` (o default do modelo é 3072; truncamos pra 768 e bate com `vector(768)`; cosine é invariante a escala, sem normalização extra). `taskType: RETRIEVAL_QUERY` (busca) vs `RETRIEVAL_DOCUMENT` (ingestão). Embedagem sequencial (1 por chamada) por robustez.
- **Schema (`supabase/schema.sql`):** tabela `documents(id, content, metadata jsonb, embedding vector(768), created_at)`; índice HNSW cosine; função `match_documents(query_embedding, match_count, filter)` retornando `similarity = 1 - (embedding <=> query)`.
- **Sync (`scripts/sync.ts`, `npm run sync`):** INCREMENTAL. Varre `VAULT_PATH` (default `../segundo-cerebro`), pastas `INGEST_DIRS` (default `wiki`), exclui `HARD_EXCLUDE=["it-lean-confidencial"]`. Chunk ~1200 chars / overlap 150. Hash SHA-1 do conteúdo por arquivo em `metadata.hash`: re-embeda só arquivos com hash diferente, remove os que sumiram do wiki, pula inalterados. Metadata: `{path, title, chunk, hash}`.
- **Auto-sync:** git hook `post-commit` no vault (`segundo-cerebro/.git/hooks/post-commit`) — quando um commit mexe em `wiki/`, roda `npm run sync` no Odin automaticamente.
- **Estado:** ✅ RAG VALIDADO E ATIVO. 62 chunks no Supabase. Retrieval testado ("visão 2031" → `visao-2031` sim. 0.786). Chat UI cita fontes `[n]`. Incremental + hook validados.

## 7. Variáveis de ambiente

| Var | Uso |
|---|---|
| `GEMINI_API_KEY` | Chat + embeddings (Gemini). Obrigatória. |
| `SUPABASE_URL` | Projeto Supabase (`https://zvcuahmxipijphqhyfox.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Acesso server-side ao DB (RAG + ingestão). |
| `VAULT_PATH` (opcional) | Caminho do vault (default `../segundo-cerebro`). |
| `INGEST_DIRS` (opcional) | Pastas a indexar (default `wiki`). `it-lean-confidencial` sempre excluída. |

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
- ✅ Voz: STT (microfone → transcrição ao vivo → auto-envia na pausa) + TTS (Odin fala a resposta; toggle no header). `lib/voice/{use-speech-recognition,use-speech-synthesis,strip}.ts`, `types/speech.d.ts`. Click-to-talk (não contínuo); TTS é cancelada ao enviar novo comando e ao iniciar o mic.

## 10. Roadmap (e como cada peça se pluga)

**Chat / produto:**
- Persistência de conversa (localStorage → Supabase). Hoje só estado React.
- Múltiplas threads / sidebar de histórico.

**Cérebro:**
- RAG incremental (re-ingerir só arquivos alterados, em vez de rebuild total).
- Citações clicáveis → abrir a nota fonte.

**Multimodal (caminho Jarvis) — todos se plugam no contrato existente:**
- ✅ **Voz (entrada/saída):** feito (Web Speech API). Próximos refinamentos: modo conversa contínua (re-armar o mic após o Odin falar), voz premium via Gemini TTS, barge-in.
- **Visão:** webcam/screen capture → frames como `parts` multimodais pro Gemini (já é multimodal). Estende `toGeminiContents` em `chat.ts`.
- **Ações (function calling):** declarar tools no `generateContentStream` (config.tools) e tratar tool calls no loop — mesmo padrão de "harness". Ponto de plugue: `chat.ts`.

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
