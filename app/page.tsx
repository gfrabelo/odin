"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, Database, Cpu, Layers, RefreshCw, Trash2, Headphones, Waves, Maximize2, Minimize2 } from "lucide-react";
import { OdinBackground } from "@/components/interface/OdinBackground";
import { SplineScene } from "@/components/ui/splite";
import { CommandInput } from "@/components/interface/CommandInput";
import { ResponseStream } from "@/components/interface/ResponseStream";
import { VoiceVisualizer } from "@/components/interface/VoiceVisualizer";
import { SurfWidget } from "@/components/interface/SurfWidget";
import { FollowUpChips } from "@/components/interface/FollowUpChips";
import { ThoughtBubble } from "@/components/interface/ThoughtBubble";
import { WorkflowPanel } from "@/components/interface/WorkflowPanel";
import { useSpeechSynthesis } from "@/lib/voice/use-speech-synthesis";
import { useOdinBehaviors } from "@/lib/ai/idle-controller";
import { cn, stripToolMarkers } from "@/lib/utils";
import type { Message } from "@/types";
import type { Application } from "@splinetool/runtime";

/**
 * Nome do objeto no robô Spline cujo material/escala reage à voz (glow pulse).
 * A cena atual pode não expor um objeto com este nome - neste caso a manipulação
 * é um no-op silencioso e o <VoiceVisualizer/> cobre o efeito. Ajuste depois de
 * inspecionar os nomes dos objetos da cena.
 */
const SPLINE_FACE_OBJECT = "Visor";

export default function Cockpit() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isChatExpanded, setIsChatExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "workflows">("chat");
  const abortRef = useRef<AbortController | null>(null);
  const hasConversation = messages.length > 0 || !!streaming;

  // Fechar o modo expandido ao pressionar a tecla Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isChatExpanded) {
        setIsChatExpanded(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isChatExpanded]);

  // Voz do Odin (TTS). ttsEnabledRef evita closure obsoleto no handleSend.
  const tts = useSpeechSynthesis();
  const ttsEnabledRef = useRef(false);
  ttsEnabledRef.current = tts.enabled;

  // Instância da cena Spline (para manipular o robô best-effort no glow pulse).
  const splineAppRef = useRef<Application | null>(null);
  const [splineApp, setSplineApp] = useState<Application | null>(null);
  const [isListening, setIsListening] = useState(false);

  const handleSplineLoad = useCallback((app: Application) => {
    splineAppRef.current = app;
    setSplineApp(app);
  }, []);

  // Idle and active behaviors manager for Odin
  const { currentState } = useOdinBehaviors({
    app: splineApp,
    speaking: tts.speaking,
    listening: isListening,
    thinking: isLoading,
  });

  // Glow pulse no robô 3D: enquanto o Odin fala, lê tts.volumeRef num rAF e tenta
  // animar escala/cor de emissão do objeto. Se o objeto não existir, no-op (o
  // VoiceVisualizer já garante o efeito). Roda só durante a fala.
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
        // Emissão ciano (alto volume) ↔ azul-escuro (silêncio).
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
        obj.scale.y = 1; // restaura ao parar de falar
      } catch { }
    };
  }, [tts.speaking, volumeRef]);

  // Modo Conversa Contínua (hands-free + barge-in).
  const [conversationMode, setConversationMode] = useState(false);

  // Chips de follow-up (structured output): 3 sugestões após cada resposta.
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Estados do RAG e sincronização do HUD Direito
  const [ragStats, setRagStats] = useState<{ count: number; loading: boolean }>({ count: 0, loading: true });
  const [isSyncing, setIsSyncing] = useState(false);

  // Estados do Surf Report
  const [surfData, setSurfData] = useState<any>(null);
  const [surfLoading, setSurfLoading] = useState(true);
  const [surfError, setSurfError] = useState<string | null>(null);

  // Fetch das estatísticas do Supabase
  const fetchStats = useCallback(async () => {
    try {
      setRagStats((prev) => ({ ...prev, loading: true }));
      const res = await fetch("/api/stats");
      if (res.ok) {
        const data = await res.json();
        setRagStats({ count: data.count || 0, loading: false });
      } else {
        setRagStats((prev) => ({ ...prev, loading: false }));
      }
    } catch (err) {
      console.error(err);
      setRagStats((prev) => ({ ...prev, loading: false }));
    }
  }, []);

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

  // Sincronização incremental do Obsidian
  const handleSync = useCallback(async () => {
    if (isSyncing) return;
    try {
      setIsSyncing(true);
      const res = await fetch("/api/sync", { method: "POST" });
      if (res.ok) {
        await Promise.all([fetchStats(), fetchSurf()]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, fetchStats, fetchSurf]);

  // Limpar conversa
  const handleClearChat = useCallback(() => {
    setMessages([]);
    setStreaming("");
    setSuggestions([]);
    tts.cancel();
  }, [tts]);

  // Carregar estatísticas e surf no mount
  useEffect(() => {
    fetchStats();
    fetchSurf();
  }, [fetchStats, fetchSurf]);

  const handleSend = useCallback(
    async (text: string) => {
      if (isLoading) return;

      const userMessage: Message = { role: "user", content: text };
      const history = [...messages, userMessage];

      setMessages(history);
      setStreaming("");
      setSuggestions([]); // some com os chips antigos enquanto responde
      setIsLoading(true);
      tts.cancel(); // Odin para de falar ao receber novo comando

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
              // Marcador de tool é status visual (ThoughtBubble), não fala.
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

        // Chips de follow-up: fire-and-forget, nunca bloqueia a UI nem
        // atrasa o fim do loading. Em qualquer falha, fica sem chips.
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
          // Interrompido pelo usuário: preserva o que já foi gerado.
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

  // Barge-in: usuário falou enquanto o Odin falava → corta a voz e a geração.
  const handleBargeIn = useCallback(() => {
    tts.cancel();
    abortRef.current?.abort();
  }, [tts]);

  const toggleVoice = useCallback(() => {
    if (tts.enabled) {
      tts.cancel();
      tts.setEnabled(false);
    } else {
      tts.initAudio(); // gesto do usuário: cria/retoma o AudioContext do glow pulse
      tts.setEnabled(true);
    }
  }, [tts]);

  // Modo Conversa: ligar também ativa a voz (TTS) e o AudioContext.
  const toggleConversation = useCallback(() => {
    if (conversationMode) {
      setConversationMode(false);
    } else {
      tts.initAudio();
      tts.setEnabled(true);
      setConversationMode(true);
    }
  }, [conversationMode, tts]);

  return (
    <main className="relative h-dvh w-screen overflow-hidden">
      {/* Camada -z-10: background puro (shader + spotlight + scrims) */}
      <OdinBackground />

      {/* Console de Comando e Chat Flutuante (HUD Esquerdo) */}
      <section
        className={cn(
          "glass fixed z-20 flex flex-col overflow-hidden transition-all duration-300 ease-in-out",
          isChatExpanded
            ? "inset-4 md:inset-8 md:max-w-5xl md:mx-auto rounded-2xl md:rounded-3xl shadow-[0_0_80px_rgba(0,0,0,0.8)] backdrop-blur-2xl bg-[#0a0e27]/85 border-[var(--odin-accent)]/30"
            : "inset-4 md:inset-auto md:left-8 md:top-8 md:bottom-8 md:w-[450px] rounded-2xl md:rounded-3xl"
        )}
      >
        {/* Header */}
        <header className="flex flex-none items-center justify-between px-6 py-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-semibold tracking-[0.4em] text-neutral-100">
              ODIN
            </span>
            {/* Tab toggle: Chat ↔ Workflows */}
            <div className="flex items-center gap-1 ml-2 rounded-lg bg-white/[0.03] border border-white/[0.06] p-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("chat")}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-[0.15em] transition-all duration-200 cursor-pointer",
                  activeTab === "chat"
                    ? "bg-[var(--odin-accent)]/15 text-[var(--odin-accent)] shadow-sm"
                    : "text-neutral-500 hover:text-neutral-300"
                )}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("workflows")}
                className={cn(
                  "px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-[0.15em] transition-all duration-200 cursor-pointer",
                  activeTab === "workflows"
                    ? "bg-[var(--odin-accent)]/15 text-[var(--odin-accent)] shadow-sm"
                    : "text-neutral-500 hover:text-neutral-300"
                )}
              >
                ⚡ Agents
              </button>
            </div>
          </div>
          <div className="flex items-center gap-3 md:gap-4">
            <button
              type="button"
              onClick={() => setIsChatExpanded((prev) => !prev)}
              aria-label={isChatExpanded ? "Recolher janela de chat" : "Expandir janela de chat em tela cheia"}
              title={isChatExpanded ? "Recolher janela (Esc)" : "Expandir conversa em tela cheia"}
              className={cn(
                "grid size-8 cursor-pointer place-items-center rounded-lg transition-all duration-200",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--odin-accent)]",
                isChatExpanded
                  ? "bg-[var(--odin-accent)]/20 text-[var(--odin-accent)]"
                  : "text-neutral-500 hover:text-neutral-300"
              )}
            >
              {isChatExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            <button
              type="button"
              onClick={toggleConversation}
              aria-label={conversationMode ? "Sair do modo conversa" : "Entrar no modo conversa (hands-free)"}
              title={conversationMode ? "Modo conversa ativo - use fones" : "Modo conversa contínua (hands-free)"}
              className={cn(
                "grid size-8 cursor-pointer place-items-center rounded-lg transition-all duration-200",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--odin-accent)]",
                conversationMode
                  ? "bg-[var(--odin-accent)]/15 text-[var(--odin-accent)]"
                  : "text-neutral-500 hover:text-neutral-300",
                conversationMode && "animate-pulse"
              )}
            >
              <Headphones className="size-4" />
            </button>
            {tts.supported && (
              <button
                type="button"
                onClick={toggleVoice}
                aria-label={tts.enabled ? "Desativar voz do Odin" : "Ativar voz do Odin"}
                className={cn(
                  "grid size-8 cursor-pointer place-items-center rounded-lg transition-all duration-200",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--odin-accent)]",
                  tts.enabled
                    ? "bg-[var(--odin-accent)]/15 text-[var(--odin-accent)]"
                    : "text-neutral-500 hover:text-neutral-300",
                  tts.speaking && "animate-pulse"
                )}
              >
                {tts.enabled ? (
                  <Volume2 className="size-4" />
                ) : (
                  <VolumeX className="size-4" />
                )}
              </button>
            )}
            <div className="flex items-center gap-2">
              <span className="size-2 animate-pulse rounded-full bg-[var(--odin-accent)] shadow-[0_0_12px_var(--odin-accent)]" />
              <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-400">
                online
              </span>
            </div>
          </div>
        </header>

        {/* Área Central: Chat ou Workflows (tab-based) */}
        {activeTab === "chat" ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col pb-3">
              {hasConversation ? (
                <ResponseStream messages={messages} streaming={streaming} isLoading={isLoading} />
              ) : (
                <div
                  className={cn(
                    "w-full flex-1 flex flex-col px-6 transition-all duration-500 ease-in-out",
                    isChatExpanded ? "justify-center items-center text-center my-auto" : "justify-end items-start pb-6"
                  )}
                >
                  <Hero isExpanded={isChatExpanded} />
                </div>
              )}
            </div>

            {/* Input de Comando */}
            <div className="flex-none px-6 pb-6 md:pb-8">
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
        ) : (
          <WorkflowPanel />
        )}
      </section>

      {/* HUD Direito: Painel de Controle (Superior) + Surf Report (Inferior) */}
      <section
        className={cn(
          "fixed right-8 top-8 bottom-8 w-[320px] z-10 hidden xl:flex flex-col gap-4 transition-all duration-300 ease-in-out",
          isChatExpanded
            ? "opacity-0 pointer-events-none translate-x-8"
            : "opacity-100 translate-x-0 animate-in fade-in slide-in-from-right-3 duration-500"
        )}
      >
        {/* Painel de Controle (Superior) */}
        <div className="glass flex flex-col rounded-3xl overflow-hidden p-5 text-neutral-200 font-mono shrink-0">
          <div className="border-b border-white/10 pb-3">
            <div className="flex items-center gap-2 text-[var(--odin-accent)]">
              <Cpu className="size-4 animate-pulse" />
              <h2 className="text-xs font-semibold uppercase tracking-[0.25em]">Painel de Controle</h2>
            </div>
            <p className="mt-1 text-[9px] uppercase tracking-wider text-neutral-500">status do sistema</p>
          </div>

          <div className="py-4 flex flex-col gap-4 text-xs">
            {/* Métricas do Core */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 border-b border-white/5 pb-1 text-[10px] uppercase tracking-wider text-neutral-400">
                <Layers className="size-3.5" />
                <span>Core Engine</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-500">Odin State:</span>
                <span className="text-[var(--odin-accent)] font-bold uppercase tracking-wider animate-pulse">{currentState}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-500">LLM Core:</span>
                <span className="text-neutral-100 font-bold">gemini-2.5-flash</span>
              </div>
            </div>

            {/* RAG & Supabase */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 border-b border-white/5 pb-1 text-[10px] uppercase tracking-wider text-neutral-400">
                <Database className="size-3.5" />
                <span>Segundo Cérebro</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-500">Source:</span>
                <span className="text-neutral-100">obsidian/wiki</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-500">Banco RAG:</span>
                <span className="text-neutral-100 font-bold">Supabase</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-neutral-500">Chunks Vetoriais:</span>
                {ragStats.loading ? (
                  <span className="text-neutral-500 animate-pulse">lendo...</span>
                ) : (
                  <span className="text-neutral-100 font-bold">{ragStats.count}</span>
                )}
              </div>
            </div>
          </div>

          {/* Painel de Controles */}
          <div className="border-t border-white/10 pt-3 flex flex-col gap-2">
            <button
              onClick={handleSync}
              disabled={isSyncing}
              className={cn(
                "w-full h-8 flex items-center justify-center gap-2 rounded-lg border text-xs font-semibold transition-all duration-200 cursor-pointer",
                isSyncing
                  ? "bg-neutral-800/50 border-neutral-700 text-neutral-500 cursor-wait"
                  : "bg-[var(--odin-accent)]/10 border-[var(--odin-accent)]/30 text-[var(--odin-accent)] hover:bg-[var(--odin-accent)]/20 active:scale-[0.98]"
              )}
            >
              <RefreshCw className={cn("size-3", isSyncing && "animate-spin")} />
              {isSyncing ? "Sincronizando..." : "Sincronizar Vault"}
            </button>

            <button
              onClick={handleClearChat}
              className="w-full h-8 flex items-center justify-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 text-neutral-400 text-xs font-semibold hover:bg-neutral-900/80 hover:text-white transition-all duration-200 active:scale-[0.98] cursor-pointer"
            >
              <Trash2 className="size-3" />
              Limpar Conversa
            </button>
          </div>
        </div>

        {/* Surf Report & Clima (Inferior) */}
        <div className="glass flex flex-col rounded-3xl overflow-hidden p-5 text-neutral-200 font-mono flex-1 min-h-0">
          <div className="border-b border-white/10 pb-3 shrink-0">
            <div className="flex items-center gap-2 text-[var(--odin-accent)]">
              <Waves className="size-4 animate-pulse" />
              <h2 className="text-xs font-semibold uppercase tracking-[0.25em]">Surf Report</h2>
            </div>
            <p className="mt-1 text-[9px] uppercase tracking-wider text-neutral-500">condições de peruíbe/sp</p>
          </div>
          <div className="flex-1 py-4 overflow-y-auto select-none no-scrollbar">
            <SurfWidget data={surfData} loading={surfLoading} error={surfError} />
          </div>
        </div>
      </section>

      {/* Holograma 3D do Robô em Segundo Plano (Centralizado no espaço livre com sobreposição para evitar cortes) */}
      <section className="fixed inset-0 z-0 h-full w-full md:left-[350px] md:right-0 xl:right-[240px] md:w-auto">
        {/* Anel ATRÁS da cabeça: vem antes do canvas no DOM → o robô o oclui (profundidade 3D). */}
        <VoiceVisualizer volumeRef={tts.volumeRef} active={tts.speaking} layer="back" />

        <SplineScene
          scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
          className="h-full w-full"
          onLoad={handleSplineLoad}
        />

        {/* Halo difuso por cima (brilho que vaza na frente). */}
        <VoiceVisualizer volumeRef={tts.volumeRef} active={tts.speaking} layer="front" />

        {/* Balão de pensamento: etapa real do pipeline acima da cabeça do robô. */}
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
