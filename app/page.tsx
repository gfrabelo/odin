"use client";

import { useCallback, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";
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

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setStreaming(acc);
        }

        setMessages([...history, { role: "assistant", content: acc }]);
        if (ttsEnabledRef.current) tts.speak(acc); // Odin fala a resposta
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
    <main className="relative flex h-dvh flex-col overflow-hidden">
      {/* Camada -z-10: background puro (shader + spotlight + scrims) */}
      <OdinBackground />

      {/* Camada z-0: cena 3D interativa do robô Spline.
          Renderizada diretamente na página para receber eventos de mouse
          nativamente — é assim que o "look at" funciona. */}
      <div className="fixed inset-0 md:left-[18%]">
        <SplineScene
          scene="https://prod.spline.design/kZDDjO5HuC9GJUM2/scene.splinecode"
          className="h-full w-full"
        />
      </div>

      {/* Header — acima do Spline */}
      <header className="z-10 flex items-center justify-between px-6 py-5 md:px-10">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-semibold tracking-[0.4em] text-neutral-100">
            ODIN
          </span>
          <span className="hidden text-[10px] uppercase tracking-[0.3em] text-neutral-500 sm:inline">
            orquestrador de conhecimento
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

      {/* Área central: hero (vazio) ou conversa.
          Scroll é full-bleed (barra na borda da tela); o conteúdo é
          centralizado em max-w-3xl dentro do ResponseStream. */}
      <section className="z-10 flex min-h-0 flex-1 flex-col pb-3 pointer-events-none">
        {hasConversation ? (
          <ResponseStream messages={messages} streaming={streaming} />
        ) : (
          <div className="mx-auto mt-auto w-full max-w-3xl px-4 md:px-10">
            <Hero />
          </div>
        )}
      </section>

      {/* Comando */}
      <section className="z-10 pb-6 md:pb-8 pointer-events-none">
        <div className="mx-auto w-full max-w-3xl px-4 md:px-10 pointer-events-auto">
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
    </main>
  );
}

function Hero() {
  return (
    <div className="animate-in fade-in slide-in-from-bottom-3 pb-6 duration-700">
      <h1 className="bg-gradient-to-b from-white to-neutral-500 bg-clip-text text-6xl font-bold tracking-tight text-transparent md:text-7xl">
        ODIN
      </h1>
      <p className="mt-4 max-w-md text-balance text-neutral-300">
        A versão externa do seu cérebro. Digite um comando abaixo para começar.
      </p>
    </div>
  );
}
