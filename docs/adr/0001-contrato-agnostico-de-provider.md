# ADR-0001 — Contrato agnóstico de provider

- **Status:** Aceita
- **Data:** 2026-06-06
- **Código afetado:** `lib/ai/chat.ts`, `lib/ai/client.ts`, `app/api/chat/route.ts`

## Contexto

O Odin nasceu como laboratório de AI engineering. Trocar de modelo — para experimentar,
para fugir de rate limit, ou porque um provider ficou melhor — é uma operação **esperada e
frequente**, não uma migração de uma vez só.

Se a UI e a rota HTTP conhecessem o SDK do provider, cada troca viraria refactor de ponta
a ponta, e o projeto pararia de servir ao propósito de ser laboratório.

## Decisão

**Toda a lógica de IA vive atrás de um contrato estável:**

```ts
Message[] → AsyncGenerator<string>
```

A rota HTTP e a UI não sabem qual modelo está atrás. `app/api/chat/route.ts` só envolve o
gerador num `ReadableStream` de texto puro. Trocar Gemini ↔ OpenAI ↔ Claude não toca a
interface.

`lib/ai/chat.ts` é o **ponto de extensão**: RAG, loop de tools, retry e fallback moram ali,
todos do lado de dentro do contrato.

## Consequências

### O que ganhamos

- O fallback do [ADR-0004](./0004-fallbacks-em-cascata.md) coube sem tocar em nada acima:
  `streamOpenAIResponse` é outra implementação do mesmo contrato.
- `LLM_PROVIDER` troca o cérebro por variável de ambiente.
- O contrato é **streaming por natureza**, o que preservou a latência percebida como
  característica não negociável do produto. É também a razão pela qual o
  [ADR-0009](./0009-regra-do-turno.md) trata a perda de streaming como o custo explícito
  de escalar para grafo.

### O que estamos pagando por isso

- **O contrato é o mínimo múltiplo comum, e ele vaza.** `AsyncGenerator<string>` só
  transporta texto — então tudo que não é texto precisa ser codificado *dentro* do texto.
  É daí que vem o marcador in-band `_⚙️ Odin acionando: …_`, que a UI remove com regex
  (`lib/utils.ts` → `stripToolMarkers`). Dívida consciente: acopla a UI a um formato de
  string no meio do stream.
- **O fallback OpenAI não tem tools.** `streamOpenAIResponse` é chat puro. Uma queda do
  Gemini no meio de um loop de tools degrada o Odin para RAG simples — e o usuário não é
  avisado dessa perda específica, só da troca de provider.
- Recursos específicos de SDK ficam inacessíveis por padrão. O `googleSearch` nativo do
  Gemini é o exemplo: teve que virar uma tool custom via Tavily, porque o Gemini não
  permite misturá-lo com `functionDeclarations` — o que também escondeu um lock-in dentro
  de uma tool que parece neutra.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| **Usar o SDK do Gemini diretamente na rota** | Mais simples hoje, e transformaria toda troca de modelo em refactor. Mata o propósito de laboratório |
| **Adotar o Vercel AI SDK** | Resolveria o mesmo problema com mais features. Descartado por ser uma abstração de terceiro sobre a peça mais central do sistema — num projeto cujo objetivo declarado é *aprender* essa camada, terceirizá-la é perder o exercício |
| **Contrato mais rico** (`AsyncGenerator<ChatEvent>` com eventos tipados) | Resolveria o vazamento do marcador in-band. Descartado por escopo na época — e é hoje a alternativa mais forte quando este ADR for revisitado |

## Como saber que esta decisão envelheceu

- **Quando o marcador in-band precisar transportar mais que um nome de ferramenta.** Já
  está no limite: a UI faz regex no *rabo* do stream para adivinhar a fase. O próximo dado
  estruturado que precisar atravessar o contrato é o sinal para migrar para
  `AsyncGenerator<ChatEvent>`.
- Quando o Odin passar a usar mais de um provider **ao mesmo tempo** (roteamento por
  intenção), e não um de cada vez. Aí o contrato precisa carregar qual modelo respondeu.

## Referências

- [ADR-0004 — Fallbacks em cascata](./0004-fallbacks-em-cascata.md): a cascata que este contrato viabiliza
- [ADR-0009 — A Regra do Turno](./0009-regra-do-turno.md): por que perder o streaming é o custo central de escalar para grafo
