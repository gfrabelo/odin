import { GoogleGenAI } from "@google/genai";

// Cliente Google Gemini (singleton lazy).
// Construído só na primeira chamada — assim a GEMINI_API_KEY é lida em runtime
// (não no build) e não polui o build com avisos de key ausente.
// Só roda no servidor — nunca importe isto em componentes client.
let client: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GEMINI_API_KEY não configurada. Crie um .env.local com a chave."
      );
    }
    client = new GoogleGenAI({ apiKey });
  }
  return client;
}
