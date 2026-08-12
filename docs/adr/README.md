# Architecture Decision Records — Odin

Registro das decisões de arquitetura do Odin: **o que foi decidido, o que foi
descartado, e o que estamos pagando pela escolha.**

Um ADR não é documentação de como o sistema funciona — isso é o
[`ESTADO.md`](../ESTADO.md). ADR é o registro de uma bifurcação: havia mais de um
caminho, um foi escolhido, e a razão precisa sobreviver à memória de quem escolheu.

---

## Comece por aqui

Se você tem cinco minutos e quer entender como este projeto pensa, leia estes três:

| ADR | Por quê |
|---|---|
| **[0003 — Supervisor determinístico](./0003-supervisor-deterministico.md)** | A decisão mais cara do projeto, tomada depois de um bug de loop infinito em produção. Resume a regra que governa todo o resto: **LLM para cognição, código para controle** |
| **[0009 — A Regra do Turno](./0009-regra-do-turno.md)** | Quando escalar para LangGraph e quando não. O critério que evita construir agente por construir |
| **[0008 — Um cérebro, não cinco](./0008-um-cerebro-nao-cinco.md)** | Por que "domínio" (carreira, aprendizado, prospecção…) é metadado de recuperação e não fronteira de agente |

---

## Índice

| # | Título | Status | Data |
|---|---|---|---|
| [0001](./0001-contrato-agnostico-de-provider.md) | Contrato agnóstico de provider | Aceita | 2026-06-06 |
| [0002](./0002-vault-fonte-de-verdade.md) | Vault como fonte de verdade, fluxo unidirecional | Aceita | 2026-06-15 |
| [0003](./0003-supervisor-deterministico.md) | Supervisor determinístico, não roteador LLM | Aceita | 2026-08-03 |
| [0004](./0004-fallbacks-em-cascata.md) | Fallbacks em cascata, nunca derrubar a conversa | Aceita | 2026-06-20 |
| 0005 | Checkpointer ancorado no `globalThis` | Aceita | 2026-07-29 |
| 0006 | Qualificação em batch, não rotação lead-a-lead | Aceita | 2026-08-03 |
| 0007 | `wa.me` como sender, não API de WhatsApp | Aceita | 2026-07-30 |
| [0008](./0008-um-cerebro-nao-cinco.md) | Um cérebro, não cinco: domínio não é agente | Aceita | 2026-08-11 |
| [0009](./0009-regra-do-turno.md) | A Regra do Turno: quando escalar para LangGraph | Aceita | 2026-08-11 |
| [0010](./0010-metadado-do-frontmatter.md) | Metadado de recuperação vem do frontmatter, não do caminho | Aceita | 2026-08-11 |
| [0011](./0011-apify-descoberta-firecrawl-enriquecimento.md) | Apify descobre, Firecrawl enriquece | Aceita | 2026-08-11 |

**0005, 0006 e 0007 estão registrados mas não escritos por extenso.** A decisão e o
tradeoff estão resumidos abaixo; o documento completo entra quando alguém precisar
revisitar a decisão. ADR é registro, não ritual — quinze documentos escritos de uma
vez viram burocracia que ninguém lê.

<details>
<summary><strong>0005 — Checkpointer ancorado no <code>globalThis</code></strong></summary>

**Decisão:** o checkpointer é um singleton ancorado em `globalThis.__odinCheckpointer`,
com `MemorySaver` em dev e `RedisSaver` quando `REDIS_URL` existe.

**Contexto:** em `next dev`, cada salvamento de arquivo recriava o `MemorySaver`,
apagando workflows em voo — resume devolvia 404.

**Pagamos:** acoplamento a uma particularidade do dev server, e workflow parado em
revisão humana ainda morre num restart real. Aceito enquanto for single-user local.

**Envelhece quando:** um run precisar sobreviver a um deploy. Aí o Redis deixa de ser
opcional. Ver `lib/workflows/checkpointer.ts`.
</details>

<details>
<summary><strong>0006 — Qualificação em batch, não rotação lead-a-lead</strong></summary>

**Decisão:** uma única chamada estruturada qualifica todos os N leads e os ranqueia.

**Contexto:** o desenho v1 rodava um lead por vez, mantendo `currentLeadIndex` no
estado — que foi exatamente a fonte do bug de loop infinito do [ADR-0003](./0003-supervisor-deterministico.md).

**Ganhamos:** menos round-trips, e o modelo **compara** os leads entre si em vez de
julgar cada um no vácuo, o que produz ranking melhor.

**Pagamos:** o merge é posicional (`leads[i]` + `qualifications[i]`), então um array
desalinhado na resposta corrompe todas as qualificações em silêncio. E menos
profundidade por lead.

**Envelhece quando:** o batch passar de ~30 leads e a qualidade por lead cair, ou se
o desalinhamento posicional acontecer na prática. Ver `lib/workflows/nodes/qualifier.ts`.
</details>

<details>
<summary><strong>0007 — <code>wa.me</code> como sender, não API de WhatsApp</strong></summary>

**Decisão:** a ação externa é um deep-link `wa.me` que o humano clica, não uma
integração com Uazapi/Z-API.

**Ganhamos:** custo zero, zero aprovação de API, zero risco de ban — e humano no loop
**por construção**, não por política.

**Pagamos:** não escala, não automatiza, e o sistema **não consegue observar o envio**.
Essa última consequência é estrutural: o grafo só pode afirmar "encontrado" e
"qualificado"; "contatado" só pode ser afirmado pelo clique, na UI.

**Envelhece quando:** o volume de envios manuais por semana virar gargalo real medido,
não estimado.
</details>

---

## Como escrever um ADR novo

1. Copie o [`TEMPLATE.md`](./TEMPLATE.md) para `NNNN-slug-descritivo.md`.
2. Numeração é **cronológica e append-only**. Número não indica importância.
3. **ADR aceito é imutável.** Mudou de ideia? Escreva um novo que substitui o antigo
   e marque o antigo como `Substituída por ADR-XXXX`. O histórico de decisões erradas
   é metade do valor do registro.
4. Adicione a linha no índice acima.
5. Se a seção **Alternativas descartadas** ficar vazia, isso não era um ADR — era um
   fato. Mova para o [`ESTADO.md`](../ESTADO.md).

## Onde cada documento mora

| Documento | Responde |
|---|---|
| [`adr/`](.) | **Por que** foi decidido assim, e o que foi descartado |
| [`../ESTADO.md`](../ESTADO.md) | **O que** existe, falta e está ambíguo hoje |
| [`../PRD.md`](../PRD.md) | **Para que** o Odin existe — propósito, usuário, princípios |
| [`../BACKLOG.md`](../BACKLOG.md) | **O que vem depois**, sequenciado |
| [`../GUIA-DIDATICO.md`](../GUIA-DIDATICO.md) | **Como explicar** para quem não é da área |
| [`../../LANGGRAPH_MULTI_AGENT_GUIDE.md`](../../LANGGRAPH_MULTI_AGENT_GUIDE.md) | Material didático sobre LangGraph. As *decisões* que estavam nele agora vivem aqui |
