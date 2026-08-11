# ADR-0002 — Vault Obsidian como fonte de verdade, fluxo unidirecional

- **Status:** Aceita
- **Data:** 2026-06-15
- **Código afetado:** `lib/vault.ts`, `scripts/sync.ts`, `lib/rag/`, `lib/ai/tools.ts`

## Contexto

O Odin existe para dar interface viva a um segundo cérebro que já existia antes dele: um
vault Obsidian em markdown, versionado em git, num repositório **separado**
(`../segundo-cerebro`). São hoje 94 notas curadas em `wiki/`, ~43k palavras, mais uma
camada `raw/` de captura bruta.

Havia uma escolha estrutural a fazer: o Supabase é uma **cópia** do conhecimento ou uma
**fonte** dele? A pergunta parece filosófica e não é — ela decide o que acontece quando os
dois divergem, e o que é possível perder.

## Decisão

**O vault é a única fonte de verdade. O dado só flui ladeira abaixo:**

```
cérebro → Obsidian → wiki/ → Supabase → Odin
```

**Nunca para cima.** O Odin lê o vault e não escreve nele. O índice vetorial é derivado e
descartável: apagar a tabela `documents` inteira custa um `npm run sync`.

> **A analogia que sustenta isso:** o markdown é o **negativo do filme**. O Supabase é uma
> cópia revelada, para facilitar a busca. Queimou a cópia? Você revela outra do negativo,
> com um comando. Mas se jogar fora o negativo e guardar só a cópia, perdeu para sempre.

Dois saltos, com naturezas diferentes:
- **Salto A — `raw/ → wiki/`: intelectual.** Curadoria humana, feita pelo Gabriel. É onde
  o julgamento acontece.
- **Salto B — `wiki/ → Supabase`: mecânico.** `scripts/sync.ts`, idempotente, incremental
  por hash, disparado por git hook.

Como corolário, o repositório do Odin **nunca contém conteúdo do vault**. A separação está
no limite de repositório, não numa convenção.

## Consequências

### O que ganhamos

- **Impossível poluir o segundo cérebro.** Nenhum bug, alucinação ou run malfeito de
  agente pode corromper o conhecimento — o caminho de escrita simplesmente não existe.
- Reversibilidade total: git é o histórico, markdown é legível sem o Odin, e o índice se
  reconstrói.
- Portabilidade: o vault sobrevive à morte do Odin. Se o projeto acabar amanhã, o
  conhecimento não perde nada.
- Confidencialidade é aplicável num ponto só: `HARD_EXCLUDE` em `lib/vault.ts` bloqueia
  `it-lean-confidencial` no sync **e** na leitura de nota.

### O que estamos pagando por isso

- **O Odin não aprende sozinho.** Toda memória nova passa por curadoria humana. Existe uma
  latência de conhecimento entre "o Gabriel percebeu algo" e "o Odin sabe".
- Ele não consegue capturar nada durante a conversa. Um insight que aparece no chat
  evapora, a menos que o Gabriel o escreva à mão no vault depois.
- O `writeObsidianNote` do roadmap **revoga este ADR**, não o estende. Fica registrado
  como ambiguidade aberta ([`ESTADO.md`](../ESTADO.md) §3.3) exatamente para que essa
  decisão não entre por deriva.

### O ponto não óbvio

O custo acima parece uma limitação e é, em parte, o produto. O valor do vault não está no
volume — está no **filtro**. O Salto A é curadoria humana *de propósito*: é o Gabriel
decidindo o que merece virar conhecimento. Automatizá-lo destruiria exatamente o que faz o
segundo cérebro valer mais que um histórico de chat. Por isso o [ADR-0009](./0009-regra-do-turno.md)
classifica "Aprendizado" como o **não** mais forte para virar workflow: ali um agente
pioraria o sistema.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| **Supabase como fonte, Obsidian como cliente** | Perde git, perde legibilidade sem o app, perde portabilidade. O conhecimento passaria a depender da infraestrutura |
| **Fluxo bidirecional com resolução de conflito** | Complexidade grande para um usuário único, e abre o caminho de escrita que este ADR existe para fechar |
| **Odin escreve numa área de staging** (`inbox/`) para revisão posterior | A alternativa mais defensável, e a que deve ser reavaliada primeiro se o `writeObsidianNote` voltar à mesa. Descartada agora por escopo: exigiria um ritual de revisão que ainda não existe |
| **Indexar `raw/` junto com `wiki/`** | Triplicaria o volume com material não curado e afundaria a precisão. `INGEST_DIRS` default `wiki` é a decisão em código |

## Como saber que esta decisão envelheceu

- Quando a latência de curadoria virar dor medida — o Gabriel repetindo ao Odin coisas que
  já disse porque nunca teve tempo de escrever no vault.
- Se isso acontecer, a resposta **não é** liberar escrita direta: é a área de staging
  descartada acima, com o ritual de revisão como pré-requisito, e um ADR novo que
  substitui este.

## Referências

- Analogia do negativo e os dois saltos: [`GUIA-DIDATICO.md`](../GUIA-DIDATICO.md) §12
- [ADR-0010](./0010-metadado-do-frontmatter.md): por que a taxonomia do vault é do Gabriel, não do sistema
