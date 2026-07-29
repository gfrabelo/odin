/**
 * Odin Workflows — Node: Researcher
 *
 * O Researcher é o "olheiro" do time. Dado uma tarefa como
 * "Prospectar restaurantes em São Paulo", ele usa as tools
 * EXISTENTES do Odin (webSearch) para encontrar leads.
 */

import { getGemini } from "@/lib/ai/client";
import { executeTool } from "@/lib/ai/tools";
import { RESEARCHER_PROMPT } from "../prompts";
import type { OdinWorkflowState, LeadInfo, WorkflowMessage } from "../types";

const RESEARCHER_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";

export async function researcherNode(
  state: OdinWorkflowState
): Promise<Partial<OdinWorkflowState>> {
  console.log(`[Odin Workflow] Researcher iniciando: "${state.task}"`);

  // 1. Usar webSearch para buscar leads
  const searchResult = await executeTool("webSearch", {
    query: state.task,
  });

  // 2. Também tenta o segundo cérebro (pode ter referências úteis)
  const brainResult = await executeTool("searchSecondBrain", {
    query: `leads prospecção ${state.task}`,
  });

  // 3. Extrair leads estruturados
  const extractionPrompt = `Com base nos resultados de pesquisa abaixo, extraia uma lista de leads (empresas/negócios) que podem se beneficiar de serviços de criação de site, auditoria de IA ou automações.

**Tarefa original:** ${state.task}

**Resultados da busca web:**
${JSON.stringify(searchResult, null, 2)}

**Resultados do segundo cérebro:**
${JSON.stringify(brainResult, null, 2)}

Extraia os leads encontrados no formato JSON especificado.`;

  const response = await getGemini().models.generateContent({
    model: RESEARCHER_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: extractionPrompt }],
      },
    ],
    config: {
      systemInstruction: RESEARCHER_PROMPT,
      responseMimeType: "application/json",
      responseSchema: {
        type: "object" as const,
        properties: {
          leads: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                name: { type: "string" as const, description: "Nome do negócio" },
                segment: { type: "string" as const, description: "Segmento/nicho" },
                phone: { type: "string" as const, description: "Telefone", nullable: true },
                website: { type: "string" as const, description: "Website", nullable: true },
                location: { type: "string" as const, description: "Localização", nullable: true },
                rating: { type: "number" as const, description: "Avaliação Google", nullable: true },
                source: { type: "string" as const, description: "Fonte do lead" },
              },
              required: ["name", "segment", "source"],
            },
          },
          summary: {
            type: "string" as const,
            description: "Resumo da pesquisa",
          },
        },
        required: ["leads", "summary"],
      },
    },
  });

  const text = response.text ?? '{"leads":[],"summary":"Sem resultados"}';
  let parsed: { leads: LeadInfo[]; summary: string };

  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { leads: [], summary: "Erro ao parsear resultados da pesquisa." };
  }

  const logMessage: WorkflowMessage = {
    agent: "researcher",
    content: `Encontrados ${parsed.leads.length} leads. ${parsed.summary}`,
    timestamp: new Date().toISOString(),
  };

  console.log(`[Odin Workflow] Researcher encontrou ${parsed.leads.length} leads`);

  return {
    leads: parsed.leads,
    currentAgent: "researcher",
    messages: [logMessage],
  };
}
