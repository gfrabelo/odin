import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Marcador de tool-use que o backend injeta no stream (lib/ai/chat.ts):
// `\n\n_⚙️ Odin acionando: ${names}…_\n\n`. O ThoughtBubble é quem exibe
// esse status; aqui limpamos o texto para o chat e para o TTS.
const TOOL_MARKER_RE = /_⚙️ Odin acionando: [^_\n]+…_/g
// Marcador ainda chegando no fim do stream (chunk pode cortá-lo no meio).
const PARTIAL_TAIL_RE = /_⚙️ Odin acionando:[^_]*$/

export function stripToolMarkers(text: string): string {
  return text
    .replace(TOOL_MARKER_RE, "")
    .replace(PARTIAL_TAIL_RE, "")
    .replace(/\n{3,}/g, "\n\n")
}
