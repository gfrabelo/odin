/**
 * POST /api/leads/contacted — marca um lead como abordado.
 *
 * Existe porque o grafo NÃO consegue observar o envio: o deep-link `wa.me`
 * abre o WhatsApp e nada reporta de volta. O workflow só pode afirmar
 * "encontrado" e "qualificado"; "contatado" é afirmado pelo clique.
 *
 * Distinguir o que um sistema FEZ do que ele consegue SABER é o que evita
 * um CRM que mente. Ver ADR-0007.
 */

import { markContacted, type ContactStatus } from "@/lib/prospect/repository";

export const runtime = "nodejs";

const VALID_STATUSES: ContactStatus[] = [
  "novo",
  "contatado",
  "respondeu",
  "reuniao",
  "fechado",
  "descartado",
];

export async function POST(req: Request) {
  let body: { leadKey?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "JSON inválido." }, { status: 400 });
  }

  const leadKey = body.leadKey?.trim();
  if (!leadKey) {
    return Response.json({ error: "`leadKey` é obrigatório." }, { status: 400 });
  }

  const status = (body.status ?? "contatado") as ContactStatus;
  if (!VALID_STATUSES.includes(status)) {
    return Response.json(
      { error: `status inválido. Use um de: ${VALID_STATUSES.join(", ")}.` },
      { status: 400 }
    );
  }

  const saved = await markContacted(leadKey, status);

  // 200 mesmo quando não persistiu: a UI chama isto em fire-and-forget no
  // clique, e um erro aqui não pode atrapalhar a abertura do WhatsApp. O
  // campo `saved` deixa o estado real visível para quem quiser checar.
  return Response.json({ ok: true, saved, leadKey, status });
}
