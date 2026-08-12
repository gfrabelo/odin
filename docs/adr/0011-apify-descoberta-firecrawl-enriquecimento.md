# ADR-0011 — Apify descobre, Firecrawl enriquece

- **Status:** Aceita e implementada (T1, 2026-08-11)
- **Data:** 2026-08-11
- **Código afetado:** `lib/workflows/firecrawl.ts`, `lib/workflows/nodes/enricher.ts`, `lib/workflows/nodes/qualifier.ts`, `lib/workflows/prompts.ts`

## Contexto

Duas forças chegaram juntas.

**A primeira é uma mudança de estratégia comercial: prospecção com demo na mão.** Em vez
de mandar mensagem fria e torcer para o lead imaginar o valor, a ideia é construir uma
demo real por nicho — começando por uma chocolateria local — e abordar os demais negócios
do mesmo nicho com o artefato pronto. *"Não chegar de mãos vazias esperando que o lead
leia e deseje; já trazer o desejo."*

Isso só funciona se o pipeline souber **como é o negócio**, não apenas que ele existe.

**A segunda é um defeito de correção que a estratégia expôs.** O `QUALIFIER_PROMPT` dá
**+2 pontos** para "website desatualizado/ruim" — 2 de 10, 20% da rubrica. Mas
`qualifier.ts:64` entrega ao modelo apenas:

```
- Website: https://exemplo.com.br
```

**Nada no pipeline jamais abre esse site.** O modelo não tem como saber se está
desatualizado — então ele adivinha, e adivinha de forma sistemática (provavelmente
casando padrão no domínio: `wix.com` = ruim, domínio próprio = bom), o que é uma
heurística ruim disfarçada de score. Um quinto da qualificação é fabricado.

Um terceiro sintoma do mesmo buraco: o `COPYWRITER_PROMPT` manda mencionar a demo
casualmente (regra 6, beat 3 da estrutura mental) e os três exemplos de tom terminam em
*"já tenho um protótipo funcionando"*, *"Criei uma demo"*, *"funciona. tem demo."* — para
todo lead. Hoje isso é **falso**, e colide com a regra 9 do próprio prompt ("nunca invente
social proof"). O prompt foi escrito assumindo prospecção com demo; o pipeline nunca
entregou a demo. **A estratégia nova não adiciona uma feature — ela torna o copywriter
honesto pela primeira vez.**

## Decisão

**Apify e Firecrawl não competem. São estágios sequenciais do mesmo funil.**

> **Apify quando a fonte é uma plataforma fechada com diretório.**
> Google Maps, Instagram, LinkedIn, TikTok. Você não sabe quem existe e precisa de uma
> lista. O produto é **descoberta**.
>
> **Firecrawl quando a fonte é a web aberta e você já tem a URL.**
> Você já sabe quem é e precisa saber como é. O produto é **enriquecimento**.

A distinção é técnica, não de preferência: **Firecrawl não consegue substituir o Apify
aqui.** Não existe "crawleie o Google Maps e me dê todas as pizzarias de Itanhaém" — o
Maps não é um site crawleável nesse sentido, é um diretório atrás de uma aplicação. E
**Apify não consegue substituir o Firecrawl** sem virar um actor por tipo de site.

No pipeline:

```
researcher → Apify Google Maps ........... QUEM existe (nome, telefone, rating, URL)
enricher   → Firecrawl scrape da URL ..... COMO é (conteúdo, contato, atualidade)
qualifier  → agora pontua sobre fato ..... "site desatualizado" vira verificável
copywriter → gancho específico do negócio  não genérico do nicho
```

**O enriquecimento é um nó separado, não parte do `researcherNode`** — decidido na
implementação, por granularidade de checkpoint. O Apify custa dinheiro e leva até 120s;
fronteira de nó é fronteira de retry. Com o Firecrawl num nó próprio, os leads já estão
no checkpoint quando ele roda: se falhar e o grafo retomar, o Apify não é repagado.

### Consequência para a rubrica

Com o conteúdo real do site em mãos, `+2 por site desatualizado` deixa de ser palpite. E
abre critérios que hoje são impossíveis e valem mais que o palpite: tem loja online? é
responsivo? tem WhatsApp na página? última publicação de quando? A rubrica precisa ser
reescrita junto — não adianta melhorar o dado e manter o critério vago.

### Consequência para a estratégia de demo

Para construir **uma demo por nicho** que gere desejo, é preciso ver como são os sites
atuais daquele nicho. Isso é exatamente `crawl` + `extract` sobre 10–20 concorrentes.
Sem isso, a demo é um chute sobre o que o nicho acha bonito.

## Consequências

### O que ganhamos

- Um quinto da rubrica de qualificação deixa de ser alucinação.
- O copywriter ganha gancho **específico** ("vi que o cardápio de vocês tá em PDF") em vez
  de genérico do segmento. Essa é a diferença entre uma mensagem que parece disparo e uma
  que parece que alguém olhou.
- A regra 6 do `COPYWRITER_PROMPT` passa a ser verdade.
- Como bônus, o `/search` do Firecrawl pode substituir o Tavily no `webSearch`
  (`lib/ai/tools.ts`), consolidando dois fornecedores em um — hoje o Tavily nem chave tem,
  e a busca está em modo mock.

### O que estamos pagando por isso

- **Mais um fornecedor, mais uma chave, mais um caminho de falha.** Mitigado pelo
  [ADR-0004](./0004-fallbacks-em-cascata.md): sem chave ou em erro, o enriquecimento é
  pulado e o lead segue com os dados do Maps — degrada para o comportamento de hoje.
- **Latência.** Scrape tem P95 de ~3,4s por página segundo o fornecedor. Com 10 leads e
  metade tendo site, são ~5 scrapes. Devem ser **paralelos** (`Promise.all`), como o loop
  de tools já faz — sequencial adicionaria ~17s ao run.
- **Um novo ponto de gasto por lead**, ainda que pequeno (abaixo).

### Custo, nos números dele

Firecrawl cobra **1 crédito por página** para scrape/crawl/map, e o tier gratuito dá
**1.000 créditos/mês**. Num run de 10 leads com ~5 sites, são **5 créditos** — cerca de
**200 runs por mês dentro do plano gratuito**. Ele não chega perto do teto.

Duas armadilhas de preço que valem estar registradas:

1. **Páginas com stealth/anti-bot ou ações de browser custam 5 créditos**, não 1. Sites de
   PME brasileira em Wix/Cloudflare podem cair aí. Mesmo no pior caso (todos a 5), são 25
   créditos por run — 40 runs/mês no gratuito.
2. **O `extract` (extração estruturada por IA) é uma assinatura separada**, cobrada por
   token, a partir de ~$89/mês. **Não usar.** Fazer `scrape` → markdown e passar para o
   Gemini que já está no pipeline: o batch do qualifier já faz saída estruturada de graça,
   e pagar duas vezes por uma extração de LLM não faz sentido.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| **Trocar Apify por Firecrawl** | Firecrawl não descobre negócios num diretório fechado. Perderia a etapa de descoberta inteira |
| **Trocar Firecrawl por um actor de scraping do Apify** | Daria, mas o Apify é otimizado para scrapers por plataforma, não para "qualquer site". Saída bruta, sem markdown pronto para LLM, e um actor a manter |
| **`fetch` + parser de HTML caseiro** | Quebra em site com JS (a maioria dos construtores usados por PME), sem proxy, sem anti-bot. Semanas de manutenção para replicar mal o que custa centavos |
| **Usar o `extract` do Firecrawl** | Assinatura separada por token a partir de ~$89/mês para fazer o que o Gemini já faz no pipeline |
| **Continuar sem enriquecimento** | Mantém 20% da rubrica alucinando e o copywriter prometendo demo que não existe |

## Como saber que esta decisão envelheceu

- **Se mais de ~30% dos scrapes caírem no modo de 5 créditos**, o custo por run quadruplica
  e vale reavaliar (cache mais agressivo, ou só enriquecer leads acima de certo score).
- **Se o Apify passar a oferecer enriquecimento genérico de site bom o bastante**, some um
  fornecedor.
- **Se o volume passar de ~200 runs/mês**, sai do gratuito — momento de medir o custo real
  por lead fechado, não por lead scrapeado.

## Referências

- [ADR-0004 — Fallbacks em cascata](./0004-fallbacks-em-cascata.md): como o enriquecimento degrada quando falha
- [`ESTADO.md`](../ESTADO.md) §2: o defeito de rubrica que motivou isto
- Preços verificados em 2026-08-11 em [firecrawl.dev](https://www.firecrawl.dev/) e em análises de terceiros; **reconferir antes de assinar**, preço de fornecedor muda
