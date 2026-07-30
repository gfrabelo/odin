"use client";

/**
 * Odin Workflows — WorkflowPanel
 */

import { useState, useCallback, useRef, useEffect } from "react";

type AgentName =
  | "supervisor"
  | "researcher"
  | "qualifier"
  | "copywriter"
  | "human_review";

type WorkflowEventType =
  | "workflow_start"
  | "node_start"
  | "node_end"
  | "token"
  | "interrupt"
  | "workflow_end"
  | "error";

interface WorkflowEvent {
  type: WorkflowEventType;
  node: AgentName | null;
  data: Record<string, unknown>;
  timestamp: string;
}

type PanelStatus = "idle" | "running" | "waiting_human" | "completed" | "error";

const AGENT_CONFIG: Record<
  AgentName,
  { label: string; icon: string; color: string }
> = {
  supervisor: { label: "Supervisor", icon: "🧠", color: "#a78bfa" },
  researcher: { label: "Pesquisador", icon: "🔍", color: "#60a5fa" },
  qualifier: { label: "Qualificador", icon: "📊", color: "#fbbf24" },
  copywriter: { label: "Redator", icon: "✍️", color: "#34d399" },
  human_review: { label: "Revisão Humana", icon: "👤", color: "#f87171" },
};

const AGENT_ORDER: AgentName[] = [
  "supervisor",
  "researcher",
  "qualifier",
  "copywriter",
  "human_review",
];

export function WorkflowPanel() {
  const [status, setStatus] = useState<PanelStatus>("idle");
  const [task, setTask] = useState("");
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [activeNode, setActiveNode] = useState<AgentName | null>(null);
  const [completedNodes, setCompletedNodes] = useState<Set<AgentName>>(
    new Set()
  );
  const [threadId, setThreadId] = useState<string | null>(null);
  const [interruptPayload, setInterruptPayload] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [feedback, setFeedback] = useState("");
  const eventsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  const processSSEStream = useCallback(
    async (response: Response) => {
      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const chunk of lines) {
          if (!chunk.startsWith("data: ")) continue;
          try {
            const event: WorkflowEvent = JSON.parse(chunk.slice(6));
            setEvents((prev) => [...prev, event]);

            switch (event.type) {
              case "workflow_start":
                setStatus("running");
                if (event.data.thread_id) {
                  setThreadId(event.data.thread_id as string);
                }
                break;
              case "node_end":
                if (event.node) {
                  setActiveNode(null);
                  setCompletedNodes((prev) => {
                    const next = new Set(prev);
                    next.add(event.node as AgentName);
                    return next;
                  });
                  if (event.node !== "supervisor") {
                    setActiveNode("supervisor");
                  }
                }
                break;
              case "interrupt":
                setStatus("waiting_human");
                setActiveNode("human_review");
                setInterruptPayload(event.data.payload as Record<string, unknown>);
                break;
              case "workflow_end":
                setStatus("completed");
                setActiveNode(null);
                break;
              case "error":
                setStatus("error");
                setActiveNode(null);
                break;
            }
          } catch {
            // Ignore parse errors
          }
        }
      }
    },
    []
  );

  const startWorkflow = useCallback(async () => {
    if (!task.trim()) return;

    setStatus("running");
    setEvents([]);
    setCompletedNodes(new Set());
    setActiveNode("supervisor");
    setInterruptPayload(null);
    setFeedback("");

    try {
      const res = await fetch("/api/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task }),
      });

      if (!res.ok) {
        setStatus("error");
        return;
      }

      await processSSEStream(res);
    } catch {
      setStatus("error");
    }
  }, [task, processSSEStream]);

  const resumeWorkflow = useCallback(
    async (decision: "approve" | "reject" | "edit") => {
      if (!threadId) return;

      setStatus("running");
      setInterruptPayload(null);
      setActiveNode("supervisor");

      try {
        const res = await fetch("/api/workflow", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            threadId,
            decision,
            feedback: decision === "edit" ? feedback : undefined,
          }),
        });

        if (!res.ok) {
          setStatus("error");
          return;
        }

        await processSSEStream(res);
      } catch {
        setStatus("error");
      }
    },
    [threadId, feedback, processSSEStream]
  );

  return (
    <div className="workflow-panel">
      {/* Header com status */}
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <span className="text-[10px] uppercase font-mono tracking-widest text-neutral-400">
          LangGraph Pipeline
        </span>
        <span className={`workflow-badge workflow-badge--${status}`}>
          {status === "idle" && "Pronto"}
          {status === "running" && "Executando..."}
          {status === "waiting_human" && "Aguardando revisão"}
          {status === "completed" && "Concluído ✅"}
          {status === "error" && "Erro ❌"}
        </span>
      </div>

      {/* Input de tarefa */}
      <div className="workflow-input-group">
        <input
          type="text"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && startWorkflow()}
          placeholder="Ex: Prospectar petshops que precisam de sites em Itanhaém..."
          className="workflow-input"
          disabled={status === "running"}
        />
        <button
          onClick={startWorkflow}
          disabled={status === "running" || !task.trim()}
          className="workflow-btn workflow-btn--primary"
        >
          {status === "running" ? "⏳" : "▶"} Iniciar
        </button>
      </div>

      {/* Grafo visual dos agentes */}
      <div className="workflow-graph">
        {AGENT_ORDER.map((name) => {
          const config = AGENT_CONFIG[name];
          const isActive = activeNode === name;
          const isCompleted = completedNodes.has(name);
          return (
            <div key={name} className="workflow-graph-step">
              <div
                className={`workflow-node ${isActive ? "workflow-node--active" : ""} ${isCompleted ? "workflow-node--done" : ""}`}
                style={{
                  borderColor: isActive ? config.color : undefined,
                  boxShadow: isActive
                    ? `0 0 16px ${config.color}40`
                    : undefined,
                }}
                title={config.label}
              >
                <span className="workflow-node-icon">{config.icon}</span>
                <span className="workflow-node-label">{config.label}</span>
                {isActive && <span className="workflow-node-pulse" />}
                {isCompleted && <span className="workflow-node-check">✓</span>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Human Review Panel */}
      {status === "waiting_human" && interruptPayload && (
        <div className="workflow-review">
          <h3 className="workflow-review-title">
            👤 Revisão Humana Necessária
          </h3>

          <div className="workflow-review-lead">
            <p>
              <strong>Lead:</strong>{" "}
              {(interruptPayload.leadName as string) ?? "—"} (
              {(interruptPayload.leadSegment as string) ?? "—"})
              {(interruptPayload.googleMapsUrl as string) && (
                <a
                  href={interruptPayload.googleMapsUrl as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="workflow-link"
                  style={{ marginLeft: "0.5rem" }}
                >
                  📍 Ver no Maps
                </a>
              )}
            </p>
            <p>
              <strong>Score:</strong>{" "}
              {(interruptPayload.qualificationScore as number) ?? 0}/10
              {(interruptPayload.leadPhone as string) && (
                <span style={{ marginLeft: "0.75rem", color: "rgba(255,255,255,0.5)" }}>
                  📞 {interruptPayload.leadPhone as string}
                </span>
              )}
            </p>
            {(interruptPayload.opportunities as string[])?.length > 0 && (
              <p>
                <strong>Oportunidades:</strong>{" "}
                {(interruptPayload.opportunities as string[]).join(", ")}
              </p>
            )}
          </div>

          <div className="workflow-review-draft">
            <h4>Mensagem de abordagem:</h4>
            <pre className="workflow-review-message">
              {(interruptPayload.outreachDraft as string) ?? ""}
            </pre>
          </div>

          <div className="workflow-review-actions">
            <button
              onClick={() => resumeWorkflow("approve")}
              className="workflow-btn workflow-btn--approve"
            >
              ✅ Aprovar
            </button>
            {(interruptPayload.whatsappLink as string) && (
              <a
                href={interruptPayload.whatsappLink as string}
                target="_blank"
                rel="noopener noreferrer"
                className="workflow-btn workflow-btn--whatsapp"
              >
                📲 Enviar no WhatsApp
              </a>
            )}
            <button
              onClick={() => resumeWorkflow("reject")}
              className="workflow-btn workflow-btn--reject"
            >
              ❌ Rejeitar
            </button>
            <div className="workflow-review-edit">
              <input
                type="text"
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder="Feedback para reescrita..."
                className="workflow-input workflow-input--small"
              />
              <button
                onClick={() => resumeWorkflow("edit")}
                disabled={!feedback.trim()}
                className="workflow-btn workflow-btn--edit"
              >
                ✏️ Revisar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Event log */}
      <div className="workflow-events">
        <h3 className="workflow-events-title">📋 Log de Eventos</h3>
        <div className="workflow-events-list">
          {events.length === 0 && (
            <p className="workflow-events-empty">
              Inicie um workflow para ver o progresso aqui.
            </p>
          )}
          {events.map((evt, i) => (
            <div
              key={i}
              className={`workflow-event workflow-event--${evt.type}`}
            >
              <span className="workflow-event-time">
                {new Date(evt.timestamp).toLocaleTimeString("pt-BR")}
              </span>
              <span className="workflow-event-node">
                {evt.node
                  ? `${AGENT_CONFIG[evt.node]?.icon ?? "?"} ${AGENT_CONFIG[evt.node]?.label ?? evt.node}`
                  : "🔄 Sistema"}
              </span>
              <span className="workflow-event-detail">
                {formatEventData(evt)}
              </span>
            </div>
          ))}
          <div ref={eventsEndRef} />
        </div>
      </div>
    </div>
  );
}

function formatEventData(event: WorkflowEvent): string {
  switch (event.type) {
    case "workflow_start":
      return event.data.resuming
        ? "Workflow retomado"
        : `Workflow iniciado: "${event.data.task}"`;
    case "node_end": {
      const messages = event.data.messages as
        | Array<{ content: string }>
        | undefined;
      if (messages?.length) {
        return messages.map((m) => m.content).join(" | ");
      }
      return "Node concluído";
    }
    case "interrupt":
      return "⏸ Pausado para revisão humana";
    case "workflow_end":
      return "Workflow concluído com sucesso";
    case "error":
      return `Erro: ${event.data.error ?? "desconhecido"}`;
    default:
      return JSON.stringify(event.data).slice(0, 100);
  }
}
