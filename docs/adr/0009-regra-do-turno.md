# ADR-0009 — A Regra do Turno: quando escalar para LangGraph

- **Status:** Aceita
- **Data:** 2026-08-11
- **Código afetado:** `lib/ai/chat.ts`, `lib/workflows/graph.ts` — e, principalmente, tudo que ainda não foi escrito

## Contexto

O Odin tem hoje dois mecanismos de orquestração, e nada escrito sobre quando usar cada um:

1. **O loop de function calling** (`lib/ai/chat.ts`) — até 5 turnos, resolve tools em
   paralelo com `Promise.all`, tem retry com backoff e fallback de provider, e **streama
   token a token**.
2. **O grafo LangGraph** (`lib/workflows/`) — nós, arestas condicionais, checkpointer,
   `interrupt()` para revisão humana.

Sem critério, a escolha vira estética: grafo parece mais sofisticado, então tudo vira
grafo. Esse é exatamente o modo de falha "criar agente por criar" — e ele é caro, porque
cada grafo novo traz estado, reducers, checkpointer e uma superfície de bug que o loop de
tools não tem.

A pergunta que forçou esta decisão foi concreta: o Odin deveria ganhar workflows para
Carreira, Aprendizado, Prospecção, Pessoal e Surf? A resposta precisava de uma régua, não
de intuição.

## Decisão

> ### A Regra do Turno
>
> **Se o trabalho cabe num turno (uma requisição → uma resposta), é loop de tools.
> Se o trabalho precisa sobreviver ao turno, é grafo.**
>
> **Três sintomas de que sobrevive ao turno:**
> 1. Tem pausa humana no meio.
> 2. Precisa retomar depois de o processo morrer.
> 3. Já gastou dinheiro ou causou efeito irreversível que uma nova tentativa teria que repagar.
>
> **Quatro coisas que não são motivo:**
> - *"tem vários passos"* — o loop de tools tem cinco (`MAX_TOOL_TURNS`).
> - *"tem ciclo"* — o loop de tools **é** um ciclo com estado acumulado.
> - *"roda coisas em paralelo"* — o loop de tools já faz `Promise.all` sobre as tool calls.
> - *"é outro assunto"* — assunto é metadado, não arquitetura (ver [ADR-0008](./0008-um-cerebro-nao-cinco.md)).
>
> **O custo de toda escalada: o grafo não streama token a token; o chat streama.**
> Toda vez que você escala, troca sensação de tempo real por durabilidade. Se não
> precisava de durabilidade, você só piorou a UX.

O padrão é o loop de tools. O grafo é a exceção que precisa se justificar.

### A regra aplicada

| Domínio | Grafo? | Por quê |
|---|---|---|
| **Prospecção** | **Sim** | Os três sintomas juntos: pausa humana antes de ação irreversível (`interrupt()` em `human-review.ts`), gasto real por run (Apify), e o trabalho dura dias — revisa leads hoje, contata amanhã. Único caso que passa com folga |
| **Carreira** | **Não hoje** | Hoje é Q&A sobre o vault com busca web ocasional: cabe no turno. *Passaria* se virasse um scanner agendado de vagas que roda sozinho e enfileira candidatas para revisão — e repare que aí ele vira **prospecção com outro alvo, mesma forma**. Isso é evidência a favor da regra: o que decide é a forma, não o assunto |
| **Aprendizado** | **Não, e é o "não" mais forte** | O fluxo `raw/ → wiki/` é curadoria humana **de propósito** ([ADR-0002](./0002-vault-fonte-de-verdade.md)). Automatizar destruiria exatamente o que dá valor ao vault: o filtro do Gabriel. Aqui um agente pioraria o sistema. A resposta certa é recuperação melhor, não orquestração |
| **Pessoal** | **Não** | Consulta ao vault. É o que o loop de tools já faz, e melhor, porque streama |
| **Surf** | **Não, enfaticamente** | `getSurfForecast` são duas chamadas HTTP ao Open-Meteo e já funciona. Virar agente seria literalmente "agente pelo agente". Surf é o melhor exemplo da confusão de eixos: parece domínio porque é *assunto* distinto; é uma função |
| **Conteúdo (canal)** | **Talvez — único candidato a segundo grafo** | Um pipeline pauta → roteiro → revisão passa na regra (pausa humana, dura dias). Mas só **depois** que a prospecção der dinheiro |

Placar: **1 de 6 justifica um grafo, e esse já existe.**

## Consequências

### O que ganhamos

- Um critério que permite dizer **não** às próximas ideias de workflow com um argumento
  em vez de uma intuição — que era o problema declarado.
- O custo da escalada fica explícito e nomeado. Antes, adicionar um grafo parecia grátis.
- A regra revelou algo não óbvio: quando "Carreira" foi analisada a fundo, ela colapsou
  na mesma forma da prospecção. **Formas de tarefa são poucas; assuntos são infinitos.**
  Isso sugere que o caminho de crescimento é generalizar o grafo existente para outros
  alvos, não multiplicar grafos.

### O que estamos pagando por isso

- Um caso legítimo pode ser barrado por parecer caber no turno quando não cabe. O erro é
  recuperável (migrar loop → grafo é refactor local), mas custa retrabalho.
- A regra não diz nada sobre **onde** colocar o efeito colateral dentro de um grafo — e é
  aí que mora a armadilha real: LangGraph **reexecuta o nó do topo** ao retomar de um
  `interrupt()`, então qualquer escrita acima do `interrupt` roda duas vezes. Isso precisa
  do seu próprio ADR quando a persistência entrar.
- Fica implícito que o loop de tools escala indefinidamente, e não escala: ele tem teto em
  `MAX_TOOL_TURNS = 5` e degrada conforme a lista de tools cresce. Esse limite é tratado
  no [ADR-0008](./0008-um-cerebro-nao-cinco.md).

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| **Quatro cláusulas independentes** (pausa, resumabilidade, efeito caro, ciclo com estado) | A cláusula "ciclo com estado" não é suficiente e é a que deixa passar workflow ruim: `while` é ciclo, e `chat.ts` já é um ciclo com estado acumulado. Mantê-la significa que sempre dá para argumentar a favor de um grafo. As outras três são a mesma propriedade vista de três ângulos — colapsá-las numa frase deixa a regra memorizável |
| **"Um workflow por domínio"** | Confunde assunto com forma. Produziria cinco grafos onde um é justificado, e quebraria as perguntas que cruzam domínios — que são as boas ([ADR-0008](./0008-um-cerebro-nao-cinco.md)) |
| **Sempre LangGraph, por consistência** | Perde o streaming em todo lugar. O chat é a superfície principal do produto e a percepção de latência é a feature mais sentida |
| **Sempre loop de tools, sem grafo** | Não sobrevive a `interrupt()`. Prospecção precisa parar por horas ou dias esperando revisão humana, e uma requisição HTTP não espera |

## Como saber que esta decisão envelheceu

- Quando **dois** casos independentes passarem na regra e ambos precisarem do mesmo
  encanamento (persistência, retomada, revisão). Aí a decisão seguinte não é "mais um
  grafo", é extrair um runtime de workflow compartilhado.
- Quando o LangGraph passar a suportar streaming token a token nos nós. A cláusula de
  custo é o que segura a régua; se o custo sumir, a régua afrouxa.

## Referências

- [ADR-0003 — Supervisor determinístico](./0003-supervisor-deterministico.md): o que fazer **dentro** de um grafo, uma vez escalado
- [ADR-0008 — Um cérebro, não cinco](./0008-um-cerebro-nao-cinco.md): a decisão irmã, sobre o outro eixo da mesma pergunta
