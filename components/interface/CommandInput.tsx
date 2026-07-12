"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, ChevronRight, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpeechRecognition } from "@/lib/voice/use-speech-recognition";

interface CommandInputProps {
  onSubmit: (text: string) => void;
  /** Interrompe a geração em andamento. */
  onStop?: () => void;
  /** Chamado quando o usuário começa a falar (pra cortar a voz do Odin). */
  onVoiceStart?: () => void;
  /** True enquanto o Odin está respondendo. */
  isLoading?: boolean;
  /** Modo conversa contínua (hands-free): mic auto-reinicia entre os turnos. */
  conversationMode?: boolean;
  /** True enquanto o Odin está FALANDO (TTS) - habilita o barge-in. */
  odinSpeaking?: boolean;
  /** Barge-in: usuário começou a falar enquanto o Odin falava → corta tudo. */
  onBargeIn?: () => void;
  /** Callback quando o estado de escuta muda */
  onListeningChange?: (listening: boolean) => void;
}

/**
 * Input de comando estilo terminal/cockpit, em vidro.
 * Enter envia; Shift+Enter quebra linha. Microfone (STT) transcreve ao vivo
 * e auto-envia na pausa. Enquanto o Odin responde, o botão vira "parar".
 */
export function CommandInput({
  onSubmit,
  onStop,
  onVoiceStart,
  isLoading,
  conversationMode = false,
  odinSpeaking = false,
  onBargeIn,
  onListeningChange,
}: CommandInputProps) {
  const [value, setValue] = useState("");
  const baseRef = useRef(""); // texto digitado antes de começar a falar

  function send(explicit?: string) {
    const text = (explicit ?? value).trim();
    if (!text || isLoading) return;
    onSubmit(text);
    setValue("");
    baseRef.current = "";
  }

  const { supported: micSupported, listening, start, stop } =
    useSpeechRecognition({
      continuous: conversationMode,
      onInterim: (text) => {
        const base = baseRef.current.trim();
        setValue((base ? base + " " : "") + text);
      },
      onFinal: (text) => {
        const base = baseRef.current.trim();
        send((base ? base + " " : "") + text);
      },
      onSpeechStart: () => {
        // Barge-in só com fones: se odinSpeaking, corta. No modo meia-duplex
        // (padrão) o mic está desligado durante a fala, então isto não dispara
        // por eco - fica como rede de segurança caso o mic ainda esteja ativo.
        if (odinSpeaking) onBargeIn?.();
      },
    });

  // Notificar pai sobre mudanças no estado de escuta
  useEffect(() => {
    onListeningChange?.(listening);
  }, [listening, onListeningChange]);

  // Modo conversa hands-free MEIA-DUPLEX (evita eco no alto-falante):
  // o mic fica desligado enquanto o Odin FALA e religa sozinho quando ele cala.
  // O delay ao religar serve de debounce contra o flicker de `speaking` entre frases.
  useEffect(() => {
    if (!micSupported) return;
    if (!conversationMode || odinSpeaking) {
      stop(); // não ouvir enquanto o Odin fala → sem eco
      return;
    }
    baseRef.current = "";
    const t = setTimeout(() => start(), 350);
    return () => clearTimeout(t);
  }, [conversationMode, odinSpeaking, micSupported, start, stop]);

  function toggleMic() {
    if (listening) {
      stop();
      return;
    }
    onVoiceStart?.(); // corta a fala do Odin antes de ouvir
    baseRef.current = value;
    start();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const canSend = !!value.trim() && !isLoading;
  const placeholder = isLoading
    ? "Odin está respondendo…"
    : conversationMode
      ? "Modo conversa ativo - pode falar 🎧"
      : listening
        ? "Ouvindo…"
        : "Fale com o Odin…";

  return (
    <div
      className={cn(
        "glass group flex items-end gap-2 rounded-2xl px-4 py-3",
        "transition-all duration-300",
        listening
          ? "border-[var(--odin-accent)]/50 shadow-[0_0_50px_-12px_var(--odin-accent-soft)]"
          : "focus-within:border-[var(--odin-accent)]/40 focus-within:shadow-[0_0_50px_-12px_var(--odin-accent-soft)]"
      )}
    >
      <ChevronRight
        aria-hidden
        className="mt-1.5 size-4 shrink-0 text-neutral-500 transition-colors group-focus-within:text-[var(--odin-accent)]"
      />

      <textarea
        rows={1}
        value={value}
        disabled={isLoading}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label="Comando para o Odin"
        className={cn(
          "max-h-40 flex-1 resize-none bg-transparent py-1 font-mono text-sm leading-relaxed",
          "text-neutral-100 placeholder:text-neutral-500 focus:outline-none",
          "disabled:opacity-50"
        )}
      />

      {/* Microfone */}
      {micSupported && !isLoading && (
        <button
          type="button"
          onClick={toggleMic}
          aria-label={listening ? "Parar de ouvir" : "Falar com o Odin"}
          className={cn(
            "grid size-9 shrink-0 cursor-pointer place-items-center rounded-xl transition-all duration-200",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--odin-accent)]",
            listening
              ? "animate-pulse bg-[var(--odin-accent)] text-[#04101f]"
              : "bg-white/5 text-neutral-300 hover:bg-white/10"
          )}
        >
          <Mic className="size-4" />
        </button>
      )}

      {/* Enviar / Parar */}
      {isLoading ? (
        <button
          type="button"
          onClick={onStop}
          aria-label="Parar geração"
          className={cn(
            "grid size-9 shrink-0 cursor-pointer place-items-center rounded-xl transition-all duration-200",
            "bg-white/10 text-neutral-200 hover:bg-white/20",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--odin-accent)]"
          )}
        >
          <Square className="size-3.5 fill-current" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => send()}
          disabled={!canSend}
          aria-label="Enviar comando"
          className={cn(
            "grid size-9 shrink-0 place-items-center rounded-xl transition-all duration-200",
            "cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--odin-accent)]",
            canSend
              ? "bg-[var(--odin-accent)] text-[#04101f] hover:scale-105 hover:brightness-110"
              : "cursor-not-allowed bg-white/5 text-neutral-600"
          )}
        >
          <ArrowUp className="size-4" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}
