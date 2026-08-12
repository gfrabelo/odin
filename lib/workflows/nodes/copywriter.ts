/**
 * Odin Workflows — Node: Copywriter (Batch)
 *
 * Escreve a mensagem de abordagem de TODOS os leads qualificados numa única
 * chamada estruturada — mesmo desenho do Qualifier, pelas mesmas razões:
 * menos round-trips e JSON garantido.
 *
 * ─── O detalhe elegante: nenhum campo novo de estado ────────────────
 * `qualifiedLeads` já usa reducer de substituição. Então este nó pega o
 * array, preenche `message` em quem falta, e devolve o array inteiro. Sem
 * chave de correlação, sem ordem frágil, sem flag para resetar. O supervisor
 * sabe que terminou porque `qualifiedLeads.some(l => l.qualified && !l.message)`
 * passa a ser false — estado derivado, não sinalizado.
 *
 * ─── Sobre a demo ───────────────────────────────────────────────────
 * A regra 6 do COPYWRITER_PROMPT manda mencionar demo/mockup casualmente, e
 * os exemplos de tom terminam em "já tenho um protótipo funcionando". Isso
 * era mentira enquanto não existia demo. O `demoContext` do estado é o que
 * torna a menção verdadeira. Sem ele, instruímos o modelo a não prometer
 * nada — vale mais uma mensagem sem prova que uma mensagem com prova falsa.
 *
 * A mensagem NUNCA inclui URL: link em WhatsApp frio parece disparo e
 * derruba taxa de resposta. O link vai depois do "pode mandar".
 */

import { getGemini } from "@/lib/ai/client";
import { COPYWRITER_PROMPT } from "../prompts";
import { buildWhatsAppLink } from "../whatsapp";
import type {
  OdinWorkflowState,
  QualifiedLead,
  WorkflowMessage,
} from "../types";

const COPYWRITER_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

export async function copywriterNode(
  state: OdinWorkflowState
): Promise<Partial<OdinWorkflowState>> {
  const { qualifiedLeads, demoContext } = state;

  // Só quem está qualificado E ainda não tem mensagem.
  const targets = qualifiedLeads.filter((l) => l.qualified && !l.message);

  if (targets.length === 0) {
    return {
      currentAgent: "copywriter",
      messages: [
        {
          agent: "copywriter",
          content: "Nenhum lead qualificado pendente de mensagem.",
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  console.log(`[Odin Workflow] Copywriter: escrevendo ${targets.length} mensagens em batch`);

  const leadsDescription = targets
    .map(
      (lead, i) => `Lead #${i + 1}:
- Nome do NEGÓCIO (não é pessoa): ${lead.name}
- Segmento: ${lead.segment}
- Tem site? ${lead.website ? `Sim (${lead.website})` : "NÃO TEM"}
- Localização: ${lead.location ?? "não informada"}
- Oportunidades identificadas: ${lead.opportunities.join(", ") || "não especificadas"}
- Por que foi qualificado: ${lead.reasoning}`
    )
    .join("\n\n");

  const demoBlock = demoContext?.trim()
    ? `**Demo disponível (é REAL, pode mencionar):**
${demoContext.trim()}

Mencione a demo de forma casual, como manda a regra 6 — sem link, sem URL.`
    : `**Não há demo pronta para este nicho.**
NÃO prometa demo, protótipo ou exemplo. Use um gancho de dor e um CTA de
conversa ("posso te mostrar como funciona?"), sem afirmar que já existe algo
pronto. Vale mais uma mensagem sem prova do que uma promessa falsa.`;

  const batchPrompt = `Escreva uma mensagem de abordagem via WhatsApp para CADA lead abaixo.

**Contexto da prospecção:** ${state.task}

${demoBlock}

**Serviços oferecidos:**
1. Criação de sites profissionais
2. Auditoria de IA e presença digital
3. Automações de processos (WhatsApp, agendamento, atendimento)

**Leads:**

${leadsDescription}

Retorne um array com uma mensagem para cada lead, na MESMA ORDEM, usando o
campo \`index\` para indicar o número do lead (1 a ${targets.length}).
Cada mensagem segue TODAS as regras absolutas. Nunca inclua links ou URLs.`;

  const response = await getGemini().models.generateContent({
    model: COPYWRITER_MODEL,
    contents: [{ role: "user", parts: [{ text: batchPrompt }] }],
    config: {
      systemInstruction: COPYWRITER_PROMPT,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object" as const,
        properties: {
          messages: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                index: {
                  type: "number" as const,
                  description: "Número do lead (1-based), como listado no prompt",
                },
                message: {
                  type: "string" as const,
                  description: "A mensagem final, pronta para enviar. Sem prefácio.",
                },
              },
              required: ["index", "message"],
            },
          },
        },
        required: ["messages"],
      },
    },
  });

  const text = response.text ?? '{"messages":[]}';

  interface CopyResult {
    index: number;
    message: string;
  }

  // Indexa por `index` em vez de confiar na ordem do array: o modelo pode
  // devolver fora de ordem, e aqui isso mandaria a mensagem errada para o
  // negócio errado — um erro caro e difícil de notar.
  const byIndex = new Map<number, string>();
  try {
    const parsed = JSON.parse(text) as { messages: CopyResult[] };
    for (const item of parsed.messages ?? []) {
      if (typeof item.index === "number" && typeof item.message === "string") {
        byIndex.set(item.index, item.message.trim());
      }
    }
  } catch {
    console.error("[Odin Workflow] Copywriter: erro ao parsear resposta batch.");
  }

  // Mapeia leadKey → mensagem, para mesclar no array completo depois.
  const messageByKey = new Map<string, string>();
  targets.forEach((lead, i) => {
    const message = byIndex.get(i + 1);
    if (message) messageByKey.set(lead.leadKey, message);
  });

  // FAIL-SAFE: lead cuja geração falhou fica com `message: null` e o link
  // simples — degrada para o comportamento anterior em vez de quebrar o run.
  const updated: QualifiedLead[] = qualifiedLeads.map((lead) => {
    const message = messageByKey.get(lead.leadKey);
    if (!message) return lead;
    return {
      ...lead,
      message,
      whatsappLink: buildWhatsAppLink(lead.phone, message),
    };
  });

  const okCount = messageByKey.size;
  const failCount = targets.length - okCount;

  const logMessage: WorkflowMessage = {
    agent: "copywriter",
    content:
      `${okCount} mensagens escritas` +
      (failCount > 0 ? `, ${failCount} falharam (seguem sem mensagem)` : "") +
      (demoContext?.trim() ? ", mencionando a demo." : ", sem menção a demo."),
    timestamp: new Date().toISOString(),
  };

  console.log(`[Odin Workflow] Copywriter: ${okCount} ok, ${failCount} falhas`);

  return {
    qualifiedLeads: updated,
    currentAgent: "copywriter",
    messages: [logMessage],
  };
}
