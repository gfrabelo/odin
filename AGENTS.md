<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes - APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Odin — convenções do projeto

## Leia antes de planejar

- **[`docs/ESTADO.md`](./docs/ESTADO.md)** — o que existe, falta e está ambíguo, com
  `arquivo:linha`. Metade das ideias boas já está lá, priorizada.
- **[`docs/adr/`](./docs/adr/)** — as decisões e o que foi descartado. Comece por
  [0003](./docs/adr/0003-supervisor-deterministico.md),
  [0009](./docs/adr/0009-regra-do-turno.md) e
  [0008](./docs/adr/0008-um-cerebro-nao-cinco.md).

Quando o `ESTADO.md` e qualquer outro documento divergirem, o `ESTADO.md` está certo.

## Comandos

```bash
npm run dev     # Next dev (Turbopack)
npm run build   # build de produção
npm run lint    # ESLint
npm run sync    # reindexa o vault → Supabase (incremental por hash)
```

Não há `test` nem `typecheck` ainda — é item T2 do [`BACKLOG.md`](./docs/BACKLOG.md).
Tipos só aparecem via `npm run build` ou no editor.

## Princípios que governam o código

**1. LLM para cognição, TypeScript para controle.**
Pesquisa, avaliação e copywriting são do modelo. Roteamento, contadores, ponteiros e
limpeza de estado são código. Esta regra nasceu de um bug de loop infinito em produção —
[ADR-0003](./docs/adr/0003-supervisor-deterministico.md).

**2. A Regra do Turno.**
Se o trabalho cabe num turno (uma requisição → uma resposta), é loop de tools
(`lib/ai/chat.ts`). Se precisa sobreviver ao turno — pausa humana, retomada após restart,
efeito caro já pago — é grafo. "Tem vários passos", "tem ciclo", "roda em paralelo" e "é
outro assunto" **não** são motivos. O grafo não streama; o chat streama.
[ADR-0009](./docs/adr/0009-regra-do-turno.md).

**3. Fail-safe, mas nunca em silêncio.**
Toda capacidade degrada em cascata em vez de lançar. Mas todo fallback ativado **precisa
aparecer** no log e na UI — degradar calado já produziu bug real (a busca web ficou em modo
mock por semanas). [ADR-0004](./docs/adr/0004-fallbacks-em-cascata.md).

**4. O vault é somente leitura.**
Dado flui `Obsidian → wiki/ → Supabase → Odin`, nunca para cima. O vault vive noutro
repositório (`../segundo-cerebro`) e nenhum código aqui escreve nele.
[ADR-0002](./docs/adr/0002-vault-fonte-de-verdade.md).

**5. Confidencialidade é hard guard, não convenção.**
`getHardExclude()` em `lib/vault.ts` bloqueia as pastas confidenciais no sync **e** na
leitura de notas, junto com o guard de path-traversal. A lista vem do default
(`confidencial`) somado a `VAULT_EXCLUDE`, e **falha fechado**: env vazio cai no default,
nunca em lista vazia. Não afrouxe nenhum dos dois guards, e não deixe o guard virar
lista vazia.

## Ao escrever código

- **pt-BR** em prompts, comentários, logs e texto de UI. O código é em inglês.
- Comentário explica **por que**, não o que. O padrão do repo é um bloco no topo do arquivo
  com o raciocínio de desenho — mantenha isso.
- Tomou uma decisão que tinha alternativa? Escreva um ADR
  ([`docs/adr/TEMPLATE.md`](./docs/adr/TEMPLATE.md)). Não tinha alternativa? Não é decisão,
  é fato — vai para o `ESTADO.md`.
