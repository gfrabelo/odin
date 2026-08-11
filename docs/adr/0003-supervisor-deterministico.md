# ADR-0003 — Supervisor determinístico, não roteador LLM

- **Status:** Aceita
- **Data:** 2026-08-03 (commit `6b7ba86`)
- **Código afetado:** `lib/workflows/nodes/supervisor.ts`, `lib/workflows/graph.ts`, `lib/workflows/prompts.ts`

## Contexto

O desenho original do workflow de prospecção rodava um lead por vez. O estado
carregava `currentLeadIndex`, `qualification`, `outreachDraft` e `revisionCount`, e o
Supervisor era um nó com LLM: recebia o estado, e um prompt pedia que ele decidisse o
próximo agente **e** mantivesse os ponteiros (`currentLeadIndex++`, `qualification = null`).

Isso quebrou em produção da forma mais cara possível — silenciosamente, e em loop.

Depois da aprovação humana do Lead #1 (Scob Pet Shop), o Supervisor mandava "qualificar
o próximo lead", mas `currentLeadIndex` continuava em `0` e `qualification` ainda tinha
os dados do lead anterior. O Qualifier relia a posição `0` e **re-qualificava o mesmo
lead infinitamente**, queimando tokens até o `recursionLimit` estourar.

A causa raiz não foi um prompt mal escrito. Foi delegar **manutenção mecânica de
ponteiros e limpeza de estado** a um componente probabilístico. Um contador que precisa
incrementar exatamente uma vez não tolera 5% de variação — e nenhum prompt entrega 0%.

## Decisão

**O roteamento e toda a mutação de estado de controle são `if/else` em TypeScript. O
LLM não decide fluxo, não mantém contador e não limpa estado.**

`supervisorNode` é hoje uma função pura de estado, sem nenhuma chamada de modelo:

```
1. humanDecision aprovado/rejeitado    → __end__
2. leads.length === 0                  → researcher
3. qualifiedLeads.length === 0         → qualifier
4. senão                               → human_review
```

Os prompts de supervisor e de human-review foram **deletados**, não desativados. O
comentário em `lib/workflows/prompts.ts` registra a razão: eles nunca eram importados
por ninguém — eram *descrição de comportamento disfarçada de prompt*.

> **Princípio de ouro:** LLM para tarefas cognitivas (pesquisa, avaliação, copywriting).
> TypeScript determinístico para controle de fluxo, estados e contadores.

## Consequências

### O que ganhamos

- **A classe inteira de bug do ponteiro preso deixou de existir.** Não foi mitigada com
  um prompt melhor; foi eliminada estruturalmente.
- O roteamento virou **testável sem mock e sem rede**. `supervisorNode` recebe um objeto
  e devolve um objeto — três asserções cobrem todos os caminhos.
- O roteamento virou **debugável**: um `console.log` mostra a decisão e o porquê. Antes,
  entender uma decisão errada exigia ler a cadeia de raciocínio do modelo.
- Latência e custo caíram uma chamada de LLM por transição — e o supervisor roda a cada
  salto no padrão hub-and-spoke, então era a chamada mais frequente do grafo.

### O que estamos pagando por isso

- **Todo caminho novo vira código.** Adicionar um estágio exige editar o supervisor e o
  mapa de arestas condicionais, não escrever uma frase num prompt. Isso é lento de
  propósito.
- O supervisor não lida com o inesperado. Um estado que não casa com nenhum `if` cai no
  último `else` — não improvisa. Aqui isso é feature, mas é uma limitação real.
- A lógica de roteamento fica **espalhada entre o supervisor e o formato do estado**.
  Ler `supervisor.ts` sozinho não conta a história toda; é preciso saber quais reducers
  o `types.ts` aplica. Foi exatamente essa distância que produziu a lacuna registrada no
  [`ESTADO.md`](../ESTADO.md) §2.4: o reducer de `leads` é *append*, e o branch 2 testa
  `leads.length === 0` — então um researcher sem resultado ainda faz o grafo circular.
  **Determinismo eliminou o loop causado pelo modelo; não elimina loop causado por
  lógica errada.**

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| **Melhorar o prompt do supervisor** (few-shot da atualização de ponteiro, structured output para `currentLeadIndex`) | Reduz a taxa de erro, não zera. Para um contador, qualquer taxa > 0 é loop infinito eventual. Trocaria um bug determinístico por um intermitente — pior de diagnosticar |
| **LLM roteia, código valida** (guard-rail que corrige saída inválida) | Se o código já sabe o suficiente para validar a decisão, ele sabe o suficiente para tomá-la. A chamada de LLM vira custo e latência puros |
| **Padrão hierárquico** (supervisor de supervisores) | Over-engineering para um time de 3 a 5 agentes. Adiciona um nível de indireção sem resolver o problema, que era de mutação de estado, não de escala de roteamento |
| **Eliminar o supervisor** (arestas fixas entre especialistas) | Perde o ponto único de roteamento. Adicionar um agente passaria a exigir reconfigurar arestas entre todos os nós, em vez de editar um arquivo |

## Como saber que esta decisão envelheceu

- Quando o `supervisorNode` passar de ~10 branches. Aí a árvore de decisão virou complexa
  o bastante para que roteamento por LLM (com validação em código) volte a ser discutível.
- Quando um estágio novo precisar rotear por **conteúdo semântico** e não por forma do
  estado — ex: "escolha o especialista pelo assunto da tarefa". Aí a decisão é cognitiva,
  cai do outro lado do princípio de ouro, e o roteamento passa a ser um nó de LLM
  *separado* que devolve um enum validado — sem voltar a deixar o modelo mutar estado.

## Referências

- Post-mortem original, com o código do bug: [`LANGGRAPH_MULTI_AGENT_GUIDE.md`](../../LANGGRAPH_MULTI_AGENT_GUIDE.md) §4
- Decisão irmã, sobre limites de escalada: [ADR-0009 — A Regra do Turno](./0009-regra-do-turno.md)
- O desenho de rotação que este ADR aposentou: ADR-0006 (resumido no [índice](./README.md))
