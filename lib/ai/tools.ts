/**
 * Ferramentas (function calling) do Odin.
 *
 * Duas metades, mantidas lado a lado de propósito:
 *  - `odinFunctionDeclarations`: o CONTRATO que o Gemini lê para decidir SE/QUAL
 *    ferramenta chamar. A `description` é o que mais importa para a decisão.
 *  - `executeTool`: a EXECUÇÃO real no Node. Nunca lança — qualquer erro vira
 *    `{ error }` para o modelo se recuperar e seguir o stream.
 *
 * Todas as tools vivem no mesmo loop de resolução (ver `lib/ai/chat.ts`). Por isso
 * `webSearch` é uma função nossa (e não o tool nativo do Gemini): o Gemini não
 * permite misturar o `googleSearch` nativo com `functionDeclarations`.
 */
import { Type, type FunctionDeclaration } from "@google/genai";
import { readNote } from "@/lib/vault";
import { retrieveContext } from "@/lib/rag/retrieve";

export const odinFunctionDeclarations: FunctionDeclaration[] = [
  {
    name: "searchSecondBrain",
    description:
      "Busca semântica no segundo cérebro do Gabriel (vault Obsidian indexado). " +
      "Use SEMPRE que a pergunta tocar na vida, projetos, opiniões, metodologias, " +
      "decisões ou aprendizados do Gabriel. Retorna trechos relevantes com a fonte (path).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "O que buscar, em linguagem natural (pt-BR).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "readObsidianNote",
    description:
      "Lê o conteúdo COMPLETO de uma nota específica do vault Obsidian. " +
      "Use quando o usuário citar uma nota por nome/caminho, ou para aprofundar " +
      "numa fonte retornada por searchSecondBrain (passe o `path` daquele resultado).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: {
          type: Type.STRING,
          description:
            "Caminho relativo da nota dentro do vault, ex: 'wiki/karpathy.md'. " +
            "A extensão .md é opcional.",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "webSearch",
    description:
      "Busca na web em tempo real. Use para fatos atuais, notícias, dados que " +
      "mudam com o tempo, ou qualquer coisa fora do conhecimento do Gabriel e do " +
      "seu conhecimento geral. NÃO use para assuntos pessoais do Gabriel (use searchSecondBrain).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "Os termos de busca.",
        },
      },
      required: ["query"],
    },
  },
];

type ToolResult = Record<string, unknown>;
type ToolArgs = Record<string, unknown>;

/**
 * webSearch — MOCK inicial.
 * TODO: trocar por uma Search API real (Brave / Serper / Tavily). Quando
 * `SEARCH_API_KEY` existir, plugar a chamada HTTP aqui e mapear pro mesmo formato.
 */
async function webSearch(args: ToolArgs): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return { error: "query vazia." };

  if (!process.env.SEARCH_API_KEY) {
    return {
      output: {
        note: "Resultado simulado (SEARCH_API_KEY não configurada — modo mock).",
        query,
        results: [
          {
            title: `Resultado de exemplo para "${query}"`,
            url: "https://example.com/odin-mock",
            snippet:
              "Este é um resultado mockado. Configure SEARCH_API_KEY e a integração " +
              "real em lib/ai/tools.ts para buscas de verdade.",
          },
        ],
      },
    };
  }

  // TODO: integração real, ex:
  //   const res = await fetch("https://api.search.provider/...", { headers: { Authorization: ... } });
  //   return { output: { query, results: mapResults(await res.json()) } };
  return { output: { query, results: [] } };
}

async function readObsidianNote(args: ToolArgs): Promise<ToolResult> {
  const path = String(args.path ?? "").trim();
  if (!path) return { error: "path vazio." };

  const note = await readNote(path);
  if (!note) return { error: `Nota não encontrada ou inacessível: ${path}` };
  return { output: note };
}

async function searchSecondBrain(args: ToolArgs): Promise<ToolResult> {
  const query = String(args.query ?? "").trim();
  if (!query) return { error: "query vazia." };

  const chunks = await retrieveContext(query);
  if (chunks.length === 0) {
    return { output: { query, results: [], note: "Nada relevante no segundo cérebro." } };
  }
  return {
    output: {
      query,
      results: chunks.map((c) => ({
        title: c.title ?? null,
        path: c.path ?? null,
        content: c.content,
        similarity: c.similarity,
      })),
    },
  };
}

const toolExecutors: Record<string, (args: ToolArgs) => Promise<ToolResult>> = {
  webSearch,
  readObsidianNote,
  searchSecondBrain,
};

/**
 * Executa uma tool pelo nome. Blindado: nunca lança — erro vira `{ error }` para
 * o Gemini continuar o turno em vez de derrubar o stream.
 */
export async function executeTool(
  name: string | undefined,
  args: ToolArgs = {}
): Promise<ToolResult> {
  const exec = name ? toolExecutors[name] : undefined;
  if (!exec) return { error: `Ferramenta desconhecida: ${name}` };
  try {
    return await exec(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return { error: `Falha ao executar ${name}: ${message}` };
  }
}
