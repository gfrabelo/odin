"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { stripMarkdownForSpeech } from "./strip";

/**
 * Síntese de fala (TTS) via API da OpenAI (rota /api/tts) com fila FIFO.
 * `enabled` é o toggle do "Odin fala"; `speak` adiciona um texto à fila de reprodução.
 */
export function useSpeechSynthesis(lang = "pt-BR") {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  
  const queueRef = useRef<string[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  const enabledRef = useRef(enabled);
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setSupported(true);
    }
    return () => {
      // Limpeza ao desmontar
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
    };
  }, []);

  const cancel = useCallback(() => {
    queueRef.current = [];
    isPlayingRef.current = false;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setSpeaking(false);
  }, []);

  const processQueue = useCallback(async () => {
    if (isPlayingRef.current) return;
    if (queueRef.current.length === 0) {
      setSpeaking(false);
      return;
    }

    const nextText = queueRef.current.shift()!;
    isPlayingRef.current = true;
    setSpeaking(true);

    try {
      const response = await fetch("/api/tts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ text: nextText }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Erro ao sintetizar voz.");
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      audioUrlRef.current = url;

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.onended = () => {
        isPlayingRef.current = false;
        if (audioUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioUrlRef.current = null;
        }
        processQueue(); // Toca o próximo da fila
      };

      audio.onerror = () => {
        isPlayingRef.current = false;
        if (audioUrlRef.current === url) {
          URL.revokeObjectURL(url);
          audioUrlRef.current = null;
        }
        processQueue(); // Pula para o próximo
      };

      await audio.play();
    } catch (err) {
      console.error("Erro no processamento da fila de voz:", err);
      isPlayingRef.current = false;
      processQueue();
    }
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!enabledRef.current) return;

      const clean = stripMarkdownForSpeech(text);
      if (!clean) return;

      queueRef.current.push(clean);
      processQueue();
    },
    [processQueue]
  );

  return { supported, enabled, setEnabled, speaking, speak, cancel };
}
