import {
  createPartFromFunctionResponse,
  type Content,
  type FunctionCall,
} from "@google/genai";
import type { Message } from "@/types";
import { getGemini } from "./client";
import { ODIN_SYSTEM_PROMPT } from "@/lib/prompts/odin";
import { retrieveContext, type RetrievedChunk } from "@/lib/rag/retrieve";
import { executeTool, odinFunctionDeclarations } from "./tools";

/**
 * Modelo padrão do Odin. Gemini 2.5 Flash: rápido e barato, ideal pro chat
 * do cockpit. Para respostas mais profundas, troque por "gemini-2.5-pro".
 */
const ODIN_MODEL = "gemini-2.5-flash";

/** Teto de rodadas do loop de tools — evita laço infinito de function calling. */
const MAX_TOOL_TURNS = 5;

/** Converte o histórico do Odin para o formato `contents` do Gemini.
 *  Gemini usa o papel "model" (não "assistant"). */
function toGeminiContents(messages: Message[]): Content[] {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

/** Monta o systemInstruction, injetando contexto do RAG quando houver. */
function buildSystemInstruction(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return ODIN_SYSTEM_PROMPT;

  const context = chunks
    .map((c, i) => `[${i + 1}] (${c.title ?? c.path ?? "fonte"})\n${c.content}`)
    .join("\n\n");

  return `${ODIN_SYSTEM_PROMPT}

## Contexto do segundo cérebro do Gabriel
Os trechos abaixo vêm das anotações do Gabriel. Use-os quando forem relevantes
e cite a fonte entre colchetes (ex: [1]). Se não forem relevantes para a
pergunta, ignore e responda normalmente.

${context}`;
}

/**
 * Gera a resposta do Odin em streaming, como texto puro (deltas).
 *
 * ─── PONTO DE EXTENSÃO ───────────────────────────────────────────
 * O contrato estável é: recebe Message[], devolve um stream de strings.
 * O endpoint e a UI não sabem qual provider/contexto está por trás.
 *
 * Hoje, por baixo: RAG automático sobre o vault (híbrido) + Gemini com
 * FUNCTION CALLING. Quando o Gemini decide chamar uma ferramenta, o loop abaixo
 * a executa localmente no Node e devolve o resultado pro modelo continuar — tudo
 * sem a rota nem a UI saberem que houve uma ação no meio do caminho.
 */
export async function* streamOdinResponse(
  messages: Message[]
): AsyncGenerator<string> {
  // RAG automático: recupera contexto relevante a partir da última pergunta.
  // (Híbrido: o Odin AINDA pode chamar `searchSecondBrain` para buscas dirigidas.)
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const chunks = await retrieveContext(lastUser);

  const contents = toGeminiContents(messages);
  const config = {
    systemInstruction: buildSystemInstruction(chunks),
    tools: [{ functionDeclarations: odinFunctionDeclarations }],
  };

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const stream = await getGemini().models.generateContentStream({
      model: ODIN_MODEL,
      contents,
      config,
    });

    const pendingCalls: FunctionCall[] = [];
    const modelParts: NonNullable<Content["parts"]> = [];

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield text; // streama a resposta em tempo real

      if (chunk.functionCalls?.length) pendingCalls.push(...chunk.functionCalls);

      const parts = chunk.candidates?.[0]?.content?.parts;
      if (parts?.length) modelParts.push(...parts);
    }

    // Sem chamadas de ferramenta neste turno → era a resposta final.
    if (pendingCalls.length === 0) return;

    // Feedback discreto pro usuário enquanto as ferramentas rodam.
    const names = [...new Set(pendingCalls.map((c) => c.name).filter(Boolean))];
    yield `\n\n_⚙️ Odin acionando: ${names.join(", ")}…_\n\n`;

    // 1) Registra o turno do modelo (que contém os functionCall).
    contents.push({ role: "model", parts: modelParts });

    // 2) Executa as ferramentas e devolve os resultados (role "user").
    const results = await Promise.all(
      pendingCalls.map((c) => executeTool(c.name, c.args ?? {}))
    );
    contents.push({
      role: "user",
      parts: results.map((res, i) =>
        createPartFromFunctionResponse(
          pendingCalls[i].id ?? "",
          pendingCalls[i].name ?? "",
          res
        )
      ),
    });
    // …e volta ao topo do loop para o próximo turno (pode chamar mais tools).
  }

  // Estouro do teto de rodadas: avisa em vez de travar silenciosamente.
  yield "\n\n_(limite de ações encadeadas atingido)_";
}
