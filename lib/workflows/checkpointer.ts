/**
 * Odin Workflows — Checkpointer Factory
 *
 * ─── CONCEITO 4: Checkpointing ─────────────────────────────────────
 * O checkpointer salva o estado do grafo a cada transição (node A
 * terminou → salva → node B começa). Isso permite:
 *
 *  1. Human-in-the-loop: quando `interrupt()` pausa, o estado é salvo.
 *     Quando o humano aprova, o estado é carregado e o grafo continua.
 *  2. Resiliência: se o servidor reiniciar, o workflow retoma de onde
 *     parou (com Redis; com MemorySaver, perde-se no restart).
 *  3. Observabilidade: cada checkpoint é um snapshot — você pode
 *     "voltar no tempo" e ver o estado em qualquer ponto do workflow.
 *
 * Tradeoff:
 *  - MemorySaver: zero config, ótimo para dev, mas perde estado no
 *    restart do processo Node. Suficiente enquanto o Odin roda local.
 *  - RedisSaver: persiste em disco via Redis, sobrevive a restarts.
 *    Necessário em produção (Railway = 1 clique para adicionar Redis).
 *
 * Fail-safe: tentamos Redis primeiro; se não configurado, usamos
 * MemorySaver e logamos um aviso. O workflow NUNCA falha por causa
 * do checkpointer.
 * ────────────────────────────────────────────────────────────────────
 */

import { MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

const globalForCheckpointer = globalThis as unknown as {
  __odinCheckpointer?: BaseCheckpointSaver;
};

/**
 * Cria (ou retorna) o checkpointer do Odin Workflows.
 *
 * Lógica de seleção:
 * 1. Se REDIS_URL está configurada → tenta RedisSaver (produção)
 * 2. Senão → MemorySaver (dev local, preservado em globalThis para sobreviver a hot-reloads)
 */
export async function getCheckpointer(): Promise<BaseCheckpointSaver> {
  if (globalForCheckpointer.__odinCheckpointer) {
    return globalForCheckpointer.__odinCheckpointer;
  }

  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    try {
      // Import dinâmico — só carrega se REDIS_URL existir.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { RedisSaver } = await import(
        // @ts-expect-error — pacote opcional, só instalado em prod.
        "@langchain/langgraph-checkpoint-redis"
      );
      const redisSaver = (await RedisSaver.fromUrl(redisUrl, {
        defaultTTL: 60, // minutos
        refreshOnRead: true,
      })) as BaseCheckpointSaver;
      globalForCheckpointer.__odinCheckpointer = redisSaver;
      console.log("[Odin Workflow] Checkpointer: Redis conectado ✅");
      return redisSaver;
    } catch (err) {
      console.warn(
        "[Odin Workflow] Checkpointer: falha ao conectar Redis, usando MemorySaver.",
        err instanceof Error ? err.message : err
      );
    }
  }

  // Fallback: MemorySaver (in-memory, salvo em globalThis para dev)
  const memorySaver: BaseCheckpointSaver = new MemorySaver();
  globalForCheckpointer.__odinCheckpointer = memorySaver;
  console.log(
    "[Odin Workflow] Checkpointer: MemorySaver (in-memory dev singleton)."
  );
  return memorySaver;
}
