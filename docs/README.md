# 📚 Documentação do Odin

Cada documento responde **uma** pergunta. Se você não sabe onde escrever algo, é porque
ainda não sabe qual pergunta está respondendo.

| Doc | Responde | Pra quem |
|---|---|---|
| **[ESTADO.md](./ESTADO.md)** | **O que** existe, falta e está ambíguo — hoje | Qualquer um antes de planejar. Toda afirmação cita `arquivo:linha` |
| **[adr/](./adr/)** | **Por que** foi decidido assim, e o que foi descartado | Você daqui a seis meses. E entrevistador |
| **[PRD.md](./PRD.md)** | **Para que** o Odin existe — propósito, usuário, princípios | LLM carregando contexto; feedback de produto |
| **[BACKLOG.md](./BACKLOG.md)** | **O que vem depois**, sequenciado por impacto | Quando sobrar tempo e faltar clareza |
| **[EVAL.md](./EVAL.md)** | **Como saber** se o agente está bom | Antes de mexer em qualquer prompt |
| **[GUIA-DIDATICO.md](./GUIA-DIDATICO.md)** | **Como explicar** para quem não é da área | Base do roteiro de vídeo; leigos. Marca com ⛔ o que ainda não existe |
| **[GUIA-LANGGRAPH.md](./GUIA-LANGGRAPH.md)** | Material didático sobre LangGraph | Estudo. As *decisões* que estavam nele agora vivem em `adr/` |

---

## Regras de manutenção

**Ao entregar uma feature:** atualize o `ESTADO.md` (§1 ganha linha, §2 perde linha) e o
`GUIA-DIDATICO.md` (o conceito, em linguagem de leigo).

**A cadeia de derivação é uma via de mão única:** `código → ESTADO.md → GUIA-DIDATICO.md`.
O guia nunca descreve o que o ESTADO não confirma, e o material de divulgação — roteiro de
vídeo e deck, que vivem fora do versionamento (ver `.gitignore`) — nunca inventa capacidade
que o guia não descreve. Foi assim que o roteiro v1 acabou prometendo voz "sem API paga" —
o TTS é OpenAI e é pago desde sempre.

**Ao tomar uma decisão que tinha alternativa:** escreva um ADR. Se não havia alternativa,
não é decisão — é fato, e fato mora no `ESTADO.md`.

**Ao fechar uma ambiguidade** do `ESTADO.md` §3: escreva o ADR e remova o item.

**Quando o `ESTADO.md` e o `PRD.md` divergirem:** o `ESTADO.md` está certo. Ele descreve o
código; o PRD descreve a intenção. Intenção desatualizada é normal — descrição
desatualizada é mentira.

## A regra que este projeto aprendeu do jeito difícil

Em 2026-08-11 uma auditoria encontrou o `README.md` afirmando cinco features que o código
não tinha — incluindo "link WhatsApp com mensagem pré-carregada", quando o `?text=` nunca
existiu. Nenhuma foi mentira deliberada: o código andou e a documentação não.

**Documentação que promete mais do que o código entrega é pior que documentação nenhuma**,
porque quem conferir não vai concluir "está desatualizado" — vai concluir "esse cara
exagera". Num projeto que também é portfólio, esse é o pior resultado possível.

Daí o `ESTADO.md` e a regra de citar `arquivo:linha`: um documento que só afirma o que dá
para conferir abrindo o arquivo.
