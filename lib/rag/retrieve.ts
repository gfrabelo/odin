import { getSupabase, isSupabaseConfigured } from "./supabase";
import { embedQuery } from "./embeddings";

export interface RetrievedChunk {
  content: string;
  path?: string;
  title?: string;
  similarity: number;
}

interface MatchRow {
  content: string;
  metadata: { path?: string; title?: string } | null;
  similarity: number;
}

/**
 * Recupera trechos relevantes do segundo cérebro para uma query.
 *
 * FAIL-SAFE: se o Supabase não estiver configurado, a query estiver vazia,
 * ou ocorrer qualquer erro, devolve [] — o Odin responde sem RAG e o chat
 * nunca quebra. O RAG "se liga" sozinho assim que o Supabase é configurado.
 */
export async function retrieveContext(
  query: string,
  matchCount = 6
): Promise<RetrievedChunk[]> {
  if (!isSupabaseConfigured() || !query.trim()) return [];

  try {
    const embedding = await embedQuery(query);
    const { data, error } = await getSupabase().rpc("match_documents", {
      query_embedding: embedding,
      match_count: matchCount,
    });
    if (error || !Array.isArray(data)) return [];

    return (data as MatchRow[]).map((d) => ({
      content: d.content,
      path: d.metadata?.path,
      title: d.metadata?.title,
      similarity: d.similarity,
    }));
  } catch {
    return [];
  }
}
