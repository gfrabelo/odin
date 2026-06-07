"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Options {
  lang?: string;
  /** Transcrição parcial, ao vivo, enquanto você fala. */
  onInterim?: (text: string) => void;
  /** Frase final, quando você faz uma pausa. */
  onFinal?: (text: string) => void;
  /** Disparado quando começa a detectar fala (gatilho de barge-in). */
  onSpeechStart?: () => void;
  /**
   * Modo contínuo (hands-free): ao terminar (pausa/onend), reabre o microfone
   * sozinho, mantendo a escuta viva entre os turnos da conversa.
   */
  continuous?: boolean;
}

/**
 * Reconhecimento de fala (STT) via Web Speech API.
 * Nativo do navegador (Chrome/Edge), pt-BR, sem dependências.
 */
export function useSpeechRecognition({
  lang = "pt-BR",
  onInterim,
  onFinal,
  onSpeechStart,
  continuous = false,
}: Options = {}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognition | null>(null);

  // Refs pra sempre chamar os callbacks mais recentes sem recriar o recognizer.
  const onInterimRef = useRef(onInterim);
  const onFinalRef = useRef(onFinal);
  const onSpeechStartRef = useRef(onSpeechStart);
  onInterimRef.current = onInterim;
  onFinalRef.current = onFinal;
  onSpeechStartRef.current = onSpeechStart;

  // Refs de controle do loop hands-free.
  const continuousRef = useRef(continuous);
  continuousRef.current = continuous;
  const wantStopRef = useRef(false); // stop() explícito desliga o auto-restart

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
    rec.onspeechstart = () => onSpeechStartRef.current?.();
    rec.onend = () => {
      // Loop hands-free: se em modo contínuo e não foi um stop explícito, reabre.
      if (continuousRef.current && !wantStopRef.current) {
        try {
          rec.start();
          setListening(true);
          return;
        } catch {
          // start() pode lançar se ainda não soltou — cai pro estado parado.
        }
      }
      setListening(false);
    };
    rec.onerror = () => setListening(false);

    recRef.current = rec;
    return () => {
      wantStopRef.current = true;
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      rec.onspeechstart = null;
      rec.abort();
    };
  }, [lang]);

  const start = useCallback(() => {
    const rec = recRef.current;
    if (!rec) return;
    wantStopRef.current = false;
    try {
      rec.start();
      setListening(true);
    } catch {
      // start() lança se já estiver ativo — ignora.
    }
  }, []);

  const stop = useCallback(() => {
    wantStopRef.current = true; // impede o auto-restart do loop contínuo
    recRef.current?.stop();
  }, []);

  return { supported, listening, start, stop };
}
