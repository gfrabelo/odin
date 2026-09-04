/**
 * Odin Workflows — API Route
 *
 * ─── CONCEITO 6: Streaming de Estado ───────────────────────────────
 * O LangGraph emite eventos a cada transição do grafo. Nós usamos
 * SSE (Server-Sent Events) para transmitir esses eventos em tempo
 * real para a UI. O WorkflowPanel na UI consome o stream e mostra:
 *  - Qual agente está rodando (spinner + nome)
 *  - O que cada agente produziu (resultado parcial)
 *  - Quando o workflow pausou (interrupt → human review)
 *  - Quando terminou
 *
 * Tradeoff SSE vs WebSocket:
 *  - SSE: unidirecional (server → client), simples, funciona com
 *    HTTP padrão, reconecta automaticamente. Perfeito para streaming
 *    de progresso.
 *  - WebSocket: bidirecional, mais complexo. Seria necessário se a
 *    UI precisasse enviar dados DURANTE o stream (ex: cancelar um
 *    node específico). Por agora, SSE é suficiente — a aprovação
 *    humana usa um PUT separado.
 *
 * ─── Endpoints ─────────────────────────────────────────────────────
 * POST /api/workflow  — Inicia um workflow (retorna SSE stream)
 * PUT  /api/workflow  — Retoma workflow pausado (human decision)
 * GET  /api/workflow  — Status de um workflow por thread_id
 * ────────────────────────────────────────────────────────────────────
 */

import { createProspectWorkflow } from "@/lib/workflows/graph";
import { Command } from "@langchain/langgraph";
import { saveRun } from "@/lib/prospect/repository";
import type {
  WorkflowEvent,
  WorkflowEventType,
  AgentName,
  QualifiedLead,
} from "@/lib/workflows/types";

export const runtime = "nodejs";

// Workflow completo: Apify scraping + enriquecimento + qualifier + copywriter.
// Pode levar minutos. 300s é o teto da Vercel Pro.
export const maxDuration = 300;

/**
 * Teto de passos do grafo.
 *
 * Rede de segurança, não a correção: quem impede o loop caro é o
 * `researchAttempts` no supervisor. Sem o contador, este limite ainda
 * pagaria ~6 chamadas Apify de 120s antes de estourar. O default do
 * LangGraph é 25 — alto demais quando cada volta custa dinheiro.
 */
const RECURSION_LIMIT = 12;

/**
 * Persiste o run e seus leads.
 *
 * Fica AQUI, e não num nó, porque o LangGraph reexecuta o nó do topo ao
 * retomar de um `interrupt()` — uma escrita dentro de `human-review.ts`
 * rodaria duas vezes. A rota é a fronteira transacional. Ver ADR-0013 (a
 * escrever) e o cabeçalho de `lib/prospect/repository.ts`.
 *
 * Nunca lança: falha de persistência não pode derrubar o stream do usuário.
 */
async function persistState(
  threadId: string,
  values: Record<string, unknown>,
  status: string
): Promise<void> {
  const qualifiedLeads = (values.qualifiedLeads as QualifiedLead[]) ?? [];
  const leads = (values.leads as unknown[]) ?? [];

  await saveRun(
    {
      threadId,
      task: (values.task as string) ?? "",
      demoContext: (values.demoContext as string) ?? "",
      status,
      totalFound: leads.length,
      totalQualified: qualifiedLeads.filter((l) => l.qualified).length,
    },
    qualifiedLeads
  );
}

// ─── Helpers SSE ────────────────────────────────────────────────────

function createSSEEvent(
  type: WorkflowEventType,
  node: AgentName | null,
  data: Record<string, unknown>
): string {
  const event: WorkflowEvent = {
    type,
    node,
    data,
    timestamp: new Date().toISOString(),
  };
  return `data: ${JSON.stringify(event)}\n\n`;
}

// ─── POST: Iniciar Workflow ─────────────────────────────────────────

interface WorkflowRequest {
  task: string;
  threadId?: string;
  /** Contexto da demo pronta para este nicho (opcional). Ver ADR-0011. */
  demoContext?: string;
}

export async function POST(req: Request) {
  let body: WorkflowRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { task, threadId, demoContext } = body;

  if (!task?.trim()) {
    return Response.json({ error: "`task` é obrigatório." }, { status: 400 });
  }

  // Thread ID: identifica este workflow para checkpointing/resumo
  const thread_id = threadId ?? crypto.randomUUID();

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const app = await createProspectWorkflow();

        // Envia o evento de início com o thread_id
        controller.enqueue(
          encoder.encode(
            createSSEEvent("workflow_start", null, { thread_id, task })
          )
        );

        // ── Stream do grafo ────────────────────────────────────
        // `.stream()` retorna um iterável com updates de estado
        // a cada node que completa. O `streamMode: "updates"` dá
        // updates incrementais (não o estado inteiro a cada passo).
        const eventStream = await app.stream(
          {
            task,
            demoContext: demoContext?.trim() ?? "",
            status: "running" as const,
          },
          {
            configurable: { thread_id },
            streamMode: "updates",
            recursionLimit: RECURSION_LIMIT,
          }
        );

        for await (const event of eventStream) {
          // Cada `event` é um objeto { nodeNome: { ...updates } }
          for (const [nodeName, updates] of Object.entries(event)) {
            const nodeUpdate = updates as Record<string, unknown>;

            // Evento de conclusão do node
            controller.enqueue(
              encoder.encode(
                createSSEEvent(
                  "node_end",
                  nodeName as AgentName,
                  nodeUpdate
                )
              )
            );
          }
        }

        // Verifica se o workflow pausou (interrupt)
        const finalState = await app.getState({
          configurable: { thread_id },
        });

        if (
          finalState.tasks &&
          finalState.tasks.some(
            (t: { interrupts?: unknown[] }) =>
              t.interrupts && t.interrupts.length > 0
          )
        ) {
          // Extrair o payload do interrupt
          const interruptTask = finalState.tasks.find(
            (t: { interrupts?: unknown[] }) =>
              t.interrupts && t.interrupts.length > 0
          );
          const interruptData =
            interruptTask?.interrupts?.[0]?.value ?? {};

          // Persiste ANTES de emitir o interrupt: é aqui que os leads
          // existem pela primeira vez em forma final, e é o ponto em que o
          // usuário pode fechar a aba a qualquer momento.
          await persistState(thread_id, finalState.values, "waiting_human");

          controller.enqueue(
            encoder.encode(
              createSSEEvent("interrupt", "human_review", {
                thread_id,
                payload: interruptData,
              })
            )
          );
        } else {
          // Workflow completou (ou falhou) sem pausar.
          const status = (finalState.values?.status as string) ?? "completed";
          await persistState(thread_id, finalState.values, status);

          controller.enqueue(
            encoder.encode(
              createSSEEvent("workflow_end", null, {
                thread_id,
                status,
                state: finalState.values,
              })
            )
          );
        }

        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro desconhecido";
        console.error("[Odin Workflow] Erro no workflow:", err);
        controller.enqueue(
          encoder.encode(
            createSSEEvent("error", null, { error: message })
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ─── PUT: Retomar Workflow (Human Decision) ─────────────────────────

/**
 * Não existe mais `edit`. A edição da mensagem acontece direto no textarea
 * da tabela e o link `wa.me` é remontado no clique — uma volta pelo grafo
 * para revisar uma mensagem é estritamente pior em latência e em código.
 * O caminho era obsoleto por arquitetura, não inacabado.
 */
interface ResumeRequest {
  threadId: string;
  decision: "approve" | "reject";
}

export async function PUT(req: Request) {
  let body: ResumeRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400 });
  }

  const { threadId, decision } = body;

  if (!threadId) {
    return Response.json({ error: "`threadId` é obrigatório." }, { status: 400 });
  }

  if (decision !== "approve" && decision !== "reject") {
    return Response.json(
      { error: "`decision` deve ser 'approve' ou 'reject'." },
      { status: 400 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const app = await createProspectWorkflow();

        controller.enqueue(
          encoder.encode(
            createSSEEvent("workflow_start", null, {
              thread_id: threadId,
              resuming: true,
            })
          )
        );

        // Resume o workflow com a decisão humana usando Command
        // O Command.resume() envia o valor de volta para a função
        // interrupt() que estava esperando.
        const resumeStream = await app.stream(
          new Command({ resume: { decision } }),
          {
            configurable: { thread_id: threadId },
            streamMode: "updates",
            recursionLimit: RECURSION_LIMIT,
          }
        );

        for await (const event of resumeStream) {
          for (const [nodeName, updates] of Object.entries(event)) {
            controller.enqueue(
              encoder.encode(
                createSSEEvent(
                  "node_end",
                  nodeName as AgentName,
                  updates as Record<string, unknown>
                )
              )
            );
          }
        }

        // Verifica estado final
        const finalState = await app.getState({
          configurable: { thread_id: threadId },
        });

        if (
          finalState.tasks &&
          finalState.tasks.some(
            (t: { interrupts?: unknown[] }) =>
              t.interrupts && t.interrupts.length > 0
          )
        ) {
          const interruptTask = finalState.tasks.find(
            (t: { interrupts?: unknown[] }) =>
              t.interrupts && t.interrupts.length > 0
          );
          await persistState(threadId, finalState.values, "waiting_human");
          controller.enqueue(
            encoder.encode(
              createSSEEvent("interrupt", "human_review", {
                thread_id: threadId,
                payload: interruptTask?.interrupts?.[0]?.value ?? {},
              })
            )
          );
        } else {
          const status = (finalState.values?.status as string) ?? "completed";
          await persistState(threadId, finalState.values, status);
          controller.enqueue(
            encoder.encode(
              createSSEEvent("workflow_end", null, {
                thread_id: threadId,
                status,
                state: finalState.values,
              })
            )
          );
        }

        controller.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erro desconhecido";
        console.error("[Odin Workflow] Erro ao retomar:", err);
        controller.enqueue(
          encoder.encode(
            createSSEEvent("error", null, { error: message })
          )
        );
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

// ─── GET: Status do Workflow ─────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const threadId = searchParams.get("threadId");

  if (!threadId) {
    return Response.json(
      { error: "`threadId` query param é obrigatório." },
      { status: 400 }
    );
  }

  try {
    const app = await createProspectWorkflow();
    const state = await app.getState({
      configurable: { thread_id: threadId },
    });

    if (!state.values) {
      return Response.json(
        { error: "Workflow não encontrado." },
        { status: 404 }
      );
    }

    const hasInterrupt =
      state.tasks?.some(
        (t: { interrupts?: unknown[] }) =>
          t.interrupts && t.interrupts.length > 0
      ) ?? false;

    return Response.json({
      threadId,
      status: hasInterrupt ? "waiting_human" : "completed",
      state: state.values,
      hasInterrupt,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro desconhecido";
    return Response.json({ error: message }, { status: 500 });
  }
}
