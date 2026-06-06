import { streamOdinResponse } from "@/lib/ai/chat";
import type { ChatRequest } from "@/types";

// O SDK Anthropic precisa do runtime Node.
export const runtime = "nodejs";

export async function POST(req: Request) {
  let body: ChatRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400 });
  }

  const messages = body?.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: "`messages` é obrigatório." }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // streamOdinResponse devolve deltas de texto puro (agnóstico de provider).
        for await (const chunk of streamOdinResponse(messages)) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        // Falha no meio do stream: encerra com uma marca de erro que o
        // client reconhece e exibe, em vez de travar.
        const message = err instanceof Error ? err.message : "Erro desconhecido";
        controller.enqueue(encoder.encode(`\n\n[Odin offline: ${message}]`));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
