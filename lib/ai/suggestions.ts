/**
 * Chips de follow-up — structured output do Gemini 3.
 *
 * Depois que o Odin termina uma resposta, este helper faz UMA chamada barata e
 * NÃO-streaming pedindo 3 próximas perguntas que o Gabriel provavelmente faria.
 * Usa `responseSchema` (JSON com schema) — recurso que só o Gemini 3 permite
 * combinar com function calling; aqui é uma chamada isolada, sem tools.
 *
 * Blindado de ponta a ponta: qualquer erro (rate-limit, JSON inválido,
 * LLM_PROVIDER=openai, key ausente) vira `[]`. Nunca lança, nunca trava a UI —
 * sem sugestões, o cockpit fica idêntico ao de hoje.
 */
import { Type } from "@google/genai";
import type { Message } from "@/types";
import { getGemini } from "./client";

/** Modelo leve e barato pras sugestões (chamada secundária, não o chat). */
const SUGGESTIONS_MODEL = "gemini-3.1-flash-lite";

/** Quantas mensagens recentes mandar de contexto (custo baixo). */
const CONTEXT_WINDOW = 4;

const SUGGESTIONS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    suggestions: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
  },
  required: ["suggestions"],
};

const SYSTEM = `Você gera follow-ups para o Gabriel num cockpit de IA pessoal.
Dada a conversa, proponha 3 próximas perguntas curtas (máx ~6 palavras cada),
em pt-BR, na voz do Gabriel (diretas, sem firula), que façam sentido como
próximo passo natural. Não repita o que já foi perguntado.`;

export async function getFollowUpSuggestions(
  messages: Message[]
): Promise<string[]> {
  // Sem provider Gemini, nem tenta (o helper é específico do Gemini 3).
  if ((process.env.LLM_PROVIDER || "gemini") !== "gemini") return [];
  if (!process.env.GEMINI_API_KEY) return [];
  if (messages.length === 0) return [];

  const recent = messages.slice(-CONTEXT_WINDOW);
  const transcript = recent
    .map((m) => `${m.role === "assistant" ? "Odin" : "Gabriel"}: ${m.content}`)
    .join("\n");

  try {
    const res = await getGemini().models.generateContent({
      model: SUGGESTIONS_MODEL,
      contents: [{ role: "user", parts: [{ text: transcript }] }],
      config: {
        systemInstruction: SYSTEM,
        responseMimeType: "application/json",
        responseSchema: SUGGESTIONS_SCHEMA,
      },
    });

    const text = res.text;
    if (!text) return [];

    const parsed = JSON.parse(text) as { suggestions?: unknown };
    if (!Array.isArray(parsed.suggestions)) return [];

    return parsed.suggestions
      .filter((s): s is string => typeof s === "string")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
  } catch (err) {
    console.warn("Falha ao gerar follow-ups (ignorado):", err);
    return [];
  }
}
