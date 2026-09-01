# 🧠 Guia Didático — Como o Odin Funciona (do zero, pra qualquer um entender)

> **Documento vivo.** Última atualização: **2026-08-26** — cobre até o workflow
> multi-agente de prospecção (LangGraph) e o enriquecimento via Firecrawl.
>
> **Pra quem é:** pra mim (Gabriel) reforçar AI engineering, arquitetura e harness — e pra
> virar roteiro de vídeo. Por isso a linguagem é de leigo, com analogias.
>
> **Regra de honestidade:** este guia explica **como o Odin funciona hoje**, não como ele
> foi sonhado. Quando algo ainda não existe, está marcado com ⛔. O retrato verificado, com
> `arquivo:linha`, mora em [`ESTADO.md`](./ESTADO.md) — se os dois divergirem, o ESTADO
> está certo.

---

## Índice

**Parte 1 — O que é e por que existe**
1. O que é o Odin, afinal? · 2. As duas metades do Odin

**Parte 2 — A arquitetura (o encanamento)**
3. O restaurante · 4. As 4 camadas · 5. O ciclo de uma mensagem · 6. Streaming · 7. O motor trocável

**Parte 3 — A memória (o segundo cérebro)**
8. RAG · 9. Embeddings · 10. Banco vetorial · 11. Chunks · 12. Fonte de verdade vs projeção

**Parte 4 — As mãos (agir no mundo)**
13. Function calling · 14. Harness: tools, skills, MCP, subagentes

**Parte 5 — O time de agentes (LangGraph)**
15. Por que um grafo · 16. Os 6 nós da prospecção · 17. A Regra do Turno · 18. LLM pensa, código manda · 19. Humano no meio (HITL) · 20. Checkpoint · 21. Fallback em cascata

**Parte 6 — Honestidade e método**
22. O que ainda está quebrado · 23. A jornada até aqui · 24. Como isso vira dinheiro · Glossário

---

# PARTE 1 — O que é e por que existe

## 1. O que é o Odin, afinal?

Imagina o **Jarvis** do Homem de Ferro: você fala, ele entende, responde, **age** e lembra
de tudo que você já fez. O **Odin** é a versão real e caseira disso — um assistente de IA
pessoal que é, ao mesmo tempo, uma **versão externa do meu cérebro** e um **funcionário
que executa tarefas chatas**.

Hoje ele já:

- Tem uma **interface tipo cockpit** — tela escura, robô 3D no fundo, você digita ou fala.
- **Conversa** de verdade, em streaming, usando uma IA (o Gemini, do Google).
- **Lembra das minhas anotações** — lê meu vault do Obsidian antes de responder (RAG).
- **Ouve e fala** — microfone com transcrição ao vivo, resposta em áudio.
- **Executa ações** — busca no segundo cérebro, lê nota inteira, busca na web, consulta a
  previsão de surf.
- **Orquestra um time de agentes** — um pipeline que sai, encontra empresas reais, lê o
  site de cada uma, pontua, escreve a mensagem de abordagem e **para pra eu aprovar**.

Essa última capacidade é a que muda o jogo, e é por isso que ela ganhou a Parte 5 inteira
deste guia. Um chatbot bonito é brinquedo. Um sistema que **traz cliente** é ferramenta.

## 2. As duas metades do Odin

O Odin não é um app só. São dois modos de trabalho, e a diferença entre eles é o conceito
mais importante de arquitetura de agentes que existe hoje (§17):

| | **Modo Chat** | **Modo Agents** |
|---|---|---|
| O que é | Conversa com o segundo cérebro | Pipeline de prospecção B2B |
| Como responde | Palavra por palavra, na hora | Passo a passo, por etapa |
| Quanto dura | Segundos | Minutos — e pode dormir e continuar amanhã |
| Analogia | Conversar com um assistente | Delegar uma tarefa pra uma equipe |
| Onde vive | `lib/ai/chat.ts` | `lib/workflows/` |

Na interface são duas abas. Por dentro são dois mecanismos completamente diferentes.

---

# PARTE 2 — A arquitetura (o encanamento)

## 3. A arquitetura em uma analogia: o restaurante 🍽️

Todo app como o Odin tem duas metades. A melhor forma de entender é pensar num restaurante:

| No restaurante | No Odin | O que faz |
|---|---|---|
| **Salão / garçom** | **Frontend** (o que você vê no navegador) | Recebe seu pedido, mostra a comida bonita na mesa |
| **Cozinha** | **Backend** (o servidor) | Onde a comida é *de fato* preparada, longe dos olhos do cliente |

Por que separar? Porque tem coisa que **não pode ir pro salão**. Exemplo: a **chave da
API** da IA (uma espécie de senha que custa dinheiro a cada uso). Se ela fosse pro
navegador, qualquer um abriria o "código-fonte" da página e roubaria. Então ela fica **só
na cozinha**.

👉 **Conceito-chave:** *frontend = o que o usuário vê; backend = onde os segredos e o
trabalho pesado acontecem.*

## 4. As 4 camadas do Odin

Pensa em camadas como os andares de um prédio. Cada uma tem um trabalho:

1. **🖥️ Cockpit (interface)** — a tela. Robô 3D, campo de digitar, balões de conversa,
   painel do workflow.
2. **🔌 API (porta de entrada do backend)** — recebe sua mensagem e devolve a resposta.
3. **🤖 Cérebro de IA** — quem realmente pensa (o Gemini).
4. **📚 Memória (RAG)** — onde o Odin "lê suas anotações" antes de responder.

E, por cima disso, uma quinta que só existe no modo Agents: **🔗 a orquestração** (o grafo
LangGraph, Parte 5).

## 5. Conceito: como uma mensagem viaja (o ciclo completo)

Quando você digita "quem é você?" e aperta Enter, acontece isto:

```
VOCÊ digita  →  [Cockpit] manda a mensagem pela "porta" (API)
             →  [API] entrega pro "Cérebro de IA"
             →  [Cérebro] (antes de responder) consulta a [Memória]
             →  [Cérebro] gera a resposta, palavra por palavra
             →  [API] devolve essas palavras pro [Cockpit]
             →  VOCÊ vê a resposta aparecendo em tempo real
```

É exatamente o garçom levando o pedido pra cozinha e voltando com os pratos — só que em
milissegundos.

## 6. Conceito: Streaming (por que a resposta aparece letra por letra) ⌨️

**Analogia:** é a diferença entre:

- **Carta** 📬 — você espera o texto inteiro ficar pronto e recebe de uma vez.
- **Conversa ao vivo** 🗣️ — a pessoa vai falando e você já vai ouvindo.

Tecnicamente: em vez de esperar a IA terminar de pensar tudo, a gente vai **enviando cada
pedacinho** assim que sai. Bônus: evita "timeout" (a conexão cair por demorar demais).

Guarda esse conceito, porque em §17 ele volta como **preço a pagar**: o grafo de agentes
**não** streama token a token. Toda vez que você escala pra orquestração, troca sensação
de tempo real por durabilidade.

## 7. Conceito: o "motor trocável" (design agnóstico de provider) 🔧

O Odin começou usando a IA da **Anthropic (Claude)**. Depois trocamos pro **Gemini**.
Quanto código mudou na tela e na API? **Zero.**

**Analogia:** é como um carro onde você troca o **motor** sem mexer no volante, nos pedais
ou no painel. O motorista nem percebe.

Toda a lógica de IA vive **isolada em um arquivo só** (`lib/ai/chat.ts`). Esse arquivo é o
"motor". A tela e a API só sabem: *"manda a pergunta, recebe a resposta em pedaços"*. Não
sabem (nem precisam saber) se por trás é Claude, Gemini ou GPT.

Prova viva disso: quando o Gemini dá erro, o Odin **cai sozinho** pro `gpt-4o-mini` da
OpenAI no meio da conversa, e a tela não muda uma linha. (Com um detalhe honesto: o
fallback roda **sem as ferramentas** — ver §22.)

👉 **Isso se chama baixo acoplamento** — as peças não ficam grudadas umas nas outras. É a
diferença entre "sei usar a API do Gemini" e "sei desenhar um sistema".

---

# PARTE 3 — A memória (o segundo cérebro)

## 8. Conceito: RAG — dando memória pro Odin 📚

IA sozinha é tipo um gênio que **nunca te conheceu**. Sabe muito do mundo, mas **nada
sobre você** — seus projetos, suas decisões, suas anotações.

**RAG** (Retrieval-Augmented Generation) resolve isso. Em português claro: **antes de
responder, o Odin lê suas anotações relevantes e usa elas na resposta.**

**Analogia:** é a diferença entre:

- **Prova de cabeça** 🤔 — o aluno responde só com o que decorou (pode errar, inventar).
- **Prova com consulta** 📖 — o aluno abre o material certo na hora e responde com base
  nele.

Ou ainda: um **estagiário que, antes de te responder, corre na sua pasta de anotações, lê
os 6 trechos mais relevantes, e só então fala** — citando de onde tirou.

👉 É isso que transforma o Odin de "um chat com Gemini" em **o seu segundo cérebro**.

## 9. Conceito: Embeddings — transformando texto em coordenadas 🗺️

Como o Odin acha "os trechos relevantes"? Ele não faz Ctrl+F procurando palavra igual. Ele
procura por **significado**. E pra isso usa **embeddings**.

**Embedding** = transformar um texto em uma **lista de números** (uma "coordenada") que
representa o **significado** dele.

**Analogia:** imagina um **mapa gigante de ideias**. Nesse mapa:

- "surfe" e "prancha" ficam **pertinho**.
- "surfe" e "imposto de renda" ficam **muito longe**.

Cada texto vira um **ponto** nesse mapa. Pra achar o relevante, o Odin transforma a
**pergunta** em ponto também e procura **os pontos mais próximos**. É um GPS de
significados.

(No Odin cada trecho vira uma coordenada de **768 números** — `gemini-embedding-001`
truncado pra 768 dimensões. Um mapa de 768 dimensões é impossível de imaginar
visualmente, mas a matemática de "perto/longe" funciona igual.)

## 10. Conceito: banco de dados vetorial (pgvector) 🔍

Onde guardamos esse mapa? Num **banco vetorial**: **Supabase** com a extensão **pgvector**.

**Analogia:** uma **biblioteca**.

- Biblioteca normal: organizada por ordem alfabética. Pra achar algo, você precisa saber o
  título exato.
- Biblioteca vetorial: organizada **por significado**. Você chega e diz "quero algo sobre
  liberdade financeira" e ela te entrega os textos mais próximos *daquela ideia* — mesmo
  que nenhum tenha esse título.

## 11. Conceito: Chunks — por que quebramos os textos 🧩

A gente não joga cada anotação inteira no mapa. Quebra em **pedaços** (chunks) de ~1200
caracteres.

**Analogia:** procurar uma informação num **livro inteiro** vs nas **páginas certas**. Se
você indexa o livro todo como um ponto só, a busca fica "borrada" (o livro fala de 10
assuntos). Indexando página por página, você aponta o parágrafo exato.

Hoje o `wiki/` tem cerca de **100 notas**, e cada uma vira vários chunks. O `npm run sync`
é incremental: ele calcula uma **impressão digital** (hash) do texto de cada nota e só
reindexa o que mudou.

⛔ **Limitação honesta:** o corte é cego a markdown — ele parte no caractere 1200, mesmo se
isso rasgar uma tabela no meio. E a busca não tem nota de corte: ela sempre traz 6 chunks,
até quando você diz "e aí, tudo bem?" (`ESTADO.md` §2, itens 5 e 7).

## 12. Fonte de verdade vs projeção (o conceito que separa amador de sênior) 🎞️

Onde "mora" o seu conhecimento? Essa é a decisão de arquitetura mais importante — e a mais
fácil de errar.

**Regra de ouro:** o conhecimento mora no **vault Obsidian** (markdown + git). Tudo o mais
é **projeção descartável**.

**Analogia:** o markdown é o **negativo do filme** 🎞️. O Supabase é uma **cópia revelada**
pra facilitar a busca. Queimou a cópia? Você revela outra do negativo (um comando). Mas se
jogar fora o negativo e guardar só a cópia, perdeu pra sempre.

O dado flui **só ladeira abaixo**, nunca pra cima:

```
seu cérebro → Obsidian (markdown/git) → wiki/ → embeddings → Supabase → Odin
   FONTE DE VERDADE  ─────────────────────►   PROJEÇÕES DESCARTÁVEIS
```

Por que "Supabase como fonte única" seria uma armadilha:

- **Soberania:** conhecimento de vida em markdown portátil, seu, pra sempre — sem refém de
  vendor.
- **Reconstruível:** perdeu o banco? Um comando reconstrói tudo.
- **Versionado:** o git dá o histórico de cada mudança.

### Os dois "saltos" (um é mecânico, o outro é humano)

| Salto | O quê | Natureza | Como acontece |
|---|---|---|---|
| **A — Obsidian → `wiki/`** | destilar notas soltas em conhecimento curado | 🧠 **Intelectual** (precisa do seu julgamento) | ritual "INGEST" numa sessão de IA dentro do vault |
| **B — `wiki/` → Supabase** | indexar pra busca | 🤖 **Mecânico** (100% automatizável) | `npm run sync`, disparado por um git hook no commit |

O Salto B é automático: **toda vez que eu commito uma mudança no `wiki/`, o Odin se
atualiza sozinho.** Eu só faço a parte que exige cérebro. É a ideia central do método
Karpathy: *você faz a curadoria e pensa; a IA faz o resto.*

E tem uma decisão de projeto que reforça isso: **o Odin não escreve no vault.** É regra
dura ([ADR-0002](./adr/0002-vault-fonte-de-verdade.md)). Se um dia escrever, deixa de ser
projeção e passa a ser fonte concorrente. É a diferença entre um espelho e um segundo
original.

---

# PARTE 4 — As mãos (agir no mundo)

## 13. Conceito: Function calling — dando mãos pro modelo 🛠️

Até aqui o Odin só **falava**. Function calling é o que deixa ele **fazer**.

**A mecânica, sem jargão:** junto com a pergunta, o backend manda pro modelo uma **lista
de ferramentas** — cada uma com nome, descrição e que informação ela precisa. O modelo não
executa nada; ele **pede**: *"executa `searchSecondBrain` com a busca 'decisão de stack do
Aurea'"*. O código executa, devolve o resultado, e o modelo continua a resposta com o dado
na mão.

**Analogia:** é um chef que não sai da cozinha. Ele grita o pedido ("me traz o peixe do
freezer") e alguém executa. O chef pensa; as mãos são do sistema. Isso é **de propósito**:
o modelo nunca toca no mundo direto, então tudo que ele faz passa pelo seu código — que é
onde você coloca as travas.

As 4 ferramentas do Odin hoje (`lib/ai/tools.ts`):

| Ferramenta | O que faz |
|---|---|
| `searchSecondBrain` | busca semântica no vault |
| `readObsidianNote` | lê uma nota inteira (com guarda de confidencialidade e de path) |
| `webSearch` | busca na web via Tavily |
| `getSurfForecast` | previsão de surf e tempo em Peruíbe/SP |

Dois detalhes que são pura engenharia, não IA:

- **Teto de 5 rodadas** (`MAX_TOOL_TURNS`) — sem isso, o modelo pode ficar chamando
  ferramenta pra sempre. Loop infinito custa dinheiro real.
- **Na última rodada, as ferramentas são removidas.** É como tirar o cardápio da mesa pra
  forçar o cliente a pedir: sem tools disponíveis, o modelo é obrigado a produzir texto.

## 14. Conceito: o "harness" — a oficina do agente 🏗️

Esse conceito vale ouro pra quem quer entender **AI engineering de verdade**. Quando eu uso
o **Claude Code** pra construir o Odin, eu estou usando um **harness**.

**Harness** = a oficina ao redor do modelo. O modelo sozinho só sabe **gerar texto**. O
harness dá **mãos, manuais e regras** pra ele agir no mundo.

| Peça do harness | O que é | Analogia | No Odin, concretamente |
|---|---|---|---|
| **Tools** | ações que a IA executa (ler arquivo, rodar comando, buscar na web) | as ferramentas na bancada | as 4 tools do §13 — e, no Claude Code, ler/editar arquivo e rodar terminal |
| **Skills** | manuais especializados que a IA carrega **só quando precisa** | manuais técnicos na estante | `.agents/skills/supabase/` — boas práticas de Postgres que só entram em cena quando o assunto é banco |
| **MCP** | tomada-padrão pra plugar serviços externos | tomada universal | `.mcp.json` pluga o **MCP do Supabase**: a IA administra o banco direto |
| **Subagentes** | ajudantes com contexto próprio pra tarefas paralelas | terceirizar um pedaço do serviço | um agente varre o código enquanto o principal segue escrevendo |
| **Regras do projeto** | o que a IA **precisa** saber antes de escrever a primeira linha | as normas afixadas na parede da oficina | `AGENTS.md` + os ADRs em `docs/adr/` |

### Skills: o conceito mais subestimado dos três

Uma skill é um arquivo markdown com instruções que a IA lê **sob demanda**. Nem tudo cabe
no contexto ao mesmo tempo — então em vez de despejar tudo, você deixa na estante e a IA
pega o manual certo.

O melhor exemplo não está nem no Odin: **este guia e o roteiro do vídeo saem de skills
minhas** (`youtube`, `roteiro`, `curtos`) que carregam meu posicionamento, meus dados reais
de analytics e as fórmulas de título que já funcionaram no meu canal. É conhecimento meu,
versionado, que a IA usa como manual. Uma skill é **você, escrito num arquivo**.

### MCP em uma frase

Antes do MCP, cada integração era um adaptador feito à mão. O MCP é um **padrão de
tomada**: o Supabase publica um servidor MCP, eu declaro num arquivo, e pronto — a IA
enxerga meu banco. Mesma coisa pra Notion, GitHub, Gmail.

👉 **A grande sacada do AI engineering moderno:** o pulo do gato não é o modelo ser
inteligente — é o **harness** ao redor dele ser bem feito. Ferramentas boas, manuais bons,
limites claros. **Modelo é commodity; harness é onde mora a engenharia.**

---

# PARTE 5 — O time de agentes (LangGraph)

Aqui o Odin deixa de ser assistente e passa a ser **operação**. Este é o módulo mais novo
e o mais valioso — é o que gera contrato.

## 15. Por que um grafo (e não um prompt gigante)

A tarefa: *"encontre pizzarias em Itanhaém que precisam de automação, avalie cada uma,
escreva a mensagem de abordagem e me deixe aprovar antes de qualquer contato."*

Isso **não** cabe num prompt só. Três motivos:

1. **Contexto entupido.** Empilhar pesquisa + extração + avaliação + rascunho no mesmo
   contexto degrada a atenção do modelo. Ele começa a esquecer o começo.
2. **Nenhuma previsibilidade.** Um prompt genérico pula etapa — escreve a mensagem antes
   de avaliar se o lead presta.
3. **Não dá pra pausar.** E pausar é obrigatório: eu preciso ler a mensagem antes de ela
   ir pro WhatsApp de um estranho.

**Analogia:** um prompt gigante é pedir pra **uma pessoa** fazer pesquisa de mercado,
análise, redação e aprovação sozinha, de cabeça, sem anotar nada. Um grafo é montar uma
**linha de produção**: cada estação faz uma coisa, faz bem, e passa adiante — e a ficha da
peça (o **estado**) anda com ela.

Os três nomes que você precisa saber:

- **Estado** — a ficha compartilhada. Quem já foi encontrado, quem foi avaliado, com que
  nota, com que mensagem.
- **Nós** — as estações. Cada uma lê a ficha e devolve só o campo que mudou.
- **Arestas** — os trilhos. Quem vai pra onde depois.

## 16. Os 6 nós da prospecção

```
START → supervisor → researcher  (Apify/Google Maps: QUEM existe, menos os já contatados)
      → supervisor → enricher    (Firecrawl: COMO é o site de cada um)
      → supervisor → qualifier   (1 chamada em batch: nota de 0 a 10 sobre fato)
      → supervisor → copywriter  (1 chamada em batch: a mensagem de cada lead)
      → supervisor → human_review → interrupt ⏸ → [eu aprovo] → supervisor → END
```

| Nó | Papel | Analogia |
|---|---|---|
| **Supervisor** | decide quem age agora — puro `if/else`, **zero IA** | o encarregado da linha, com a prancheta |
| **Researcher** | descobre **quem existe** e corta quem já foi contatado | o batedor que traz a lista de rua |
| **Enricher** | abre o site de cada lead, em paralelo | o olheiro que visita a loja antes de opinar |
| **Qualifier** | dá nota de 0 a 10 com base no site real | o analista de crédito |
| **Copywriter** | escreve a mensagem de cada um, máximo 5 linhas | o vendedor que sabe escrever |
| **Human Review** | **para tudo** e espera minha aprovação | o gerente que assina embaixo |

**Por que dois scrapers?** Não são concorrentes. O Apify **descobre** (o Google Maps é um
diretório fechado; nenhum scraper genérico lista "todas as pizzarias de Itanhaém"). O
Firecrawl **enriquece** (a web é aberta e a gente já tem a URL). Descobrir e aprofundar são
trabalhos diferentes — ver
[ADR-0011](./adr/0011-apify-descoberta-firecrawl-enriquecimento.md).

E o detalhe que mais mudou a qualidade da saída: o Qualifier recebe **o conteúdo real do
site**, não a URL. Antes, "site desatualizado" era chute do modelo. Agora é leitura.

Um detalhe de custo que parece pequeno e não é: o Qualifier e o Copywriter fazem **uma
chamada para N leads**, não N chamadas. Vinte leads não custam vinte requisições — custam
uma, com a resposta correlacionada por índice.

## 17. A Regra do Turno: quando usar grafo e quando NÃO usar

Este é o insight que separa quem coleciona ferramenta de quem desenha sistema. O Odin tem
dois mecanismos de orquestração (§2) — e a escolha entre eles não pode ser estética.

> **Se o trabalho cabe num turno (uma pergunta → uma resposta), é loop de tools.
> Se ele precisa sobreviver ao turno, é grafo.**

**Três sintomas de que sobrevive ao turno:**

1. Tem **pausa humana** no meio.
2. Precisa **retomar** depois de o processo morrer.
3. Já **gastou dinheiro** ou causou efeito irreversível que uma nova tentativa repagaria.

**Quatro coisas que NÃO são motivo** (e é aqui que quase todo mundo erra):

- *"tem vários passos"* — o loop de tools tem cinco.
- *"tem ciclo"* — o loop de tools **é** um ciclo com estado.
- *"roda em paralelo"* — o loop de tools já dispara tools em paralelo.
- *"é outro assunto"* — assunto é metadado, não arquitetura.

**O preço da escalada:** o grafo **não streama** token a token. Você troca sensação de
tempo real por durabilidade. Se não precisava de durabilidade, você só piorou a experiência
e ganhou um monte de bug novo.

Aplicando a régua no Odin: **prospecção** passa com folga (os três sintomas juntos).
**Carreira, aprendizado, pessoal e surf** não passam — são conversa com ferramenta, e ficam
melhores no chat, porque streamam. Consultar a previsão de surf são duas chamadas HTTP;
virar "agente de surf" seria agente pelo agente.
[ADR-0009](./adr/0009-regra-do-turno.md).

**Analogia:** você não monta uma linha de produção pra fritar um ovo. Linha de produção é
pra quando o trabalho tem turno, pausa, e prejuízo se recomeçar do zero.

## 18. O bug que virou princípio: LLM pensa, código manda

Aconteceu de verdade, e é a lição mais cara do projeto.

**O que quebrou:** o Supervisor era um prompt. Depois de eu aprovar o lead #1, ele deveria
"passar pro próximo". Só que o ponteiro do lead continuava em `0` e os campos do lead
anterior continuavam preenchidos. O Qualifier reabria a posição `0` e **reavaliava o mesmo
lead pra sempre.** Cada volta era uma chamada paga.

**A causa raiz:** eu deleguei **contabilidade** pra um modelo de linguagem. Somar 1 num
contador e limpar um campo não é tarefa cognitiva — é tarefa mecânica, e prompt é o pior
lugar do mundo pra garantir mecânica.

**A correção — e o princípio que ficou:**

> **LLM para cognição. TypeScript para controle.**
> Pesquisa, avaliação e redação são do modelo. Roteamento, contadores, ponteiros e limpeza
> de estado são código.

Hoje o Supervisor é `if/else` puro, **zero IA**, com 7 caminhos — e todos são **derivados
do estado**, não de flag que alguém precisa lembrar de resetar. Se não existe lead, chama o
Researcher. Se tem lead com site não analisado, chama o Enricher. E assim por diante.
Nenhum caminho depende de memória; todos dependem de fato.
[ADR-0003](./adr/0003-supervisor-deterministico.md).

**Analogia:** ninguém contrata um filósofo brilhante pra ser o caixa. Não porque ele é
ruim — porque contar dinheiro não é o trabalho dele, e ele vai errar de um jeito criativo.

Tem uma segunda camada nesse bug, mais barata de explicar e mais caradura: sem lead
nenhum, o Supervisor mandava de volta pro Researcher, **indefinidamente** — pagando uma
chamada de 120 segundos por volta. A correção foi um contador de tentativas e uma saída
explícita. Guarda de loop não é detalhe: é a diferença entre um bug e uma fatura.

## 19. Human-in-the-loop: o freio de mão 👤

O nó `human_review` chama uma função do LangGraph chamada **`interrupt()`**. Ela faz uma
coisa que parece impossível: **congela o programa no meio**, salva tudo, e devolve o
controle pra interface. Quando eu clico em "Concluir", o grafo **volta exatamente daquele
ponto** — não do começo.

**Analogia:** é a maçaneta de emergência do trem. Não é "cancela tudo": é "para aqui,
espera o humano, continua de onde parou".

**Por que isso importa mais do que parece:** a etapa seguinte é falar com um ser humano
real no WhatsApp dele. Isso é **irreversível**. Mensagem enviada não volta. Toda vez que um
agente vai fazer algo irreversível — mandar mensagem, pagar, deletar, publicar — o padrão
certo é parar e pedir assinatura.

E aqui tem uma decisão de desenho que eu defendo com convicção: **o Odin não dispara a
mensagem.** Ele monta um link `wa.me` com o texto já dentro, e **eu clico**. Custo zero,
risco de ban zero, humano no loop por construção — e a mensagem continua parecendo digitada
no celular, que é a propriedade que faz ela funcionar. Automatizar o disparo antes de a
mensagem estar provada não escala vendas: escala queima de lead.

Consequência interessante: o grafo **não consegue saber** se eu enviei. Quem afirma o
contato é a interface, no clique — não o workflow. Sistema honesto é sistema que não afirma
o que não observou.

## 20. Checkpoint: por que o robô não esquece no meio 💾

Se o grafo pode pausar por horas, alguém tem que guardar o estado. Esse alguém é o
**checkpointer**: a cada transição de nó, ele salva um retrato.

**Analogia:** o save do videogame. Morreu? Volta do último save, não da primeira fase.

⛔ **Honestidade:** hoje o save é na memória RAM (`MemorySaver`). Se o servidor reinicia, o
workflow parado esperando revisão **morre**. O caminho pro Redis (save em disco de
verdade) está escrito no código, mas o pacote não está instalado. Está no roadmap, e é o
que separa "roda na minha máquina" de "roda em produção".

Detalhe divertido de dev: em desenvolvimento, o Next.js recarrega os módulos a cada arquivo
salvo — e isso **apagava os workflows em andamento**, porque criava um `MemorySaver` novo.
A solução foi ancorar o objeto no `globalThis`, o "porta-malas" global do Node que sobrevive
ao recarregamento. Um dos bugs mais confusos do projeto, e a correção tem três linhas.

## 21. Fallback em cascata: degradar sem cair (e sem mentir) 🪂

Nenhuma capacidade do Odin derruba o sistema quando falha. Ela **degrada**:

```
Descoberta de leads:   Apify  →  Tavily  →  mock
Enriquecimento:        Firecrawl  →  pula o nó (qualifica só com o Maps)
Cérebro do chat:       Gemini  →  gpt-4o-mini
Memória:               Supabase offline?  →  responde sem RAG
```

**Analogia:** é o gerador do hospital. A luz não apaga.

**Mas** — e esse "mas" é a parte que quase ninguém escreve — degradar em silêncio é
mentira de UX. O `webSearch` do Odin ficou em **modo mock por semanas** e ninguém notou: o
sistema respondia bonito, com dado inventado, sem nunca reclamar. Um sistema que nunca cai
é um sistema que nunca grita.

Daí a regra do projeto: **todo fallback ativado precisa aparecer no log e na tela.**
Fail-safe, sim. Fail-silent, nunca.
[ADR-0004](./adr/0004-fallbacks-em-cascata.md).

---

# PARTE 6 — Honestidade e método

## 22. O que ainda está quebrado (a parte que ninguém mostra) ⛔

Um guia que só lista vitória é folheto. As lacunas reais, com prioridade
([`ESTADO.md`](./ESTADO.md) §2):

| Lacuna | Por que importa |
|---|---|
| **Zero evals** | É o maior sinal de senioridade ausente. Hoje eu **acho** que o copywriter obedece as 10 regras; não **meço**. "Construí um multi-agente" é conversa de 2026; "meu agente tem 92% de aderência em 20 casos golden e a regressão quebra o build" é conversa de sênior. Especificado em [`EVAL.md`](./EVAL.md), não implementado |
| **`npm run lint` vermelho na `main`** | 15 erros. O único portão de qualidade que existe está quebrado — e como nada roda ele sozinho, ninguém tinha notado. Consertar **antes** de montar CI |
| **Zero teste automatizado** | Não existe nada entre "compila" e "está na main". E as funções mais críticas (o supervisor, a chave do lead, o link do WhatsApp) são puras: testar é montar um objeto e conferir a saída |
| **Frontmatter jogado no lixo** | Toda nota do vault tem metadado rico (tipo, status, data) e **nada disso** chega ao índice. O melhor sinal de busca do sistema vai pro lixo no ingest ([ADR-0010](./adr/0010-metadado-do-frontmatter.md)) |
| **Fallback do chat sem tools** | Quando cai pro `gpt-4o-mini`, o Odin perde as mãos e não avisa |
| **Checkpoint só em RAM** | Restart mata workflow pausado (§20) |

E a lição que gerou a regra deste guia: numa auditoria, o `README.md` afirmava **cinco
features que o código não tinha**. Nenhuma era mentira deliberada — o código andou e a
documentação não. **Documentação que promete mais do que o código entrega é pior que
documentação nenhuma**, porque quem confere não conclui "está desatualizado". Conclui
"esse cara exagera". Num projeto que também é portfólio, é o pior resultado possível.

## 23. A jornada até aqui (linha do tempo) 🚀

1. **Esqueleto** — cockpit (Next.js + React) e conversa básica em streaming.
2. **Visual imersivo** — robô 3D em tela cheia, interface de vidro, guiado por uma skill de
   UI/UX.
3. **Funcional** — troca pro Gemini, markdown na resposta, botão de parar.
4. **Cérebro (RAG)** — embeddings + banco vetorial + ingestão incremental do vault.
5. **Voz** — o Odin passou a ouvir (transcrição no navegador) e falar (áudio da OpenAI),
   com o brilho do robô pulsando no ritmo da fala.
6. **Mãos** — function calling com 4 ferramentas.
7. **Time de agentes** — o workflow de prospecção em LangGraph: 6 nós, supervisor
   determinístico, pausa humana, dados reais do Google Maps, leitura real dos sites,
   mensagem pronta e memória de quem já foi contatado. ← **você está aqui**
8. **Próximo** — evals, lint zerado, CI, e o checkpoint em Redis (deixar de rodar só na
   minha máquina).

### Sobre a voz, com precisão

- **Ouvir (STT)** — é o **próprio navegador**, de graça: a Web Speech API escuta o
  microfone e devolve texto ao vivo. Numa pausa natural, o Odin auto-envia.
- **Falar (TTS)** — aqui **não** é o navegador: é a API de voz da OpenAI (`tts-1`, voz
  onyx), porque a voz nativa do navegador soa robótica. **Isso custa dinheiro por
  caractere** — é uma troca consciente de custo por qualidade.
- **Meia-duplex** — o microfone é travado enquanto o Odin fala, senão ele se ouve e
  transcreve a própria voz. Detalhe bobo, arruma tudo.
- **Fila por frase** — ele começa a falar a primeira frase enquanto o resto ainda está
  sendo gerado.

## 24. Como isso vira dinheiro (o pulo do laboratório pra empresa) 💼

O Odin é meu laboratório vivo. Mas cada peça dele tem uma versão corporativa que empresa
paga pra ter — e é aqui que o projeto pessoal deixa de ser hobby:

| No Odin (pessoal) | Na empresa (pago) |
|---|---|
| RAG sobre meu vault do Obsidian | RAG sobre contrato, manual, base de suporte, jurisprudência |
| Prospecção que encontra pizzaria | Pipeline que qualifica lead do CRM ou triagem de currículo |
| Human review antes do WhatsApp | Aprovação humana antes de e-mail ao cliente, nota fiscal, disparo |
| Supervisor determinístico | O motivo de o agente não custar R$ 4.000 num loop de madrugada |
| Fallback em cascata | O motivo de a operação não parar quando um fornecedor cai |
| Evals ⛔ | O único argumento que faz um diretor confiar numa saída de IA |

**A parte que interessa:** a coisa difícil não é o RAG nem o grafo. É **saber quando não
usar** (§17), **onde parar pra pedir assinatura** (§19) e **o que medir** (§22). Isso não
se aprende em curso. Se aprende construindo algo que você usa todo dia — porque só assim o
sistema te cobra de verdade.

---

## 📕 Glossário rápido

- **Frontend:** a parte visual, no navegador.
- **Backend / servidor:** onde o trabalho pesado e os segredos ficam.
- **API:** a "porta" por onde frontend e backend conversam.
- **Streaming:** receber a resposta em pedaços, ao vivo.
- **Provider:** o fornecedor da IA (Anthropic, Google, OpenAI...).
- **RAG:** dar à IA suas anotações antes de ela responder.
- **Embedding:** transformar texto em coordenadas de significado.
- **Banco vetorial / pgvector:** biblioteca organizada por significado.
- **Chunk:** pedaço de um texto, pra busca precisa.
- **Function calling:** dar ferramentas executáveis pro modelo usar.
- **Harness:** a oficina (tools + skills + MCP + regras) ao redor do modelo.
- **Skill:** manual especializado que a IA carrega só quando precisa.
- **MCP:** tomada-padrão pra plugar serviços externos na IA.
- **Subagente:** ajudante com contexto próprio, pra tarefa paralela.
- **Grafo de estado (LangGraph):** linha de produção de agentes, com ficha compartilhada.
- **Nó:** uma estação da linha. Lê o estado, devolve o que mudou.
- **Estado:** a ficha que anda com a peça pela linha.
- **Supervisor:** o encarregado que decide a próxima estação — no Odin, código puro.
- **HITL (human-in-the-loop):** pausa obrigatória pra aprovação humana.
- **`interrupt()`:** a função que congela o grafo e espera o humano.
- **Checkpointer:** o "save" do grafo, pra retomar depois.
- **SSE:** o canal por onde o servidor empurra o progresso pra tela.
- **Fallback em cascata:** plano B, C e D pra nunca cair — que precisa avisar quando ativa.
- **Eval:** teste automatizado de saída de IA. O que separa "acho" de "meço".
- **ADR:** registro de uma decisão de arquitetura e do que foi descartado.
