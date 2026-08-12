/**
 * Odin Workflows — Chave estável de lead.
 *
 * O `leadKey` é o que permite ao sistema nunca re-abordar o mesmo negócio
 * entre runs. Ele precisa ser ESTÁVEL: rodar a mesma busca amanhã tem que
 * produzir a mesma chave para o mesmo negócio, mesmo que o Google Maps
 * devolva os campos com pequenas variações de formatação.
 *
 * Ordem de preferência:
 *  1. Telefone normalizado — é o identificador mais confiável de um negócio
 *     brasileiro pequeno, e é justamente por onde o contato acontece.
 *  2. Hash de nome + localização — quando não há telefone. Normalizado de
 *     forma agressiva (minúsculas, sem acento, sem pontuação, espaços
 *     colapsados) porque o Maps varia muito nesses campos.
 *
 * Função pura, sem I/O: é o primeiro candidato a teste unitário do módulo.
 */

import { createHash } from "node:crypto";
import { normalizePhoneBR } from "./whatsapp";

/**
 * Normaliza texto livre para comparação: sem acento, sem pontuação,
 * minúsculo e com espaços colapsados. "Chocolateria Laura!" e
 * "chocolateria  laura" viram a mesma coisa.
 *
 * O `normalize("NFD")` separa a letra do acento, e `\p{Diacritic}` remove
 * só o acento — preferido à faixa ̀-ͯ porque não depende de
 * caracteres combinantes invisíveis no código-fonte.
 */
function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Entrada mínima necessária para derivar a chave. */
export interface LeadKeyInput {
  name: string;
  phone?: string | null;
  location?: string | null;
}

/**
 * Deriva a chave estável de um lead.
 *
 * Sempre retorna string não-vazia — mesmo um lead sem telefone, sem
 * localização e com nome vazio produz um hash determinístico, para não
 * quebrar a constraint `unique` da tabela com null.
 */
export function leadKey(lead: LeadKeyInput): string {
  // Normaliza para o formato internacional ANTES de virar chave. Sem isto,
  // "(13) 99999-8888" e "5513999998888" — o mesmo negócio — produziriam
  // chaves diferentes, e o dedupe re-contataria quem já foi abordado.
  const digits = normalizePhoneBR(lead.phone);
  if (digits) return `tel:${digits}`;

  const basis = `${normalizeText(lead.name)}|${normalizeText(lead.location ?? "")}`;
  const hash = createHash("sha1").update(basis).digest("hex").slice(0, 16);
  return `bin:${hash}`;
}
