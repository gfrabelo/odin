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

/** Retry: tentativas e backoff (curto, pra não travar a UX) p/ erros transitórios. */
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000; // 1s → 2s → 4s (cap)
const MAX_BACKOFF_MS = 6000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Erros transitórios da API do Gemini que valem retry:
 * 429 (RESOURCE_EXHAUSTED / rate limit), 503 (UNAVAILABLE / overloaded), 500.
 * O SDK costuma jogar a mensagem como JSON string com `code`/`status`.
 */
function isRetryable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toUpperCase();
  return (
    msg.includes('"CODE": 429') ||
    msg.includes('"CODE":429') ||
    msg.includes('"CODE": 503') ||
    msg.includes('"CODE":503') ||
    msg.includes('"CODE": 500') ||
    msg.includes('"CODE":500') ||
    msg.includes("RESOURCE_EXHAUSTED") ||
    msg.includes("UNAVAILABLE") ||
    msg.includes("OVERLOADED") ||
    msg.includes("TOO MANY REQUESTS")
  );
}

/** Cria o stream do Gemini com retry/backoff exponencial em erros transitórios. */
async function createStreamWithRetry(
  params: Parameters<ReturnType<typeof getGemini>["models"]["generateContentStream"]>[0]
) {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await getGemini().models.generateContentStream(params);
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) throw err;
      if (attempt === MAX_RETRIES) {
        // Esgotou os retries num erro transitório → mensagem amigável.
        throw new Error(
          "Limite de requisições da API do Gemini atingido (rate limit). " +
            "Aguarde alguns segundos e tente de novo, ou adicione créditos/eleve a cota da sua key."
        );
      }
      const delay = Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
      console.warn(
        `Gemini transitório (tentativa ${attempt + 1}/${MAX_RETRIES}). Retry em ${delay}ms.`
      );
      await sleep(delay);
    }
  }
  throw lastErr;
}

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
async function* streamOpenAIResponse(
  messages: Message[],
  systemPrompt: string
): AsyncGenerator<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY não configurada no servidor.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini", // Muito rápido e extremamente barato, perfeito para backup
      messages: [
        { role: "system", content: systemPrompt },
        ...messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: m.content,
        })),
      ],
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Erro na API da OpenAI: ${errorText}`);
  }

  if (!response.body) {
    throw new Error("Sem corpo de resposta na conexão com a OpenAI.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const cleanLine = line.trim();
      if (!cleanLine) continue;
      if (cleanLine === "data: [DONE]") break;
      if (cleanLine.startsWith("data: ")) {
        try {
          const json = JSON.parse(cleanLine.slice(6));
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // Ignora JSONs parciais ou malformados no stream
        }
      }
    }
  }
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
 *
 * Caso o Gemini sofra erro ou rate-limit, o sistema reverte para OpenAI de forma transparente.
 */
export async function* streamOdinResponse(
  messages: Message[]
): AsyncGenerator<string> {
  // RAG automático: recupera contexto relevante a partir da última pergunta.
  // (Híbrido: o Odin AINDA pode chamar `searchSecondBrain` para buscas dirigidas.)
  const lastUser =
    [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const chunks = await retrieveContext(lastUser);
  const systemPrompt = buildSystemInstruction(chunks);

  const provider = process.env.LLM_PROVIDER || "gemini";

  if (provider === "openai") {
    yield* streamOpenAIResponse(messages, systemPrompt);
    return;
  }

  // Se for Gemini (padrão)
  const contents = toGeminiContents(messages);
  const config = {
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: odinFunctionDeclarations }],
  };

  try {
    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const stream = await createStreamWithRetry({
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
  } catch (geminiError) {
    // Caso ocorra erro e tenhamos key OpenAI, acionamos fallback automático
    if (process.env.OPENAI_API_KEY) {
      console.warn("API do Gemini falhou. Acionando fallback para OpenAI. Erro:", geminiError);
      yield `\n\n_(⚠️ Gemini esgotado/limite atingido. Redirecionando para OpenAI...)_\n\n`;
      yield* streamOpenAIResponse(messages, systemPrompt);
    } else {
      throw geminiError;
    }
  }
}
