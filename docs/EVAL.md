# EVAL — especificação do harness

> **Status:** especificado, não implementado. Item T2.3 do [`BACKLOG.md`](./BACKLOG.md).
>
> **Meta de tamanho: ~150 linhas no total, zero dependência nova.** Se crescer além disso,
> virou framework e perdeu o propósito. O valor está em existir e rodar, não em ser completo.

---

## Por que isto antes de quase tudo

É o maior sinal de senioridade ausente no projeto, e o mais barato de instalar.

"Construí um multi-agente com LangGraph" é conversa de todo mundo em 2026. **"Meu agente de
copy tem 92% de aderência às regras em 20 casos golden, e a regressão quebra o build"** é
conversa de sênior — porque demonstra que você trata saída de LLM como algo que precisa ser
medido, não admirado.

O conceito já está estudado: `wiki/conceitos/eval-de-agente.md` existe no vault. O que falta
é a aplicação.

E tem um uso imediato e concreto: o [ADR-0010](./adr/0010-metadado-do-frontmatter.md)
propõe mudanças no RAG. Sem eval, não haverá como saber se melhoraram — só achismo.

## Estrutura

```
evals/
├── cases/
│   ├── copywriter.json     10 leads (5 segmentos × 2 tons)
│   ├── qualifier.json      10 leads com faixa de score esperada
│   └── retrieval.json      15 { pergunta, esperado: ["wiki/..."] }
├── rules/
│   └── copywriter.ts       asserções como predicados puros
├── baseline.json           últimas taxas de acerto registradas
└── run.ts                  runner
```

```json
"scripts": { "eval": "tsx evals/run.ts" }
```

`npm run eval` roda tudo; `npm run eval -- copywriter` roda um suite.

---

## 1. Aderência do copywriter às regras — comece por aqui

`COPYWRITER_PROMPT` tem 10 regras absolutas, e **nove delas são verificáveis por regex, sem
LLM juiz**. É a saída que vira dinheiro e a mais fácil de medir.

| Regra | Asserção |
|---|---|
| Máx. 5 linhas | `corpo.split('\n').filter(Boolean).length <= 6` |
| Zero palavra de folheto | não casa `/solução\|plataforma\|ecossistema\|sinergia\|robusto\|inovador\|disruptivo/i` |
| Máx. 1 emoji | contagem de emoji ≤ 1 |
| Não abre com o nome do negócio | a primeira linha não contém `lead.name` |
| Termina em micro-CTA | a última linha termina com `?` |
| Sem bloco de assinatura | não casa `/Engenheiro de Software\|Especialista em IA/i` |
| Sem prova social inventada | não casa `/já ajudei\|nosso cliente\|aumentei .* \d+%/i` |
| Sem corporativês | não casa `/prezado\|venho por meio\|aguardo seu retorno\|entre em contato/i` |

Determinístico, custa centavos, e protege exatamente o artefato que fecha contrato.

## 2. Consistência do qualifier — o mais elegante

`QUALIFIER_PROMPT` define uma rubrica **puramente aditiva**: `+3` sem site, `+2` site
desatualizado, `+2` segmento automatizável, `+1` rating ≥ 4.0, `+1` tem telefone, `+1`
localização acessível.

Ou seja: **dá para computar o score esperado em TypeScript a partir dos campos do lead** e
asseverar `|score_llm − score_esperado| <= 1`. A rubrica vira código; o LLM vira a coisa
sendo testada. Grátis e bonito.

Escrevendo esse eval você esbarra na lacuna §2.3 do [`ESTADO.md`](./ESTADO.md): `qualified`
vem do modelo em vez de ser derivado do score. Derive em código, tire o campo do
`responseSchema`, e o eval passa a ter uma coisa só para conferir.

## 3. Recall do RAG — o mais lento, e o árbitro

15 pares escritos à mão de `{ pergunta → nota que deveria aparecer }`. Assere
`esperado ⊆ retrieved.map(r => r.path)`.

Custa chamadas de embedding e depende do Supabase, então roda em comando separado.

**O trabalho real dele é ser árbitro das mudanças de RAG do T2.** Escreva os 15 casos
**antes** de mexer em `retrieve.ts`, para existir um número de antes. Sem isso, "melhorei o
RAG" é opinião.

---

## Dois detalhes que fazem a diferença entre eval de verdade e teatro

**Assere sobre taxa de acerto, não caso a caso.** Saída de LLM é estocástica; uma suíte que
falha por causa de um caso instável é ignorada em uma semana. Limiares:
`copywriter ≥ 90%`, `qualifier ≥ 80%`, `recall@6 ≥ 0.8`. Compare com `baseline.json` e saia
com código ≠ 0 **só em regressão** abaixo do limiar.

**Imprima qual regra falhou em qual caso.** Uma taxa de acerto sozinha não é acionável;
`"caso 7 (clínica): 6 linhas, esperado ≤5"` diz o que mudar no prompt.

## Casos golden: escreva à mão

Vinte casos escritos à mão valem mais que duzentos gerados. Os gerados herdam o viés do
gerador e testam o que o modelo já acha fácil. Os difíceis vêm de leads reais que saíram
errado — guarde-os conforme aparecerem.

---

## O que este harness deliberadamente não é

- **Não tem dashboard nem serviço.** Saída em tabela no terminal.
- **Não usa LLM como juiz.** Todas as asserções acima são determinísticas. Juiz-LLM entra
  só se surgir uma dimensão genuinamente subjetiva ("a mensagem soa humana?") — e aí com a
  consciência de que o juiz também precisa ser avaliado.
- **Não mira cobertura.** Mira as três saídas que, se degradarem, custam dinheiro ou
  credibilidade.
- **Não roda na CI no começo.** Custa chamadas de API. Rode à mão antes de mexer em prompt,
  e considere a CI quando o custo for conhecido.
