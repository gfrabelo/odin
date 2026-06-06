"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  lang?: string;
  /** Transcrição parcial, ao vivo, enquanto você fala. */
  onInterim?: (text: string) => void;
  /** Frase final, quando você faz uma pausa. */
  onFinal?: (text: string) => void;
}

/**
 * Reconhecimento de fala (STT) via Web Speech API.
 * Nativo do navegador (Chrome/Edge), pt-BR, sem dependências.
 */
export function useSpeechRecognition({
  lang = "pt-BR",
  onInterim,
  onFinal,
}: Options = {}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognition | null>(null);

  // Refs pra sempre chamar os callbacks mais recentes sem recriar o recognizer.
  const onInterimRef = useRef(onInterim);
  const onFinalRef = useRef(onFinal);
  onInterimRef.current = onInterim;
  onFinalRef.current = onFinal;

  useEffect(() => {
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) {
      setSupported(false);
      return;
    }
    setSupported(true);

    const rec = new Ctor();
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;

    rec.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) final += text;
        else interim += text;
      }
      if (interim) onInterimRef.current?.(interim);
      if (final) onFinalRef.current?.(final.trim());
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);

    recRef.current = rec;
    return () => {
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      rec.abort();
    };
  }, [lang]);

  const start = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    try {
      rec.start();
      setListening(true);
    } catch {
      // start() lança se já estiver ativo — ignora.
    }
  }, []);

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  return { supported, listening, start, stop };
}
