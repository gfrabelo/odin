import { getFollowUpSuggestions } from "@/lib/ai/suggestions";
import type { ChatRequest } from "@/types";

// Usa o SDK do Gemini no servidor → runtime Node.
export const runtime = "nodejs";

/**
 * Chips de follow-up: recebe o histórico e devolve até 3 sugestões.
 * É um endpoint à parte do chat (não mexe no contrato de stream) e nunca
 * derruba a UI — em qualquer falha, responde `{ suggestions: [] }`.
 */
export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ suggestions: [] });
  }

  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ suggestions: [] });
  }

  const suggestions = await getFollowUpSuggestions(messages);
  return Response.json(
    { suggestions },
    { headers: { "Cache-Control": "no-store" } }
  );
}
