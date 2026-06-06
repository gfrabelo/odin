"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { stripMarkdownForSpeech } from "./strip";

/**
 * Síntese de fala (TTS) via API da OpenAI (rota /api/tts).
 * `enabled` é o toggle do "Odin fala"; `speak` lê um texto enviando-o para a rota.
 */
export function useSpeechSynthesis(lang = "pt-BR") {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

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

  const speak = useCallback(
    async (text: string) => {
      const clean = stripMarkdownForSpeech(text);
      if (!clean) return;

      cancel(); // Para áudio anterior

      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: clean }),
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

        audio.onplay = () => setSpeaking(true);
        audio.onended = () => {
          setSpeaking(false);
          if (audioUrlRef.current === url) {
            URL.revokeObjectURL(url);
            audioUrlRef.current = null;
          }
        };
        audio.onerror = () => {
          setSpeaking(false);
          if (audioUrlRef.current === url) {
            URL.revokeObjectURL(url);
            audioUrlRef.current = null;
          }
        };

        await audio.play();
      } catch (err) {
        console.error("Erro na síntese de voz:", err);
        setSpeaking(false);
      }
    },
    [cancel]
  );

  return { supported, enabled, setEnabled, speaking, speak, cancel };
}
