"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Volume2,
  VolumeX,
  Headphones,
  Maximize2,
  Minimize2,
  MessageSquare,
  Zap,
} from "lucide-react";
import { OdinBackground } from "@/components/interface/OdinBackground";
import { SplineScene } from "@/components/ui/splite";
import { CommandInput } from "@/components/interface/CommandInput";
import { ResponseStream } from "@/components/interface/ResponseStream";
import { VoiceVisualizer } from "@/components/interface/VoiceVisualizer";
import { SurfFloatingWidget } from "@/components/interface/SurfFloatingWidget";
import { FollowUpChips } from "@/components/interface/FollowUpChips";
import { ThoughtBubble } from "@/components/interface/ThoughtBubble";
import { WorkflowPanel } from "@/components/interface/WorkflowPanel";
import { useSpeechSynthesis } from "@/lib/voice/use-speech-synthesis";
import { useOdinBehaviors } from "@/lib/ai/idle-controller";
import { cn, stripToolMarkers } from "@/lib/utils";
import type { Message } from "@/types";
import type { Application } from "@splinetool/runtime";

const SPLINE_FACE_OBJECT = "Visor";

type ExpandedPanel = "none" | "chat" | "workflow";

export default function Cockpit() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  // Painel expandido: "none", "chat" ou "workflow"
  const [expandedPanel, setExpandedPanel] = useState<ExpandedPanel>("none");
  const abortRef = useRef<AbortController | null>(null);
  const hasConversation = messages.length > 0 || !!streaming;

  // Fechar o modo expandido ao pressionar a tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && expandedPanel !== "none") {
        setExpandedPanel("none");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expandedPanel]);

  // Voz do Odin (TTS).
  const tts = useSpeechSynthesis();
  const ttsEnabledRef = useRef(false);
  ttsEnabledRef.current = tts.enabled;

  // Instância da cena Spline.
  const splineAppRef = useRef<Application | null>(null);
  const [splineApp, setSplineApp] = useState<Application | null>(null);
  const [isListening, setIsListening] = useState(false);

  const handleSplineLoad = useCallback((app: Application) => {
    splineAppRef.current = app;
    setSplineApp(app);
  }, []);

  // Idle and active behaviors manager for Odin
  const { currentState: _currentState } = useOdinBehaviors({
    app: splineApp,
    speaking: tts.speaking,
    listening: isListening,
    thinking: isLoading,
  });

  // Glow pulse no robô 3D
  const { volumeRef } = tts;
  useEffect(() => {
    if (!tts.speaking) return;
    const obj = splineAppRef.current?.findObjectByName(SPLINE_FACE_OBJECT);
    if (!obj) return;

    let raf = 0;
    const loop = () => {
      const v = volumeRef.current ?? 0;
      try {
        obj.scale.y = 1 + v * 0.6;
        const r = Math.round(10 + (34 - 10) * v);
        const g = Math.round(40 + (211 - 40) * v);
        const b = Math.round(80 + (238 - 80) * v);
        obj.color = `rgb(${r}, ${g}, ${b})`;
      } catch {
        // objeto sem material/escala manipulável → ignora
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      try {
        obj.scale.y = 1;
      } catch { }
    };
  }, [tts.speaking, volumeRef]);

  // Modo Conversa Contínua.
  const [conversationMode, setConversationMode] = useState(false);

  // Chips de follow-up.
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Estados do Surf Report
  const [surfData, setSurfData] = useState<any>(null);
  const [surfLoading, setSurfLoading] = useState(true);
  const [surfError, setSurfError] = useState<string | null>(null);

  // Fetch do Surf Report
  const fetchSurf = useCallback(async () => {
    try {
      setSurfLoading(true);
      setSurfError(null);
      const res = await fetch("/api/surf");
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setSurfData(data);
        } else {
          setSurfError(data.error || "Falha ao ler dados de surf.");
        }
      } else {
        setSurfError(`Erro HTTP: ${res.status}`);
      }
    } catch (err) {
      console.error(err);
      setSurfError("Falha na conexão.");
    } finally {
      setSurfLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSurf();
  }, [fetchSurf]);

  const handleSend = useCallback(
    async (text: string) => {
      if (isLoading) return;

      const userMessage: Message = { role: "user", content: text };
      const history = [...messages, userMessage];

      setMessages(history);
      setStreaming("");
      setSuggestions([]);
      setIsLoading(true);
      tts.cancel();

      const controller = new AbortController();
      abortRef.current = controller;
      let acc = "";

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: history }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          throw new Error(`Falha na resposta (${res.status}).`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let lastIndex = 0;
        const sentenceEndRegex = /(?:[^.!?\n]|\.(?=\d))+[.!?\n]+(?=\s|$)/;

        for (; ;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setStreaming(acc);

          if (ttsEnabledRef.current) {
            let remaining = acc.slice(lastIndex);
            let match;
            while ((match = remaining.match(sentenceEndRegex))) {
              const sentence = match[0].trim();
              lastIndex += match.index! + match[0].length;
              if (sentence && !sentence.includes("⚙️ Odin acionando")) {
                tts.speak(sentence);
              }
              remaining = acc.slice(lastIndex);
            }
          }
        }

        const finalHistory: Message[] = [
          ...history,
          { role: "assistant", content: acc },
        ];
        setMessages(finalHistory);

        if (ttsEnabledRef.current) {
          const remaining = stripToolMarkers(acc.slice(lastIndex)).trim();
          if (remaining) {
            tts.speak(remaining);
          }
        }

        fetch("/api/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: finalHistory }),
        })
          .then((r) => (r.ok ? r.json() : { suggestions: [] }))
          .then((d) => setSuggestions(Array.isArray(d.suggestions) ? d.suggestions : []))
          .catch(() => setSuggestions([]));
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setMessages([
            ...history,
            { role: "assistant", content: acc || "_(interrompido)_" },
          ]);
        } else {
          const message = err instanceof Error ? err.message : "Erro desconhecido";
          setMessages([
            ...history,
            { role: "assistant", content: `[Odin offline: ${message}]` },
          ]);
        }
      } finally {
        abortRef.current = null;
        setStreaming("");
        setIsLoading(false);
      }
    },
    [isLoading, messages, tts]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const handleBargeIn = useCallback(() => {
    tts.cancel();
    abortRef.current?.abort();
  }, [tts]);

  const toggleVoice = useCallback(() => {
    if (tts.enabled) {
      tts.cancel();
      tts.setEnabled(false);
    } else {
      tts.initAudio();
      tts.setEnabled(true);
    }
  }, [tts]);

  const toggleConversation = useCallback(() => {
    if (conversationMode) {
      setConversationMode(false);
    } else {
      tts.initAudio();
      tts.setEnabled(true);
      setConversationMode(true);
    }
  }, [conversationMode, tts]);

  const toggleExpand = useCallback((panel: "chat" | "workflow") => {
    setExpandedPanel((curr) => (curr === panel ? "none" : panel));
  }, []);

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-transparent">
      {/* Background animado em z-0 (KineticGrid Canvas + Spotlight) */}
      <OdinBackground />

      {/* Floating Utility Bar na parte INFERIOR DIREITA (Surf Report + Controles de Voz) */}
      <header className="fixed bottom-6 right-6 z-40 flex items-center gap-3">
        <SurfFloatingWidget
          data={surfData}
          loading={surfLoading}
          error={surfError}
          onRefresh={fetchSurf}
        />

        <div className="glass flex items-center gap-1.5 p-1 rounded-full border border-white/10 bg-[#0a0e27]/70 shadow-lg">
          <button
            type="button"
            onClick={toggleConversation}
            aria-label={conversationMode ? "Sair do modo conversa" : "Entrar no modo conversa (hands-free)"}
            title={conversationMode ? "Modo conversa ativo - use fones" : "Modo conversa contínua (hands-free)"}
            className={cn(
              "grid size-8 cursor-pointer place-items-center rounded-full transition-all duration-300",
              conversationMode
                ? "bg-[var(--odin-accent)]/20 text-[var(--odin-accent)] shadow-[0_0_12px_rgba(74,158,255,0.3)] animate-pulse"
                : "text-neutral-400 hover:text-neutral-200 hover:bg-white/5"
            )}
          >
            <Headphones className="size-4" />
          </button>

          {tts.supported && (
            <button
              type="button"
              onClick={toggleVoice}
              aria-label={tts.enabled ? "Desativar voz do Odin" : "Ativar voz do Odin"}
              title={tts.enabled ? "Voz do Odin ativada" : "Ativar resposta em voz"}
              className={cn(
                "grid size-8 cursor-pointer place-items-center rounded-full transition-all duration-300",
                tts.enabled
                  ? "bg-[var(--odin-accent)]/20 text-[var(--odin-accent)] shadow-[0_0_12px_rgba(74,158,255,0.3)]"
                  : "text-neutral-400 hover:text-neutral-200 hover:bg-white/5",
                tts.speaking && "animate-pulse"
              )}
            >
              {tts.enabled ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            </button>
          )}
        </div>
      </header>

      {/* HUD Esquerdo: Chat Cockpit (z-20 sobre o robô 3D z-10) */}
      <section
        className={cn(
          "glass fixed z-20 flex flex-col overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-[0_10px_50px_rgba(0,0,0,0.5)] border-white/10 cursor-pointer",
          expandedPanel === "chat"
            ? "inset-4 md:right-[36vw] md:max-w-none rounded-3xl border-[var(--odin-accent)]/40 shadow-[0_0_80px_rgba(74,158,255,0.15)] cursor-default"
            : expandedPanel === "workflow"
              ? "left-4 top-4 bottom-4 w-14 rounded-3xl opacity-80 hover:opacity-100 border-[var(--odin-accent)]/30 hover:border-[var(--odin-accent)]"
              : "inset-4 md:inset-auto md:left-6 md:top-6 md:bottom-6 md:w-[460px] rounded-3xl hover:border-[var(--odin-accent)]/30"
        )}
        onClick={expandedPanel !== "chat" ? () => setExpandedPanel("chat") : undefined}
      >
        {expandedPanel === "workflow" ? (
          /* Sidebar Vertical Limpa Quando Recolhido */
          <div className="flex-1 flex flex-col items-center justify-between py-6 px-1">
            <button
              type="button"
              onClick={() => setExpandedPanel("chat")}
              className="p-2 rounded-xl text-[var(--odin-accent)] hover:bg-white/10 transition-all cursor-pointer"
              title="Expandir Chat"
            >
              <MessageSquare className="size-5" />
            </button>
            <span className="font-mono text-[10px] font-bold tracking-[0.35em] text-neutral-300 uppercase whitespace-nowrap [writing-mode:vertical-lr] rotate-180">
              ODIN CHAT
            </span>
            <Maximize2 className="size-4 text-neutral-400" />
          </div>
        ) : (
          /* Conteúdo Normal do Chat */
          <>
            {/* Header do Chat */}
            <header className="flex flex-none items-center justify-between px-5 py-4 border-b border-white/5">
              <div className="flex items-center gap-3">
                <div className="size-2 rounded-full bg-[var(--odin-accent)] animate-pulse shadow-[0_0_10px_var(--odin-accent)]" />
                <span className="font-mono text-xs font-bold tracking-[0.35em] text-neutral-100 uppercase whitespace-nowrap">
                  ODIN CHAT
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand("chat");
                  }}
                  aria-label={expandedPanel === "chat" ? "Recolher Chat" : "Expandir Chat"}
                  title={expandedPanel === "chat" ? "Recolher painel de chat (Esc)" : "Expandir painel de chat"}
                  className={cn(
                    "grid size-8 cursor-pointer place-items-center rounded-xl transition-all duration-200",
                    expandedPanel === "chat"
                      ? "bg-[var(--odin-accent)]/25 text-[var(--odin-accent)] border border-[var(--odin-accent)]/30"
                      : "text-neutral-400 hover:text-neutral-100 hover:bg-white/5"
                  )}
                >
                  {expandedPanel === "chat" ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </button>
              </div>
            </header>

            <div className="flex min-h-0 flex-1 flex-col pb-3">
              {hasConversation ? (
                <ResponseStream messages={messages} streaming={streaming} isLoading={isLoading} />
              ) : (
                <div
                  className={cn(
                    "w-full flex-1 flex flex-col px-6 transition-all duration-500 ease-in-out",
                    expandedPanel === "chat" ? "justify-center items-center text-center my-auto" : "justify-end items-start pb-6"
                  )}
                >
                  <Hero isExpanded={expandedPanel === "chat"} />
                </div>
              )}
            </div>

            {/* Input de Comando */}
            <div className="flex-none px-5 pb-5" onClick={(e) => e.stopPropagation()}>
              {suggestions.length > 0 && (
                <div className="mb-3">
                  <FollowUpChips
                    suggestions={suggestions}
                    onPick={handleSend}
                    disabled={isLoading}
                  />
                </div>
              )}
              <CommandInput
                onSubmit={handleSend}
                onStop={handleStop}
                onVoiceStart={tts.cancel}
                isLoading={isLoading}
                conversationMode={conversationMode}
                odinSpeaking={tts.speaking}
                onBargeIn={handleBargeIn}
                onListeningChange={setIsListening}
              />
              <p className="mt-2 text-center font-mono text-[10px] tracking-wider text-neutral-600">
                Enter envia · Shift+Enter quebra linha
              </p>
            </div>
          </>
        )}
      </section>

      {/* HUD Direito: Agents & Workflows Panel (z-20 sobre o robô 3D z-10) */}
      <section
        className={cn(
          "glass fixed z-20 flex flex-col overflow-hidden transition-all duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-[0_10px_50px_rgba(0,0,0,0.5)] border-white/10 cursor-pointer",
          expandedPanel === "workflow"
            ? "inset-4 md:left-[36vw] md:max-w-none rounded-3xl border-[var(--odin-accent)]/40 shadow-[0_0_80px_rgba(74,158,255,0.15)] cursor-default"
            : expandedPanel === "chat"
              ? "right-4 top-4 bottom-4 w-14 rounded-3xl opacity-80 hover:opacity-100 border-[var(--odin-accent)]/30 hover:border-[var(--odin-accent)]"
              : "inset-4 md:inset-auto md:right-6 md:top-6 md:bottom-6 md:w-[460px] rounded-3xl hidden lg:flex hover:border-[var(--odin-accent)]/30"
        )}
        onClick={expandedPanel !== "workflow" ? () => setExpandedPanel("workflow") : undefined}
      >
        {expandedPanel === "chat" ? (
          /* Sidebar Vertical Limpa Quando Recolhido */
          <div className="flex-1 flex flex-col items-center justify-between py-6 px-1">
            <button
              type="button"
              onClick={() => setExpandedPanel("workflow")}
              className="p-2 rounded-xl text-[var(--odin-accent)] hover:bg-white/10 transition-all cursor-pointer"
              title="Expandir Workflows"
            >
              <Zap className="size-5" />
            </button>
            <span className="font-mono text-[10px] font-bold tracking-[0.35em] text-neutral-300 uppercase whitespace-nowrap [writing-mode:vertical-lr] rotate-180">
              WORKFLOWS
            </span>
            <Maximize2 className="size-4 text-neutral-400" />
          </div>
        ) : (
          /* Conteúdo Normal dos Workflows */
          <>
            {/* Header dos Workflows */}
            <header className="flex flex-none items-center justify-between px-5 py-4 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <Zap className="size-4 text-[var(--odin-accent)] animate-pulse" />
                <span className="font-mono text-xs font-bold tracking-[0.35em] text-neutral-100 uppercase whitespace-nowrap">
                  AGENTS & WORKFLOWS
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand("workflow");
                  }}
                  aria-label={expandedPanel === "workflow" ? "Recolher Agentes" : "Expandir Agentes"}
                  title={expandedPanel === "workflow" ? "Recolher painel de agentes (Esc)" : "Expandir painel de agentes"}
                  className={cn(
                    "grid size-8 cursor-pointer place-items-center rounded-xl transition-all duration-200",
                    expandedPanel === "workflow"
                      ? "bg-[var(--odin-accent)]/25 text-[var(--odin-accent)] border border-[var(--odin-accent)]/30"
                      : "text-neutral-400 hover:text-neutral-100 hover:bg-white/5"
                  )}
                >
                  {expandedPanel === "workflow" ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </button>
              </div>
            </header>

            <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar" onClick={(e) => e.stopPropagation()}>
              <WorkflowPanel />
            </div>
          </>
        )}
      </section>

      {/* Holograma 3D do Robô em Segundo Plano (Full-Bleed z-10 centralizado no espaço livre) */}
      <section
        className={cn(
          "fixed inset-0 z-10 h-full w-full pointer-events-none transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
          expandedPanel === "none"
            ? "translate-x-0"
            : expandedPanel === "chat"
              ? "translate-x-[30vw]"
              : "-translate-x-[30vw]"
        )}
      >
        <VoiceVisualizer volumeRef={tts.volumeRef} active={tts.speaking} layer="back" />

        <SplineScene
          scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
          className="h-full w-full pointer-events-auto"
          onLoad={handleSplineLoad}
        />

        <VoiceVisualizer volumeRef={tts.volumeRef} active={tts.speaking} layer="front" />

        <ThoughtBubble isLoading={isLoading} streaming={streaming} speaking={tts.speaking} />
      </section>
    </main>
  );
}

function Hero({ isExpanded }: { isExpanded?: boolean }) {
  return (
    <div
      className={cn(
        "animate-in fade-in duration-700 transition-all duration-500 ease-in-out flex flex-col",
        isExpanded ? "items-center text-center max-w-xl mx-auto" : "items-start text-left max-w-md pb-6"
      )}
    >
      <h1
        className={cn(
          "bg-gradient-to-b from-white via-neutral-200 to-neutral-500 bg-clip-text font-bold text-transparent transition-all duration-500 ease-in-out",
          isExpanded
            ? "text-6xl md:text-7xl lg:text-8xl tracking-[0.15em] drop-shadow-[0_0_35px_rgba(56,189,248,0.2)]"
            : "text-5xl md:text-6xl tracking-tight"
        )}
      >
        ODIN
      </h1>
      <p
        className={cn(
          "mt-4 text-balance text-neutral-300 transition-all duration-500 ease-in-out leading-relaxed",
          isExpanded ? "text-lg md:text-xl max-w-lg font-light text-neutral-200" : "text-sm md:text-base max-w-md"
        )}
      >
        A versão externa do seu cérebro. Digite um comando abaixo para começar.
      </p>
    </div>
  );
}
