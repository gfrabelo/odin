/**
 * Odin Workflows — Telefone BR e deep-link do WhatsApp.
 *
 * Duas funções puras que vivem juntas porque a segunda depende do formato
 * que a primeira produz.
 *
 * Por que deep-link e não API de WhatsApp (Uazapi/Z-API): custo zero, zero
 * aprovação, zero risco de ban — e humano no loop por construção, não por
 * política. A consequência estrutural é que o sistema NÃO consegue observar
 * o envio: quem afirma "contatado" é o clique na UI, não o grafo. Ver ADR-0007.
 */

/**
 * Normaliza telefone BR para o formato internacional que o wa.me exige
 * (ex: 5513999999999). Devolve null quando o número é curto demais para
 * ser válido — melhor não ter link do que ter link quebrado.
 */
export function normalizePhoneBR(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10) return null;
  // Já veio com código do país (55 + DDD + número).
  if (digits.startsWith("55") && digits.length >= 12) return digits;
  return `55${digits}`;
}

/**
 * Monta o deep-link do WhatsApp.
 *
 * Sem `message`, abre só a conversa — é o estado do lead antes de o
 * Copywriter rodar. Com `message`, abre já com o texto carregado.
 *
 * IMPORTANTE: a UI remonta este link no momento do clique, a partir do
 * texto atual do textarea. É isso que faz as edições do Gabriel chegarem
 * no WhatsApp em vez de serem descartadas.
 */
export function buildWhatsAppLink(
  phone: string | null | undefined,
  message?: string | null
): string | null {
  const digits = normalizePhoneBR(phone);
  if (!digits) return null;

  const text = message?.trim();
  if (!text) return `https://wa.me/${digits}`;

  // encodeURIComponent cuida das quebras de linha (viram %0A), que o
  // COPYWRITER_PROMPT usa para separar as 5 linhas da mensagem.
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
