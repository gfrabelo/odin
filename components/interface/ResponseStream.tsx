"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn, stripToolMarkers } from "@/lib/utils";
import type { Message } from "@/types";

interface ResponseStreamProps {
  messages: Message[];
  /** Texto parcial do assistant chegando em tempo real (vazio quando ocioso). */
  streaming: string;
  isLoading?: boolean;
}

/**
 * Conversa sobreposta ao 3D. Bolhas em vidro, markdown nas respostas do Odin.
 * Scroll próprio bottom-anchored: mensagens curtas ficam ancoradas embaixo
 * (perto do input); quando passam da altura, rolam - sempre seguindo o fim.
 */
export function ResponseStream({ messages, streaming, isLoading }: ResponseStreamProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // O status de tool ("⚙️ Odin acionando") vive no ThoughtBubble; aqui o
  // chat só mostra conteúdo. Enquanto o stream contém apenas o marcador,
  // seguem os dots de "pensando".
  const visibleStreaming = stripToolMarkers(streaming);

  // Segue o fim a cada token/mensagem. scrollTop = scrollHeight é o método
  // mais confiável para chat (não depende de scrollIntoView no documento).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streaming, isLoading]);

  return (
    <div
      ref={scrollRef}
      className="odin-scroll pointer-events-auto min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col justify-end gap-4 px-4 py-2 md:px-10">
        {messages.map((m, i) => (
          <Bubble key={i} role={m.role} content={m.content} />
        ))}

        {isLoading && !visibleStreaming.trim() && (
          <Bubble role="assistant" content="" thinking />
        )}

        {visibleStreaming.trim() && (
          <Bubble role="assistant" content={visibleStreaming} streaming />
        )}
      </div>
    </div>
  );
}

function Bubble({
  role,
  content,
  streaming,
  thinking,
}: {
  role: Message["role"];
  content: string;
  streaming?: boolean;
  thinking?: boolean;
}) {
  const isUser = role === "user";
  return (
    <div
      className={cn(
        "max-w-[min(36rem,85%)] animate-in fade-in slide-in-from-bottom-2 duration-300",
        isUser ? "self-end" : "self-start"
      )}
    >
      <div
        className={cn(
          "mb-1 font-mono text-[10px] uppercase tracking-[0.25em]",
          isUser ? "text-right text-neutral-400" : "text-left text-[var(--odin-accent)]/80"
        )}
      >
        {isUser ? "você" : "odin"}
      </div>
      <div
        className={cn(
          "rounded-2xl px-4 py-3 text-sm leading-relaxed",
          isUser
            ? "whitespace-pre-wrap bg-white/10 text-neutral-50 backdrop-blur-md"
            : "glass text-neutral-100"
        )}
      >
        {thinking ? (
          <div className="flex items-center gap-1.5 py-1 px-1">
            <span className="size-2 animate-bounce rounded-full bg-[var(--odin-accent)] [animation-delay:-0.3s]" />
            <span className="size-2 animate-bounce rounded-full bg-[var(--odin-accent)] [animation-delay:-0.15s]" />
            <span className="size-2 animate-bounce rounded-full bg-[var(--odin-accent)]" />
          </div>
        ) : isUser ? (
          content
        ) : (
          <div className="odin-md">
            {/* Histórico guarda o acc cru do stream — limpa marcadores de tool. */}
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripToolMarkers(content)}</ReactMarkdown>
          </div>
        )}
        {streaming && !thinking && (
          <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 animate-pulse bg-[var(--odin-accent)]" />
        )}
      </div>
    </div>
  );
}
