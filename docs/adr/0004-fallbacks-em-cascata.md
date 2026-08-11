# ADR-0004 — Fallbacks em cascata: nunca derrubar a conversa

- **Status:** Aceita
- **Data:** 2026-06-20
- **Código afetado:** `lib/ai/chat.ts`, `lib/ai/tools.ts`, `lib/rag/retrieve.ts`, `lib/ai/suggestions.ts`, `lib/workflows/nodes/researcher.ts`, `lib/workflows/checkpointer.ts`

## Contexto

O Odin depende de seis serviços externos: Gemini, OpenAI, Supabase, Tavily, Apify e
Open-Meteo. Numa cadeia assim, a pergunta não é *se* algo vai falhar, é o que acontece com
a conversa quando falhar.

O contexto de uso agrava: o Odin é **voice-first**. Uma exceção não aparece como stack
trace — aparece como o robô parando de falar no meio da frase. Erro técnico vira quebra de
imersão, que é uma das features declaradas do produto.

## Decisão

**Toda capacidade degrada em cascata em vez de propagar erro. Nada derruba a conversa.**

Cascatas implementadas:

| Cadeia | Comportamento |
|---|---|
| Gemini → OpenAI | Erro/rate-limit cai para `gpt-4o-mini`, com aviso visível no stream |
| Retry com backoff | 429/503/500 → 1s → 2s → 4s antes de desistir |
| RAG → `[]` | Supabase fora do ar ou não configurado: o chat responde sem contexto |
| Tool → `{ error }` | `executeTool` **nunca lança**; o erro volta ao modelo, que se recupera no mesmo turno |
| Apify → Tavily → mock | Researcher sempre devolve algo |
| Redis → MemorySaver | Checkpointer sempre existe |
| Sugestões → `[]` | Chips somem, cockpit fica idêntico |

O RAG se "liga sozinho" quando o Supabase é configurado: não há flag, é o mesmo caminho de
código.

## Consequências

### O que ganhamos

- A conversa nunca quebra. Em uso hands-free, isso é a diferença entre um copiloto e um
  brinquedo.
- Setup incremental: o Odin roda com uma única chave (`GEMINI_API_KEY`) e ganha capacidade
  conforme as outras aparecem. Não há estado "meio configurado" que trave.
- O erro de tool voltar como `{ error }` para o modelo é mais forte do que parece: o modelo
  frequentemente contorna sozinho no mesmo turno, sem o usuário ver nada.

### O que estamos pagando por isso

**Esta é a seção que importa neste ADR.**

**O sistema nunca cai, e por isso nunca grita.** O custo não é teórico — já se materializou
duas vezes:

1. **`webSearch` está em modo mock e ninguém notou.** `SEARCH_API_KEY` não está no
   `.env.local`, então toda busca web devolve um resultado fabricado apontando para
   `example.com`. O Odin apresenta isso como se fosse busca real. A cascata funcionou
   perfeitamente e produziu uma resposta errada com cara de certa.

2. **Isso torna o loop do researcher caro.** Como o fallback devolve mock, a extração de
   leads não encontra nada; e o supervisor, ao ver `leads.length === 0`, roteia de volta
   para o researcher. Ver [`ESTADO.md`](../ESTADO.md) §2.4.

3. **`LLM_PROVIDER=openai` desliga os chips de follow-up em silêncio**, porque as sugestões
   dependem de structured output do Gemini.

O padrão comum: **degradação silenciosa vira mentira de UX.** Um sistema que sempre
responde e nunca avisa que está respondendo pior é menos confiável que um que falha alto.

### A consequência obrigatória

Este ADR não está completo sem sua contrapartida, e ela ainda **não** está implementada:

> **Todo fallback ativado precisa ser visível** — no log do servidor e na UI. Degradar é
> correto; degradar em silêncio não é.

O padrão certo já existe no repo e é o do fallback de provider, que emite
`_(⚠️ Gemini esgotado. Redirecionando para OpenAI...)_` no próprio stream. Isso deveria ser
a regra, não a exceção. Item T2 no [`BACKLOG.md`](../BACKLOG.md).

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| **Propagar o erro e mostrar mensagem** | Quebra a imersão e, no modo voz, deixa o usuário sem saber o que houve. Aceitável num dashboard, não num copiloto ambiente |
| **Falhar rápido em dependência ausente** (checar env no boot) | Impede o setup incremental. O Odin deve rodar útil com uma chave só |
| **Mock silencioso como comportamento padrão** | É o que está lá hoje para o `webSearch`, e é justamente o que produziu o pior efeito colateral. Mock deve existir, mas anunciado |
| **Circuit breaker com estado** | Over-engineering para usuário único. Retry com backoff cobre o caso real (rate limit transitório) |

## Como saber que esta decisão envelheceu

- **Se um fallback silencioso produzir uma resposta errada que o Gabriel aja em cima.**
  Aí a regra deixa de ser "avise" e passa a ser "recuse": algumas capacidades (busca web
  factual) são melhores indisponíveis do que fingidas.
- Quando houver mais de um usuário: aí degradação silenciosa vira problema de suporte —
  ninguém consegue reproduzir um bug que é só uma chave de API faltando.

## Referências

- [`ESTADO.md`](../ESTADO.md) §3.4: a ambiguidade aberta que este ADR gerou
- [ADR-0001 — Contrato agnóstico de provider](./0001-contrato-agnostico-de-provider.md): a cascata Gemini → OpenAI, e o que ela silenciosamente perde
