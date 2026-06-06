/**
 * Sincroniza o wiki do segundo cérebro → Supabase (pgvector). INCREMENTAL:
 * re-embeda só os arquivos que mudaram (hash do conteúdo), remove os apagados,
 * pula os inalterados.
 *
 * Rodar:  npm run sync
 *
 * ⚠ Este é o "Salto B" (MECÂNICO): wiki/ → índice vetorial. Read-only no vault.
 *   NÃO é o ritual INGEST do Karpathy (raw/ → wiki/, que é INTELECTUAL).
 *
 * ⚠ CONFIDENCIALIDADE: `it-lean-confidencial` é EXCLUÍDA (hard guard).
 */
import { config } from "dotenv";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep, basename } from "node:path";
import { embedDocuments } from "../lib/rag/embeddings";
import { getSupabase } from "../lib/rag/supabase";

config({ path: ".env.local" });

const VAULT_PATH = process.env.VAULT_PATH ?? join("..", "segundo-cerebro");
const INCLUDE_DIRS = (process.env.INGEST_DIRS ?? "wiki")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const HARD_EXCLUDE = ["it-lean-confidencial"];
const CHUNK_SIZE = 1200;
const CHUNK_OVERLAP = 150;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (HARD_EXCLUDE.some((ex) => full.includes(ex))) continue;
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (name.endsWith(".md")) out.push(full);
  }
  return out;
}

function stripFrontmatter(text: string): string {
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) return text.slice(end + 4);
  }
  return text;
}

function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_SIZE) return [clean];
  const chunks: string[] = [];
  let i = 0;
  while (i < clean.length) {
    chunks.push(clean.slice(i, i + CHUNK_SIZE));
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

const hashOf = (s: string) => createHash("sha1").update(s).digest("hex");

interface FileEntry {
  path: string;
  title: string;
  hash: string;
  body: string;
}

async function main() {
  console.log(`Vault:  ${VAULT_PATH}`);
  console.log(`Pastas: ${INCLUDE_DIRS.join(", ")}`);

  // 1. Estado atual do wiki (arquivos + hash do conteúdo)
  const files: string[] = [];
  for (const d of INCLUDE_DIRS) {
    try {
      files.push(...walk(join(VAULT_PATH, d)));
    } catch {
      console.warn(`(pulei pasta inexistente: ${join(VAULT_PATH, d)})`);
    }
  }
  const current: FileEntry[] = files.map((file) => {
    const body = stripFrontmatter(readFileSync(file, "utf8"))
      .replace(/\r\n/g, "\n")
      .trim();
    return {
      path: relative(VAULT_PATH, file).split(sep).join("/"),
      title: basename(file, ".md"),
      hash: hashOf(body),
      body,
    };
  });

  const supabase = getSupabase();

  // 2. Estado atual no DB: path → hash (e todos os paths presentes)
  const { data: rows, error } = await supabase.from("documents").select("metadata");
  if (error) throw error;
  const dbHash = new Map<string, string>();
  const dbPaths = new Set<string>();
  for (const r of (rows ?? []) as { metadata: { path?: string; hash?: string } }[]) {
    const p = r.metadata?.path;
    const h = r.metadata?.hash;
    if (p) {
      dbPaths.add(p);
      if (h && !dbHash.has(p)) dbHash.set(p, h);
    }
  }

  // 3. Diff
  const currentPaths = new Set(current.map((c) => c.path));
  const toDelete = [...dbPaths].filter((p) => !currentPaths.has(p));
  const toUpsert = current.filter((c) => dbHash.get(c.path) !== c.hash);
  const unchanged = current.length - toUpsert.length;

  console.log(
    `Arquivos: ${current.length} | inalterados: ${unchanged} | atualizar: ${toUpsert.length} | remover: ${toDelete.length}`
  );

  // 4. Remove arquivos que sumiram do wiki
  for (const p of toDelete) {
    const { error } = await supabase.from("documents").delete().eq("metadata->>path", p);
    if (error) throw error;
    console.log(`  - removido: ${p}`);
  }

  // 5. (Re)indexa os que mudaram/são novos
  for (const f of toUpsert) {
    // Apaga chunks antigos desse arquivo (idempotente; cobre migração de rows sem hash)
    const { error: delErr } = await supabase
      .from("documents")
      .delete()
      .eq("metadata->>path", f.path);
    if (delErr) throw delErr;

    const chunks = chunkText(f.body);
    if (chunks.length === 0) continue;
    const embeddings = await embedDocuments(chunks);
    const rowsToInsert = chunks.map((content, idx) => ({
      content,
      metadata: { path: f.path, title: f.title, chunk: idx, hash: f.hash },
      embedding: embeddings[idx],
    }));
    const { error: insErr } = await supabase.from("documents").insert(rowsToInsert);
    if (insErr) throw insErr;
    console.log(`  ~ ${f.path} (${chunks.length} chunks)`);
  }

  if (toUpsert.length === 0 && toDelete.length === 0) {
    console.log("✓ Já está em dia — nada a sincronizar.");
  } else {
    console.log("✓ Sync concluído.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
