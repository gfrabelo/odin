# ADR-0010 — Metadado de recuperação vem do frontmatter, não do caminho

- **Status:** Aceita (implementação pendente — ver [`BACKLOG.md`](../BACKLOG.md) T2)
- **Data:** 2026-08-11
- **Código afetado:** `lib/vault.ts`, `scripts/sync.ts`, `lib/rag/retrieve.ts`, `lib/ai/tools.ts`, `supabase/schema.sql`

## Contexto

O [ADR-0008](./0008-um-cerebro-nao-cinco.md) decidiu que "domínio" é metadado de
recuperação. Este ADR decide **de onde esse metadado vem**.

Havia uma resposta óbvia e errada: derivar do caminho. `metadata.path` já é gravado em
`scripts/sync.ts` e tem o formato `wiki/<pasta>/<nota>.md` — bastaria pegar o segundo
segmento.

**Isso não funciona, e vale registrar por quê.** As pastas do `wiki/` codificam **tipo de
nota**, não assunto. Verificado no vault em 2026-08-11:

- `wiki/projetos/` contém `odin.md` (aprendizado), `canal-youtube.md` (conteúdo),
  `realocacao-2026.md` (carreira), `prospect-agent.md` (prospecção) e `reset-30-dias.md`
  (pessoal) — **cinco domínios numa pasta só**.
- `wiki/conceitos/` mistura `visao-2031.md` (pessoal) com `eval-de-agente.md`
  (aprendizado) e `tudo-e-venda.md` (negócio).

Derivar `dominio` do caminho produziria um campo chamado `dominio` contendo `tipo`. Isso é
pior do que não ter campo nenhum, porque *parece* funcionar: as buscas retornariam
resultados plausíveis e ninguém investigaria.

**O sinal de verdade existe, e está sendo jogado fora.** Toda nota do vault tem YAML
disciplinado e consistente:

```yaml
---
type: projeto
status: ativo
estagio: beta
ultima_atualizacao: 2026-08-10
fontes:
  - "[[sources/atualizacao-2026-08-10]]"
---
```

E `lib/vault.ts` → `stripFrontmatter()` **descarta tudo isso** antes tanto do
`scripts/sync.ts` quanto do `readNote()`. O metadado de recuperação mais rico do
sistema — escrito à mão, consistente em 94 arquivos — é destruído no ingest.

## Decisão

**Parsear o frontmatter no ingest em vez de descartá-lo, e derivar o escopo de
recuperação dele.**

- `tipo` sai de graça do `type:` que já existe em toda nota.
- `dominio` é uma **chave nova** que o Gabriel adiciona à convenção do vault quando
  quiser — sob o controle dele, no ritmo dele, coerente com o [ADR-0002](./0002-vault-fonte-de-verdade.md).
- `ultima_atualizacao` entra como metadado para desempate por recência.
- O caminho continua gravado, e passa a alimentar `tipo` como **fallback** quando a nota
  não tiver `type:`.

**Nota sem `dominio` continua recuperável em qualquer escopo.** Sem essa regra, no dia em
que ele taguear 10 notas as outras 84 sumiriam silenciosamente de toda busca escopada —
e ele nunca descobriria a causa.

O parser é escrito à mão (~40 linhas de regex sobre escalares e listas `- `, que é tudo
que o vault usa) e falha para `{}`. **Não adicionar `gray-matter` nem `yaml`**: uma
dependência que você não consegue depurar é pior que 40 linhas que você escreveu.

### Consulta

Escrever um `match_documents_scoped` novo em vez de reaproveitar o parâmetro `filter jsonb`
do `match_documents` existente. O `filter` usa contenção JSONB (`metadata @> filter`), que
expressa AND mas **não OR** — `dominio in ('carreira','prospeccao')` é inexprimível — e
não tem threshold de similaridade. Reaproveitá-lo custaria uma migração para chegar num
lugar de onde teríamos que sair.

O `match_documents` fica intacto para nada quebrar no meio da migração.

### Dois detalhes que a implementação não pode esquecer

1. **O diff do sync não vai perceber a mudança.** `scripts/sync.ts` compara
   `sha1(body)`, e adicionar chaves de metadado **não altera o body**. Um `npm run sync`
   depois dessa mudança diria "já está em dia" e nenhuma linha existente ganharia `tipo`.
   A correção é um backfill SQL de uma vez (custo zero de embedding), não re-indexar tudo.

2. **HNSW com `WHERE` é pós-filtro.** O índice devolve os vizinhos mais próximos e o
   filtro corta depois — então uma busca escopada pode retornar **menos que `match_count`**,
   ou nada, mesmo havendo documento relevante no domínio. Mitigação: super-dimensionar o
   `match_count` interno antes de filtrar.

### E não criar índice

94 arquivos → **~300 chunks** (315.678 chars com stride de 1050). Postgres varre 300
linhas em bem menos de 1ms e o planner ignoraria qualquer GIN que criássemos. Índice agora
seria cargo cult.

Em vez disso, registrar o gatilho num comentário do `schema.sql`: revisitar acima de ~50k
linhas. **Saber quando *não* indexar é a decisão; o comentário é o registro dela.**

## Consequências

### O que ganhamos

- O escopo de recuperação passa a refletir a taxonomia real do Gabriel, não uma heurística
  inventada sobre nomes de pasta.
- `tipo` é um ganho imediato e gratuito, e é mais útil do que parece: *"o que eu decidi
  sobre X?"* com `tipo: "decisao"` é uma consulta genuinamente melhor que busca semântica
  sobre tudo.
- `ultima_atualizacao` abre desempate por recência — relevante num vault onde teses mudam.
- `fontes` é um grafo de links esperando para ser usado.

### O que estamos pagando por isso

- **Cria uma convenção que o Gabriel precisa manter.** Se `dominio` for aplicado de forma
  inconsistente, o escopo fica pela metade. Em troca, a taxonomia fica sob controle dele.
- Um parser de YAML caseiro é uma superfície de bug nova, ainda que pequena e testável.
- Migração em dois passos (código + backfill SQL), com a armadilha do hash acima.

### O que este ADR *não* resolve

Sejamos honestos sobre a ordem de impacto: **o escopo por domínio é a mudança
arquiteturalmente interessante; o threshold de similaridade e o teto de chunks por arquivo
são as mudanças que realmente vão melhorar as respostas.** Hoje `retrieveContext` devolve
top-6 incondicional, então um "e aí, tudo bem?" injeta ~7.200 chars irrelevantes no
`systemInstruction` a cada turno — e sem teto por `path`, os 6 podem ser 6 chunks da mesma
nota. Ambos são ~15 linhas em `lib/rag/retrieve.ts` e devem entrar **no mesmo commit**.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| **Derivar `dominio` do caminho** | As pastas codificam tipo, não assunto — verificado. Produziria um campo que mente de forma plausível |
| **Reaproveitar o `filter jsonb` do `match_documents`** | Contenção JSONB não expressa OR, e não há threshold. Migração para um beco sem saída |
| **Adicionar `gray-matter`** | Dependência para resolver 40 linhas de regex sobre um formato que controlamos inteiramente |
| **Classificar domínio com LLM no ingest** | Custo por nota, resultado não determinístico, e tira do Gabriel o controle da própria taxonomia — contra o [ADR-0002](./0002-vault-fonte-de-verdade.md) |
| **Criar índice GIN em `metadata` junto** | 300 linhas. O planner ignoraria |

## Como saber que esta decisão envelheceu

- **~50k chunks:** revisitar índice (GIN em `metadata`, ou índices parciais por domínio).
- **Se o pós-filtro do HNSW passar a devolver menos resultados que o pedido na prática:**
  aí a solução é `hnsw.iterative_scan` (pgvector 0.8+) ou índice parcial por domínio.
- **Se `dominio` continuar vazio em mais de 30% das notas depois de três meses:** a
  convenção não pegou, e o escopo por domínio deveria ser abandonado em favor de investir
  só em threshold, recência e chunking.

## Referências

- [ADR-0008 — Um cérebro, não cinco](./0008-um-cerebro-nao-cinco.md): a decisão que este implementa
- [ADR-0002 — Vault como fonte de verdade](./0002-vault-fonte-de-verdade.md): por que a taxonomia é do Gabriel e não do sistema
- [`EVAL.md`](../EVAL.md): os 15 casos de recall precisam existir **antes** desta mudança, para haver número de antes
