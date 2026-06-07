// Tipos centrais do Odin.
// Mantidos minimalistas no Sprint 1 - vão crescer quando entrarem
// orquestrador multi-modelo, RAG e metadados de skills.

export type Role = "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

/** Corpo esperado por POST /api/chat. */
export interface ChatRequest {
  messages: Message[];
}
