"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, VolumeX, Database, Cpu, Layers, RefreshCw, Trash2 } from "lucide-react";
import { OdinBackground } from "@/components/interface/OdinBackground";
import { SplineScene } from "@/components/ui/splite";
import { CommandInput } from "@/components/interface/CommandInput";
import { ResponseStream } from "@/components/interface/ResponseStream";
import { useSpeechSynthesis } from "@/lib/voice/use-speech-synthesis";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";

export default function Cockpit() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const hasConversation = messages.length > 0 || !!streaming;

  // Voz do Odin (TTS). ttsEnabledRef evita closure obsoleto no handleSend.
  const tts = useSpeechSynthesis();
  const ttsEnabledRef = useRef(false);
  ttsEnabledRef.current = tts.enabled;

  // Estados do RAG e sincronização do HUD Direito
  const [ragStats, setRagStats] = useState<{ count: number; loading: boolean }>({ count: 0, loading: true });
  const [isSyncing, setIsSyncing] = useState(false);

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

  // Sincronização incremental do Obsidian
  const handleSync = useCallback(async () => {
    if (isSyncing) return;
    try {
      setIsSyncing(true);
      const res = await fetch("/api/sync", { method: "POST" });
      if (res.ok) {
        await fetchStats();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, fetchStats]);

  // Limpar conversa
  const handleClearChat = useCallback(() => {
    setMessages([]);
    setStreaming("");
    tts.cancel();
  }, [tts]);

  // Carregar estatísticas no mount
  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  const handleSend = useCallback(
    async (text: string) => {
      if (isLoading) return;

      const userMessage: Message = { role: "user", content: text };
      const history = [...messages, userMessage];

      setMessages(history);
      setStreaming("");
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

        for (;;) {
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
              if (sentence) {
                tts.speak(sentence);
              }
              remaining = acc.slice(lastIndex);
            }
          }
        }

        setMessages([...history, { role: "assistant", content: acc }]);
        
        if (ttsEnabledRef.current) {
          const remaining = acc.slice(lastIndex).trim();
          if (remaining) {
            tts.speak(remaining);
          }
        }
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

  const toggleVoice = useCallback(() => {
    if (tts.enabled) {
      tts.cancel();
      tts.setEnabled(false);
    } else {
      tts.setEnabled(true);
    }
  }, [tts]);

  return (
    <main className="relative h-dvh w-screen overflow-hidden">
      {/* Camada -z-10: background puro (shader + spotlight + scrims) */}
      <OdinBackground />

      {/* Console de Comando e Chat Flutuante (HUD Esquerdo) */}
      <section className="glass fixed inset-4 z-10 flex flex-col rounded-2xl overflow-hidden md:inset-auto md:left-8 md:top-8 md:bottom-8 md:w-[450px] md:rounded-3xl">
        {/* Header */}
        <header className="flex flex-none items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm font-semibold tracking-[0.4em] text-neutral-100">
              ODIN
            </span>
            <span className="hidden text-[10px] uppercase tracking-[0.3em] text-neutral-500 sm:inline">
              orquestrador
            </span>
          </div>
          <div className="flex items-center gap-4">
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

        {/* Área Central: Histórico do Chat ou Hero */}
        <div className="flex min-h-0 flex-1 flex-col pb-3">
          {hasConversation ? (
            <ResponseStream messages={messages} streaming={streaming} />
          ) : (
            <div className="mx-auto mt-auto w-full px-6 pb-6">
              <Hero />
            </div>
          )}
        </div>

        {/* Input de Comando */}
        <div className="flex-none px-6 pb-6 md:pb-8">
          <CommandInput
            onSubmit={handleSend}
            onStop={handleStop}
            onVoiceStart={tts.cancel}
            isLoading={isLoading}
          />
          <p className="mt-2 text-center font-mono text-[10px] tracking-wider text-neutral-600">
            Enter envia · Shift+Enter quebra linha
          </p>
        </div>
      </section>

      {/* HUD de Métricas e Ações Rápidas (Painel Direito) */}
      <section className="glass fixed right-8 top-8 bottom-8 w-[320px] z-10 hidden xl:flex flex-col rounded-3xl overflow-hidden p-6 text-neutral-200 animate-in fade-in slide-in-from-right-3 duration-500 font-mono">
        <div className="border-b border-white/10 pb-4">
          <div className="flex items-center gap-2 text-[var(--odin-accent)]">
            <Cpu className="size-4 animate-pulse" />
            <h2 className="text-xs font-semibold uppercase tracking-[0.25em]">Painel de Controle</h2>
          </div>
          <p className="mt-1 text-[9px] uppercase tracking-wider text-neutral-500">status do sistema em tempo real</p>
        </div>

        <div className="flex-1 min-h-0 py-6 flex flex-col gap-6 text-xs overflow-y-auto">
          {/* Métricas do Core */}
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2 border-b border-white/5 pb-1 text-[10px] uppercase tracking-wider text-neutral-400">
              <Layers className="size-3.5" />
              <span>Core Engine</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-neutral-500">LLM Core:</span>
              <span className="text-neutral-100 font-bold">gemini-2.5-flash</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-neutral-500">TTS Voice:</span>
              <span className="text-[var(--odin-accent)] font-bold">onyx (openai)</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-neutral-500">STT Engine:</span>
              <span className="text-neutral-100">browser api</span>
            </div>
          </div>

          {/* RAG & Supabase */}
          <div className="flex flex-col gap-3">
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
        <div className="border-t border-white/10 pt-4 flex flex-col gap-3">
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className={cn(
              "w-full h-9 flex items-center justify-center gap-2 rounded-lg border text-xs font-semibold transition-all duration-200 cursor-pointer",
              isSyncing
                ? "bg-neutral-800/50 border-neutral-700 text-neutral-500 cursor-wait"
                : "bg-[var(--odin-accent)]/10 border-[var(--odin-accent)]/30 text-[var(--odin-accent)] hover:bg-[var(--odin-accent)]/20 active:scale-[0.98]"
            )}
          >
            <RefreshCw className={cn("size-3.5", isSyncing && "animate-spin")} />
            {isSyncing ? "Sincronizando..." : "Sincronizar Vault"}
          </button>

          <button
            onClick={handleClearChat}
            className="w-full h-9 flex items-center justify-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 text-neutral-400 text-xs font-semibold hover:bg-neutral-900/80 hover:text-white transition-all duration-200 active:scale-[0.98] cursor-pointer"
          >
            <Trash2 className="size-3.5" />
            Limpar Conversa
          </button>
        </div>
      </section>

      {/* Holograma 3D do Robô em Segundo Plano (Centralizado no espaço livre) */}
      <section className="fixed inset-0 z-0 h-full w-full md:left-[450px] md:right-0 xl:right-[320px] md:w-auto">
        <SplineScene
          scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
          className="h-full w-full"
        />
      </section>
    </main>
  );
}

function Hero() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-3 pb-6 duration-700">
      <h1 className="bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-5xl font-bold tracking-tight text-transparent md:text-6xl">
        ODIN
      </h1>
      <p className="mt-4 max-w-md text-balance text-neutral-300">
        A versão externa do seu cérebro. Digite um comando abaixo para começar.
      </p>
    </div>
  );
}
