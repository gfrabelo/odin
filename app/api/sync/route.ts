/**
 * Dispara a reindexação do vault (`npm run sync`) a partir da UI.
 *
 * Por que existe um guard aqui e não nas outras rotas: esta é a única que
 * **spawna um processo** no host. As demais gastam token de API; esta gasta
 * processo, disco e cota de embedding de uma vez. O Odin é single-user e roda
 * local (ver §Segurança no README), então o desenho é:
 *
 *  - em dev, liberado — é o fluxo normal de quem clonou o repo;
 *  - em produção, exige `SYNC_TOKEN` no header `Authorization: Bearer …`.
 *
 * O guard **falha fechado**: produção sem `SYNC_TOKEN` configurado recusa
 * todo mundo. Rota que spawna processo é o último lugar onde "esqueci de
 * configurar" pode significar "aberta pra internet".
 */
import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

function isAuthorized(req: Request): boolean {
  if (process.env.NODE_ENV !== "production") return true;

  const expected = process.env.SYNC_TOKEN;
  if (!expected) return false;

  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${expected}`;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { success: false, error: "Sync desabilitado nesta instância." },
      { status: 403 }
    );
  }

  try {
    // Executa a sincronização do cérebro rodando o script incremental de sync.
    const { stdout, stderr } = await execPromise("npm run sync");
    console.log("Sync stdout:", stdout);
    if (stderr) {
      console.warn("Sync stderr:", stderr);
    }

    return NextResponse.json({ success: true, log: stdout });
  } catch (error) {
    console.error("Erro ao rodar script de sync:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Erro desconhecido",
      },
      { status: 500 }
    );
  }
}
