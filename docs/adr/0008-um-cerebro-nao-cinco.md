# ADR-0008 — Um cérebro, não cinco: domínio não é fronteira de agente

- **Status:** Aceita
- **Data:** 2026-08-11
- **Código afetado:** `lib/prompts/odin.ts`, `lib/ai/tools.ts`, `lib/ai/chat.ts`, `lib/rag/retrieve.ts`

## Contexto

O Odin consulta o vault inteiro em toda pergunta. Isso levantou uma proposta: dividir o
sistema em domínios — **Carreira, Aprendizado, Prospecção, Pessoal, Surf** — cada um com
seu próprio agente e workflow.

A intuição por trás é legítima: uma pergunta sobre surf não deveria trazer chunk de
realocação. Mas a proposta trata como *um* problema o que na verdade são **três eixos
independentes**, e só um deles é real.

| Eixo | É problema real? | Onde se resolve |
|---|---|---|
| **Escopo de recuperação** — qual subconjunto do vault é relevante | **Sim** | Metadado no índice + filtro na busca |
| **Persona / comportamento** — como o Odin fala sobre cada assunto | Não | `ODIN_SYSTEM_PROMPT` já cobre, inclusive o tom de surfista |
| **Orquestração** — multi-etapa com estado durável | Só onde a forma da tarefa pede | LangGraph, caso a caso ([ADR-0009](./0009-regra-do-turno.md)) |

Cinco agentes resolveriam o primeiro eixo com a ferramenta do terceiro. É como trocar o
motor para consertar o retrovisor.

Há ainda um problema que a divisão **cria**: roteamento. "Devo aceitar essa proposta de
contrato?" é Carreira ou Prospecção? "Vale a pena estudar LangGraph agora?" é Aprendizado
ou Carreira? Toda pergunta interessante do Gabriel cruza domínios — porque a razão de ter
um segundo cérebro é justamente conectar decisão de vida, estado de projeto e tese
técnica no mesmo raciocínio. **Um roteador de domínio quebraria exatamente as perguntas
que fazem o Odin valer a pena.**

## Decisão

**O Odin continua sendo um agente com um system prompt. "Domínio" vira metadado de
recuperação, não fronteira de sistema.**

Concretamente:
- Um `ODIN_SYSTEM_PROMPT`, uma identidade, um conjunto de tools.
- O escopo de domínio entra como **argumento opcional de busca**, escolhido pelo modelo
  quando ele sabe o que quer, e ignorado quando a pergunta cruza assuntos.
- A implementação do metadado é o [ADR-0010](./0010-metadado-do-frontmatter.md).

## Consequências

### O que ganhamos

- Perguntas cross-domain continuam funcionando — e são a maioria das que importam.
- Um prompt para manter, uma superfície de eval, um lugar onde a personalidade vive.
- O problema real (recuperação com ruído) fica **isolado e barato**: é filtro e
  threshold, não arquitetura.

### O que estamos pagando por isso

- **Um system prompt que só cresce.** `lib/prompts/odin.ts` já tem ~131 linhas e carrega
  identidade, tom, regras de discordância, frases proibidas, uso de tools e heurística de
  surf. Isso não escala para sempre.
- **A lista de tools é o limite real**, e ele é mensurável: a precisão de seleção de tool
  degrada conforme as declarações crescem. Hoje são 4. O custo desta decisão é que esse
  número vai subir.
- Sem domínios separados, não há isolamento de falha: um prompt ruim degrada tudo ao mesmo
  tempo.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| **Cinco agentes de domínio, um por assunto** | Cinco prompts para manter, cinco superfícies de eval, e um roteador novo que pode errar. Quebra perguntas cross-domain, que são as boas. Resolve com arquitetura um problema que é de filtro |
| **Um roteador de intenção na frente** (classifica e despacha) | Adiciona uma chamada de LLM e um ponto de falha antes de toda resposta. E o erro é do tipo pior: rotear errado torna a informação certa **inalcançável**, em silêncio |
| **Escopo automático por heurística de palavra-chave** | Erraria justamente nas perguntas cross-domain. E a assimetria condena: escopo errado esconde o chunk certo (falha silenciosa, indebugável); nenhum escopo apenas rebaixa o ranking (falha recuperável — o modelo ainda vê o conteúdo e pode buscar de novo) |
| **Personas separadas com o mesmo retrieval** | Resolveria o eixo que não é problema (persona) e deixaria o que é (recuperação) intacto |

## Como saber que esta decisão envelheceu

Gatilhos observáveis — qualquer um dos dois reabre a discussão:

1. **`odinFunctionDeclarations.length > 12`.** É onde a precisão de seleção de tool
   costuma começar a cair de forma perceptível.
2. **Erro de seleção de tool acima de 10% no eval.** Exige que o eval exista
   ([`EVAL.md`](../EVAL.md)) — o que é o ponto: a decisão fica presa a uma medição, não a
   uma sensação.

Quando um desses disparar, a resposta provavelmente ainda **não** é "cinco agentes de
domínio". É agrupar tools por capacidade e carregar subconjuntos por contexto — o que
preserva o cérebro único e ataca o limite real.

## Referências

- [ADR-0009 — A Regra do Turno](./0009-regra-do-turno.md): o outro eixo da mesma pergunta, com a análise domínio a domínio
- [ADR-0010 — Metadado do frontmatter](./0010-metadado-do-frontmatter.md): como o escopo de domínio é implementado
- [`ESTADO.md`](../ESTADO.md) §2.8: o problema de ruído que motivou tudo isso
