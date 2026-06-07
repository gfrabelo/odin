import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execPromise = promisify(exec);

export async function POST() {
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
