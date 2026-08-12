"use client";

/**
 * Odin Workflows — WorkflowPanel
 */

import { useState, useCallback, useRef, useEffect } from "react";

type AgentName =
  | "supervisor"
  | "researcher"
  | "enricher"
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
  enricher: { label: "Análise de Site", icon: "🌐", color: "#22d3ee" },
  qualifier: { label: "Qualificador", icon: "📊", color: "#fbbf24" },
  copywriter: { label: "Redator", icon: "✍️", color: "#34d399" },
  human_review: { label: "Revisão Humana", icon: "👤", color: "#f87171" },
};

const AGENT_ORDER: AgentName[] = [
  "supervisor",
  "researcher",
  "enricher",
  "qualifier",
  "copywriter",
  "human_review",
];

/** Uma linha da tabela de revisão, como vem no payload do interrupt. */
interface ReviewLead {
  leadKey: string;
  name: string;
  segment: string;
  phone: string | null;
  website: string | null;
  location: string | null;
  score: number;
  reasoning: string;
  opportunities: string[];
  message: string | null;
  googleMapsUrl: string | null;
}

/**
 * Monta o link do WhatsApp NO MOMENTO DO CLIQUE, a partir do texto atual do
 * textarea. É isso que faz as edições do Gabriel chegarem no WhatsApp — usar
 * o `whatsappLink` que veio do servidor descartaria tudo que ele reescreveu.
 *
 * Espelha `lib/workflows/whatsapp.ts`; duplicado de propósito porque este
 * arquivo é client-side e aquele importa `node:crypto` na cadeia.
 */
function waLink(phone: string | null, message: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const text = message.trim();
  return text
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${digits}`;
}

/** Escapa um campo para CSV (aspas duplas dobradas, campo entre aspas). */
function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return `"${s.replace(/"/g, '""')}"`;
}

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
  const [demoContext, setDemoContext] = useState("");
  /**
   * Mensagens editadas pelo humano, por leadKey. Só guarda o que ele mexeu;
   * o resto sai do payload. O link é remontado a partir daqui no clique.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
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
                // Respeita o status real: o supervisor encerra com "failed"
                // quando não há lead novo para trabalhar, e mostrar
                // "Concluído ✅" nesse caso seria mentir para o usuário.
                setStatus(
                  event.data.status === "failed" ? "error" : "completed"
                );
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
    setDrafts({});

    try {
      const res = await fetch("/api/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, demoContext }),
      });

      if (!res.ok) {
        setStatus("error");
        return;
      }

      await processSSEStream(res);
    } catch {
      setStatus("error");
    }
  }, [task, demoContext, processSSEStream]);

  const resumeWorkflow = useCallback(
    async (decision: "approve" | "reject") => {
      if (!threadId) return;

      setStatus("running");
      setInterruptPayload(null);
      setActiveNode("supervisor");

      try {
        const res = await fetch("/api/workflow", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ threadId, decision }),
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
    [threadId, processSSEStream]
  );

  /**
   * Marca o lead como contatado. Fire-and-forget de propósito: roda no
   * clique do link do WhatsApp e não pode, em hipótese alguma, atrasar ou
   * bloquear a abertura do app.
   */
  const markContacted = useCallback((leadKey: string) => {
    void fetch("/api/leads/contacted", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadKey }),
    }).catch(() => {
      /* silencioso: não atrapalha o envio */
    });
  }, []);

  const copyMessage = useCallback(async (leadKey: string, message: string) => {
    try {
      await navigator.clipboard.writeText(message);
      setCopiedKey(leadKey);
      setTimeout(() => setCopiedKey(null), 1500);
    } catch {
      /* clipboard bloqueado: o textarea continua selecionável à mão */
    }
  }, []);

  /**
   * Exporta a tabela como CSV. Rede de segurança para o dia em que o
   * Supabase estiver indisponível ou chato — e o formato que ele já usa
   * para acompanhar prospecção à mão.
   */
  const exportCsv = useCallback(
    (leads: ReviewLead[]) => {
      const header = [
        "nome", "segmento", "telefone", "website", "localizacao",
        "score", "oportunidades", "mensagem", "maps",
      ];
      const rows = leads.map((l) =>
        [
          l.name, l.segment, l.phone, l.website, l.location, l.score,
          (l.opportunities ?? []).join(" | "),
          drafts[l.leadKey] ?? l.message ?? "",
          l.googleMapsUrl,
        ].map(csvCell).join(",")
      );
      // BOM para o Excel abrir acentuação corretamente.
      const csv = `﻿${[header.join(","), ...rows].join("\n")}`;
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8;" })
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
    [drafts]
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

      {/*
        Contexto da demo. Sem isto, o Copywriter prometia "já tenho um
        protótipo funcionando" para todo lead — o que era simplesmente
        falso. Preenchido, a promessa vira verdade; vazio, o prompt é
        instruído a não prometer nada.
      */}
      <div className="workflow-input-group">
        <input
          type="text"
          value={demoContext}
          onChange={(e) => setDemoContext(e.target.value)}
          placeholder="Demo pronta p/ este nicho (opcional). Ex: site de chocolateria feito pra chocoLaura, Peruíbe"
          className="workflow-input"
          disabled={status === "running"}
          title="Se preenchido, o Redator pode mencionar a demo com verdade. O link não vai na mensagem."
        />
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

      {/* Lead Table (Human Review v2) */}
      {status === "waiting_human" && interruptPayload && (
        <div className="workflow-review">
          <h3 className="workflow-review-title">
            📊 Leads Qualificados
            {interruptPayload.totalFound != null && (
              <span style={{ fontWeight: 400, fontSize: "0.8rem", marginLeft: "0.5rem", color: "rgba(255,255,255,0.5)" }}>
                {(interruptPayload.totalQualified as number) ?? 0} de {(interruptPayload.totalFound as number) ?? 0} encontrados
              </span>
            )}
          </h3>

          <div className="workflow-lead-table-wrap">
            <table className="workflow-lead-table">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Score</th>
                  <th>Mensagem</th>
                  <th>Enviar</th>
                </tr>
              </thead>
              <tbody>
                {((interruptPayload.leads as ReviewLead[]) ?? []).map((lead) => {
                  const score = lead.score ?? 0;
                  const scoreColor =
                    score >= 7 ? "#34d399" : score >= 4 ? "#fbbf24" : "#f87171";
                  // O rascunho editado ganha do que veio do servidor.
                  const message = drafts[lead.leadKey] ?? lead.message ?? "";
                  const href = waLink(lead.phone, message);

                  return (
                    <tr key={lead.leadKey}>
                      <td>
                        <div className="workflow-lead-name">
                          {lead.name ?? "—"}
                          {lead.googleMapsUrl && (
                            <a
                              href={lead.googleMapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="workflow-link"
                              title="Ver no Google Maps"
                            >
                              📍
                            </a>
                          )}
                        </div>
                        <span className="workflow-lead-location">
                          {lead.segment}
                          {lead.location ? ` · ${lead.location}` : ""}
                        </span>
                        <span className="workflow-lead-opps">
                          {(lead.opportunities ?? []).join(", ")}
                        </span>
                      </td>
                      <td>
                        <span
                          className="workflow-lead-score"
                          style={{ color: scoreColor }}
                          title={lead.reasoning}
                        >
                          {score}/10
                        </span>
                      </td>
                      <td>
                        <textarea
                          className="workflow-lead-message"
                          value={message}
                          rows={5}
                          onChange={(e) =>
                            setDrafts((prev) => ({
                              ...prev,
                              [lead.leadKey]: e.target.value,
                            }))
                          }
                          placeholder={
                            lead.message === null
                              ? "Mensagem não gerada — escreva à mão."
                              : ""
                          }
                        />
                      </td>
                      <td>
                        <div className="workflow-lead-actions">
                          {href ? (
                            <a
                              href={href}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="workflow-btn-sm workflow-btn--whatsapp"
                              title="Abrir WhatsApp com esta mensagem"
                              onClick={() => markContacted(lead.leadKey)}
                            >
                              📲
                            </a>
                          ) : (
                            <span className="workflow-lead-no-phone">sem tel.</span>
                          )}
                          <button
                            type="button"
                            className="workflow-btn-sm"
                            title="Copiar mensagem"
                            disabled={!message.trim()}
                            onClick={() => copyMessage(lead.leadKey, message)}
                          >
                            {copiedKey === lead.leadKey ? "✅" : "📋"}
                          </button>
                          {lead.phone && (
                            <span className="workflow-lead-phone">{lead.phone}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="workflow-review-actions">
            <button
              onClick={() => resumeWorkflow("approve")}
              className="workflow-btn workflow-btn--approve"
            >
              ✅ Concluir
            </button>
            <button
              onClick={() =>
                exportCsv((interruptPayload.leads as ReviewLead[]) ?? [])
              }
              className="workflow-btn"
              title="Baixar a tabela como CSV"
            >
              ⬇ CSV
            </button>
            <button
              onClick={() => resumeWorkflow("reject")}
              className="workflow-btn workflow-btn--reject"
              title="Descartar esta leva sem contatar"
            >
              ✕ Descartar
            </button>
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
      return event.data.status === "failed"
        ? "Workflow encerrado sem leads novos"
        : "Workflow concluído com sucesso";
    case "error":
      return `Erro: ${event.data.error ?? "desconhecido"}`;
    default:
      return JSON.stringify(event.data).slice(0, 100);
  }
}
