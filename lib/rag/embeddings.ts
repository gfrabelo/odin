import { getGemini } from "../ai/client";

// Modelo de embeddings do Gemini.
// gemini-embedding-001 gera 3072 dims por padrão; pedimos 768 via
// outputDimensionality pra bater com o schema pgvector (vector(768)).
const EMBED_MODEL = "gemini-embedding-001";
const EMBED_DIMS = 768;

async function embedOne(text: string, taskType: string): Promise<number[]> {
  const res = await getGemini().models.embedContent({
    model: EMBED_MODEL,
    contents: text,
    config: { taskType, outputDimensionality: EMBED_DIMS },
  });
  const values = res.embeddings?.[0]?.values;
  if (!values) throw new Error("Embedding vazio.");
  return values;
}

/** Embedding de uma query de busca. */
export function embedQuery(text: string): Promise<number[]> {
  return embedOne(text, "RETRIEVAL_QUERY");
}

/** Embeddings de um lote de documentos (sequencial, robusto). */
export async function embedDocuments(texts: string[]): Promise<number[][]> {
  const out: number[][] = [];
  for (const text of texts) {
    out.push(await embedOne(text, "RETRIEVAL_DOCUMENT"));
  }
  return out;
}
