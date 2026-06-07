"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { stripMarkdownForSpeech } from "./strip";

/**
 * Síntese de fala (TTS) via API da OpenAI (rota /api/tts) com fila FIFO.
 * `enabled` é o toggle do "Odin fala"; `speak` adiciona um texto à fila de reprodução.
 *
 * GLOW PULSE: cada áudio da fila é roteado por um AnalyserNode (Web Audio). Um
 * loop de rAF calcula a amplitude média (0..1, suavizada) e a grava em `volumeRef`
 * — exposto para a UI animar o robô/overlay SEM re-render por frame.
 */
export function useSpeechSynthesis(lang = "pt-BR") {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const queueRef = useRef<string[]>([]);
  const isPlayingRef = useRef<boolean>(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);

  // Web Audio (análise de amplitude para o glow pulse).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const volumeRef = useRef<number>(0); // 0..1, lido pela UI no próprio rAF dela
  const rafRef = useRef<number | null>(null);

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
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (audioUrlRef.current) {
        URL.revokeObjectURL(audioUrlRef.current);
        audioUrlRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };
  }, []);

  /**
   * Cria/retoma o AudioContext. DEVE ser chamado a partir de um gesto do usuário
   * (ex: clique no toggle de voz) por causa da política de autoplay dos browsers.
   */
  const initAudio = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!audioCtxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyser.connect(ctx.destination); // analyser → alto-falantes
      audioCtxRef.current = ctx;
      analyserRef.current = analyser;
      freqDataRef.current = new Uint8Array(
        new ArrayBuffer(analyser.frequencyBinCount)
      );
    }
    audioCtxRef.current.resume?.().catch(() => {});
  }, []);

  /** Loop de medição: amplitude média do analyser → volumeRef (suavizado). */
  const startMeter = useCallback(() => {
    if (rafRef.current != null) return;
    const tick = () => {
      const analyser = analyserRef.current;
      const data = freqDataRef.current;
      let target = 0;
      if (analyser && data) {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        target = sum / data.length / 255; // 0..1
      }
      // Suavização (lerp) para o pulso não tremer.
      const next = volumeRef.current + (target - volumeRef.current) * 0.3;
      volumeRef.current = next < 0.001 ? 0 : next;

      // Continua enquanto toca OU ainda está decaindo até zero.
      if (isPlayingRef.current || volumeRef.current > 0.01) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        volumeRef.current = 0;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
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
    // O meter decai sozinho até 0 e se encerra (isPlayingRef já é false).
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

      // Roteia o áudio pelo analyser (se o AudioContext já existe). Blob é
      // same-origin (object URL do nosso /api/tts) → sem taint de CORS.
      if (audioCtxRef.current && analyserRef.current) {
        try {
          const source = audioCtxRef.current.createMediaElementSource(audio);
          source.connect(analyserRef.current);
          startMeter();
        } catch {
          // Se falhar, o áudio toca normalmente (rota direta pros alto-falantes).
        }
      }

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
  }, [startMeter]);

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

  return {
    supported,
    enabled,
    setEnabled,
    speaking,
    speak,
    cancel,
    initAudio,
    volumeRef,
  };
}
