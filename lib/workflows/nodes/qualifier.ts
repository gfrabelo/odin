/**
 * Odin Workflows — Node: Qualifier (Batch)
 *
 * Qualifica TODOS os leads de uma vez em uma única chamada LLM.
 *
 * Por que batch e não N chamadas sequenciais?
 *  - Menos round-trips HTTP = menor latência total
 *  - O modelo vê todos os leads de uma vez = pode comparar e ranquear
 *  - Structured Output com array garante JSON válido
 *  - 10 leads × ~200 tokens = ~2000 tokens (cabe fácil)
 */

import { getGemini } from "@/lib/ai/client";
import { QUALIFIER_PROMPT } from "../prompts";
import { buildWhatsAppLink } from "../whatsapp";
import type {
  OdinWorkflowState,
  QualifiedLead,
  WorkflowMessage,
} from "../types";

const QUALIFIER_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

/**
 * Corte de qualificação. Vive aqui, em código, porque o prompt declara a
 * mesma regra em prosa e nada reconciliava as duas fontes — o modelo podia
 * devolver score 8 com `qualified: false` e o lead sumia da tabela.
 */
const QUALIFICATION_THRESHOLD = 6;

export async function qualifierNode(
  state: OdinWorkflowState
): Promise<Partial<OdinWorkflowState>> {
  const { leads, task } = state;

  if (leads.length === 0) {
    console.warn("[Odin Workflow] Qualifier: nenhum lead para qualificar.");
    return {
      qualifiedLeads: [],
      currentAgent: "qualifier",
      messages: [
        {
          agent: "qualifier",
          content: "Nenhum lead disponível para qualificar.",
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  console.log(`[Odin Workflow] Qualifier: qualificando ${leads.length} leads em batch`);

  // Monta a descrição de cada lead para o prompt.
  //
  // O bloco do site é o que separa esta versão da anterior: antes o modelo
  // recebia só a URL e mesmo assim a rubrica pedia para julgar se o site era
  // ruim — ou seja, ele adivinhava. Agora ou vem o conteúdo real, ou vem
  // explicitamente "não foi possível analisar". Ver ADR-0011.
  const leadsDescription = leads
    .map((lead, i) => {
      let siteBlock: string;
      if (!lead.website) {
        siteBlock = "- Website: NÃO TEM";
      } else if (lead.siteAnalysis?.ok && lead.siteAnalysis.markdown) {
        siteBlock =
          `- Website: ${lead.website}\n` +
          `- Título do site: ${lead.siteAnalysis.title ?? "sem título"}\n` +
          `- CONTEÚDO REAL DO SITE:\n"""\n${lead.siteAnalysis.markdown}\n"""`;
      } else {
        siteBlock =
          `- Website: ${lead.website}\n` +
          `- CONTEÚDO DO SITE: não foi possível analisar` +
          `${lead.siteAnalysis?.error ? ` (${lead.siteAnalysis.error})` : ""}. ` +
          `NÃO suponha a qualidade do site.`;
      }

      return `Lead #${i + 1}:
- Nome: ${lead.name}
- Segmento: ${lead.segment}
- Telefone: ${lead.phone ?? "não informado"}
- Localização: ${lead.location ?? "não informado"}
- Avaliação Google: ${lead.rating ?? "não informado"}
${siteBlock}`;
    })
    .join("\n\n");

  const batchPrompt = `Analise TODOS os leads abaixo e dê um score de qualificação para cada um.

**Tarefa do workflow:** ${task}

**Serviços que oferecemos:**
1. Criação de sites profissionais
2. Auditoria completa de IA e presença digital
3. Automações de processos (WhatsApp, agendamentos, atendimento)

**Leads para qualificar:**

${leadsDescription}

Qualifique CADA lead individualmente. Retorne um array com a qualificação de cada lead na mesma ordem.`;

  const response = await getGemini().models.generateContent({
    model: QUALIFIER_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: batchPrompt }],
      },
    ],
    config: {
      systemInstruction: QUALIFIER_PROMPT,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object" as const,
        properties: {
          qualifications: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                score: {
                  type: "number" as const,
                  description: "Score de 0 a 10",
                },
                reasoning: {
                  type: "string" as const,
                  description: "Justificativa da decisão",
                },
                opportunities: {
                  type: "array" as const,
                  items: { type: "string" as const },
                  description: "Oportunidades identificadas",
                },
              },
              required: ["score", "reasoning", "opportunities"],
            },
          },
        },
        required: ["qualifications"],
      },
    },
  });

  const text = response.text ?? '{"qualifications":[]}';

  interface QualResult {
    score: number;
    reasoning: string;
    opportunities: string[];
  }

  let qualResults: QualResult[] = [];
  try {
    const parsed = JSON.parse(text) as { qualifications: QualResult[] };
    qualResults = parsed.qualifications;
  } catch {
    console.error("[Odin Workflow] Qualifier: erro ao parsear resposta batch.");
    qualResults = [];
  }

  // Merge leads + qualificações → QualifiedLead[]
  const qualifiedLeads: QualifiedLead[] = leads.map((lead, i) => {
    const qual = qualResults[i] ?? {
      score: 0,
      reasoning: "Sem qualificação (erro no batch)",
      opportunities: [],
    };

    // `qualified` é DERIVADO do score, em código, nunca vindo do modelo.
    // Antes o modelo devolvia o booleano e nada o reconciliava com a regra
    // "score >= 6" declarada no prompt — dava para voltar score 8 com
    // qualified false, e o lead sumia em silêncio na tabela.
    const score = Number.isFinite(qual.score) ? qual.score : 0;

    return {
      ...lead,
      score,
      qualified: score >= QUALIFICATION_THRESHOLD,
      reasoning: qual.reasoning,
      opportunities: qual.opportunities,
      // Link sem `?text=` por enquanto — o Copywriter o substitui quando
      // gerar a mensagem.
      message: null,
      whatsappLink: buildWhatsAppLink(lead.phone),
    };
  });

  // Ordenar por score (maior primeiro)
  qualifiedLeads.sort((a, b) => b.score - a.score);

  const qualifiedCount = qualifiedLeads.filter((l) => l.qualified).length;
  const disqualifiedCount = qualifiedLeads.length - qualifiedCount;

  const logMessage: WorkflowMessage = {
    agent: "qualifier",
    content: `Batch: ${leads.length} leads qualificados. ${qualifiedCount} aprovados ✅, ${disqualifiedCount} descartados ❌. Top: ${qualifiedLeads[0]?.name ?? "—"} (${qualifiedLeads[0]?.score ?? 0}/10).`,
    timestamp: new Date().toISOString(),
  };

  console.log(
    `[Odin Workflow] Qualifier batch: ${qualifiedCount} qualificados, ${disqualifiedCount} descartados`
  );

  return {
    qualifiedLeads,
    currentAgent: "qualifier",
    messages: [logMessage],
  };
}
