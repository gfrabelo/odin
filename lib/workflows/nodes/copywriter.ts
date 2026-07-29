/**
 * Odin Workflows — Node: Copywriter
 *
 * O Copywriter escreve mensagem de abordagem para o lead qualificado.
 */

import { getGemini } from "@/lib/ai/client";
import { COPYWRITER_PROMPT } from "../prompts";
import type { OdinWorkflowState, WorkflowMessage } from "../types";

const COPYWRITER_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

export async function copywriterNode(
  state: OdinWorkflowState
): Promise<Partial<OdinWorkflowState>> {
  const lead = state.leads[state.currentLeadIndex];

  if (!lead || !state.qualification) {
    return {
      outreachDraft: "",
      currentAgent: "copywriter",
      messages: [
        {
          agent: "copywriter",
          content: "Sem lead ou qualificação disponível para escrever mensagem.",
          timestamp: new Date().toISOString(),
        },
      ],
    };
  }

  console.log(
    `[Odin Workflow] Copywriter escrevendo para: ${lead.name} (revisão #${state.revisionCount})`
  );

  const isRevision = state.revisionCount > 0 && !!state.feedback;

  const copyPrompt = isRevision
    ? `Reescreva a mensagem de abordagem incorporando o feedback abaixo.

**Lead:**
- Nome: ${lead.name}
- Segmento: ${lead.segment}
- Website: ${lead.website ?? "NÃO TEM"}

**Oportunidades:** ${state.qualification.opportunities.join(", ")}

**Draft anterior:**
${state.outreachDraft}

**Feedback:**
${state.feedback}

Reescreva mantendo o que estava bom e corrigindo o que foi apontado.`
    : `Escreva uma mensagem de abordagem via WhatsApp para o seguinte lead:

**Lead:**
- Nome: ${lead.name}
- Segmento: ${lead.segment}
- Telefone: ${lead.phone ?? "não informado"}
- Website: ${lead.website ?? "NÃO TEM"}
- Localização: ${lead.location ?? "não informado"}

**Qualificação:**
- Score: ${state.qualification.score}/10
- Oportunidades: ${state.qualification.opportunities.join(", ")}

Escreva a mensagem de abordagem.`;

  const response = await getGemini().models.generateContent({
    model: COPYWRITER_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: copyPrompt }],
      },
    ],
    config: {
      systemInstruction: COPYWRITER_PROMPT,
    },
  });

  const draft = response.text ?? "";

  const logMessage: WorkflowMessage = {
    agent: "copywriter",
    content: isRevision
      ? `Mensagem reescrita (revisão #${state.revisionCount + 1}).`
      : `Mensagem de abordagem escrita para ${lead.name}.`,
    timestamp: new Date().toISOString(),
  };

  console.log(
    `[Odin Workflow] Copywriter: draft gerado (${draft.length} chars, revisão #${state.revisionCount})`
  );

  return {
    outreachDraft: draft,
    revisionCount: state.revisionCount + 1,
    currentAgent: "copywriter",
    messages: [logMessage],
  };
}
