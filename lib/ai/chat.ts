import type { Message } from "@/types";
import { getGemini } from "./client";
import { ODIN_SYSTEM_PROMPT } from "@/lib/prompts/odin";
import { retrieveContext, type RetrievedChunk } from "@/lib/rag/retrieve";

/**
 * Modelo padrão do Odin. Gemini 2.5 Flash: rápido e barato, ideal pro chat
 * do cockpit. Para respostas mais profundas, troque por "gemini-2.5-pro".
 */
const ODIN_MODEL = "gemini-2.5-flash";

/** Converte o histórico do Odin para o formato `contents` do Gemini.
 *  Gemini usa o papel "model" (não "assistant"). */
function toGeminiContents(messages: Message[]) {
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
 * Hoje: RAG sobre o vault (Supabase/pgvector) + Gemini. Amanhã: o
 * orquestrador multi-modelo decide aqui — sem tocar na rota nem na UI.
 */
export async function* streamOdinResponse(
  messages: Message[]
): AsyncGenerator<string> {
  // RAG: recupera contexto relevante a partir da última pergunta do usuário.
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const chunks = await retrieveContext(lastUser);

  const stream = await getGemini().models.generateContentStream({
    model: ODIN_MODEL,
    contents: toGeminiContents(messages),
    config: {
      systemInstruction: buildSystemInstruction(chunks),
    },
  });

  for await (const chunk of stream) {
    const text = chunk.text;
    if (text) yield text;
  }
}
