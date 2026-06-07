/**
 * Helpers de acesso ao vault Obsidian (segundo cérebro), compartilhados entre o
 * script de sync (`scripts/sync.ts`) e as ferramentas do Odin (`lib/ai/tools.ts`).
 *
 * Read-only no vault. Convenções (VAULT_PATH, exclusão confidencial, frontmatter)
 * vivem aqui para não duplicarem entre o "Salto B" mecânico e o function calling.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";

/** Pastas que NUNCA podem ser lidas/indexadas (hard guard de confidencialidade). */
export const HARD_EXCLUDE = ["it-lean-confidencial"];

/**
 * Raiz do vault. Lida em tempo de chamada (não em module-init) para respeitar a
 * ordem do dotenv no script de sync, onde `config()` roda antes desta leitura.
 */
export function getVaultPath(): string {
  return process.env.VAULT_PATH ?? join("..", "segundo-cerebro");
}

/** Remove o bloco de frontmatter YAML (`--- ... ---`) do topo de uma nota. */
export function stripFrontmatter(text: string): string {
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) return text.slice(end + 4);
  }
  return text;
}

/**
 * Lê uma nota específica do vault pelo caminho relativo (ex: "wiki/karpathy.md").
 *
 * Seguro por construção:
 *  - aceita caminho com ou sem extensão `.md`;
 *  - guard contra path-traversal: o alvo resolvido tem que ficar DENTRO do vault;
 *  - respeita `HARD_EXCLUDE` (mesma confidencialidade do sync);
 *  - retorna `null` se não existir / não for arquivo (a tool transforma em `{ error }`).
 */
export async function readNote(
  relativePath: string
): Promise<{ title: string; content: string } | null> {
  const vaultRoot = resolve(getVaultPath());

  let rel = relativePath.trim().replace(/\\/g, "/");
  if (!rel) return null;
  if (!rel.toLowerCase().endsWith(".md")) rel += ".md";

  const target = resolve(vaultRoot, rel);

  // Guard de path-traversal: precisa estar sob a raiz do vault.
  if (target !== vaultRoot && !target.startsWith(vaultRoot + sep)) return null;
  // Guard de confidencialidade.
  if (HARD_EXCLUDE.some((ex) => target.includes(ex))) return null;

  try {
    const st = await stat(target);
    if (!st.isFile()) return null;
    const raw = await readFile(target, "utf8");
    const content = stripFrontmatter(raw).replace(/\r\n/g, "\n").trim();
    return { title: basename(target, ".md"), content };
  } catch {
    return null;
  }
}
