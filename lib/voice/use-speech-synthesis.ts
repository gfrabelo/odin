"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { stripMarkdownForSpeech } from "./strip";

/**
 * Síntese de fala (TTS) via Web Speech API.
 * `enabled` é o toggle do "Odin fala"; `speak` lê um texto (markdown limpo).
 */
export function useSpeechSynthesis(lang = "pt-BR") {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    setSupported(true);

    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      voiceRef.current =
        voices.find((v) => v.lang?.toLowerCase().startsWith("pt")) ??
        voices[0] ??
        null;
    };
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const cancel = useCallback(() => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
    }
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;
      const clean = stripMarkdownForSpeech(text);
      if (!clean) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(clean);
      utterance.lang = lang;
      if (voiceRef.current) utterance.voice = voiceRef.current;
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [lang]
  );

  return { supported, enabled, setEnabled, speaking, speak, cancel };
}
