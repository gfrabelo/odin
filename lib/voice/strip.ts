/**
 * Limpa markdown pra leitura em voz (TTS).
 * O Odin responde em markdown; a voz não deve "ler" `**`, `[1]`, `#`, etc.
 */
export function stripMarkdownForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " (bloco de código) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\[(\d+)\]/g, "") // citações [1], [2]…
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → texto
    .replace(/[_>#]/g, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
