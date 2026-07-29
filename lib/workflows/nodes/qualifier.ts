/**
 * Odin Workflows — Node: Qualifier
 *
 * O Qualifier avalia se um lead vale a pena abordar.
 */

import { getGemini } from "@/lib/ai/client";
import { QUALIFIER_PROMPT } from "../prompts";
import type {
  OdinWorkflowState,
  QualificationResult,
  WorkflowMessage,
} from "../types";

const QUALIFIER_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

export async function qualifierNode(
  state: OdinWorkflowState
): Promise<Partial<OdinWorkflowState>> {
  const lead = state.leads[state.currentLeadIndex];

  if (!lead) {
    console.warn("[Odin Workflow] Qualifier: nenhum lead para qualificar.");
    return {
      qualification: {
        score: 0,
        qualified: false,
        reasoning: "Nenhum lead disponível para qualificar.",
        opportunities: [],
      },
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

  console.log(`[Odin Workflow] Qualifier analisando: ${lead.name} (${lead.segment})`);

  const qualificationPrompt = `Analise o seguinte lead e dê um score de qualificação:

**Lead:**
- Nome: ${lead.name}
- Segmento: ${lead.segment}
- Telefone: ${lead.phone ?? "não informado"}
- Website: ${lead.website ?? "NÃO TEM"}
- Localização: ${lead.location ?? "não informado"}
- Avaliação Google: ${lead.rating ?? "não informado"}
- Fonte: ${lead.source}

**Serviços que oferecemos:**
1. Criação de sites profissionais
2. Auditoria completa de IA
3. Automações de processos

Qualifique este lead.`;

  const response = await getGemini().models.generateContent({
    model: QUALIFIER_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: qualificationPrompt }],
      },
    ],
    config: {
      systemInstruction: QUALIFIER_PROMPT,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object" as const,
        properties: {
          score: { type: "number" as const, description: "Score de 0 a 10" },
          qualified: { type: "boolean" as const, description: "O lead é qualificado?" },
          reasoning: { type: "string" as const, description: "Justificativa da decisão" },
          opportunities: {
            type: "array" as const,
            items: { type: "string" as const },
            description: "Oportunidades identificadas",
          },
        },
        required: ["score", "qualified", "reasoning", "opportunities"],
      },
    },
  });

  const text = response.text ?? "{}";
  let result: QualificationResult;

  try {
    result = JSON.parse(text);
  } catch {
    result = {
      score: 0,
      qualified: false,
      reasoning: "Erro ao parsear qualificação.",
      opportunities: [],
    };
  }

  const logMessage: WorkflowMessage = {
    agent: "qualifier",
    content: `${lead.name}: score ${result.score}/10 — ${result.qualified ? "QUALIFICADO ✅" : "NÃO QUALIFICADO ❌"}. ${result.reasoning}`,
    timestamp: new Date().toISOString(),
  };

  console.log(
    `[Odin Workflow] Qualifier: ${lead.name} → score ${result.score}/10 (${result.qualified ? "qualificado" : "descartado"})`
  );

  return {
    qualification: result,
    currentAgent: "qualifier",
    messages: [logMessage],
  };
}
