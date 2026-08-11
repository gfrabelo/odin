# ADR-NNNN — <título: a decisão no imperativo, não o tema>

- **Status:** Proposta | Aceita | Substituída por ADR-XXXX | Descontinuada
- **Data:** AAAA-MM-DD
- **Código afetado:** `caminho/arquivo.ts`, `caminho/outro.ts`

## Contexto

O que era verdade quando a decisão foi tomada. Fatos e forças, não justificativa.
Se você precisar explicar por que a decisão é boa aqui, você está escrevendo na
seção errada.

## Decisão

Uma frase. No imperativo. Se não couber numa frase, provavelmente são duas decisões
e merecem dois ADRs.

## Consequências

### O que ganhamos

### O que estamos pagando por isso

Seja específico e concreto. "Flexibilidade" não é um custo. "Todo caminho novo
vira código em vez de prompt" é. Se esta seção estiver vazia ou vaga, a decisão
não foi realmente pesada.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| | |

Esta seção é o que separa um ADR de documentação. Um ADR sem alternativa descartada
não registra uma decisão — registra um fato, e fato mora no `ESTADO.md`.

## Como saber que esta decisão envelheceu

Um gatilho **observável e verificável**, não uma sensação. Ex: "quando
`odinFunctionDeclarations.length > 12`", "quando um run precisar sobreviver a um
restart", "quando a tabela passar de 50k linhas".

Sem esta seção, a decisão vira dogma: ninguém sabe quando é legítimo revisitá-la.
