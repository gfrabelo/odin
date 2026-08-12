/**
 * Odin Workflows — Firecrawl (enriquecimento de site).
 *
 * Por que existe: a rubrica do Qualifier dá +2 pontos por "site
 * desatualizado/ruim", mas o único dado que chegava ao modelo era a STRING
 * da URL — nada no pipeline abria o site. Um quinto do score era adivinhação.
 * Ver ADR-0011.
 *
 * Divisão de trabalho com o Apify: o Apify DESCOBRE (quem existe, via
 * diretório do Google Maps) e o Firecrawl ENRIQUECE (como é, dado que já
 * temos a URL). Não são concorrentes — o Firecrawl não consegue listar
 * "todas as pizzarias de Itanhaém", e o Apify não lê site arbitrário bem.
 *
 * BLINDADO: nunca lança. Qualquer falha vira `{ ok: false, error }` e o
 * Qualifier volta a pontuar só com os dados do Maps (ADR-0004).
 */

import type { SiteAnalysis } from "./types";

const FIRECRAWL_URL = "https://api.firecrawl.dev/v2/scrape";

/**
 * Quanto markdown guardamos por site.
 *
 * O estado inteiro do grafo é checkpointado a cada transição — markdown
 * bruto de 10 sites incharia o checkpoint sem melhorar o julgamento. A home
 * truncada já responde o que a rubrica pergunta (tem loja? tem WhatsApp?
 * parece de que década?).
 */
const MAX_MARKDOWN_CHARS = 2000;

/** Timeout por página. O Firecrawl anuncia P95 de ~3,4s; 15s é folga larga. */
const SCRAPE_TIMEOUT_MS = 15_000;

interface FirecrawlResponse {
  success?: boolean;
  data?: {
    markdown?: string;
    metadata?: { title?: string; statusCode?: number };
  };
  error?: string;
}

export function isFirecrawlConfigured(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

/**
 * Faz scrape de uma URL e devolve markdown limpo da home.
 *
 * `onlyMainContent: true` remove header/nav/footer — o que interessa para
 * julgar o site é o conteúdo, não o menu.
 */
export async function scrapeSite(url: string): Promise<SiteAnalysis> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      title: null,
      markdown: null,
      error: "FIRECRAWL_API_KEY não configurada — enriquecimento pulado.",
    };
  }

  try {
    const response = await fetch(FIRECRAWL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        timeout: SCRAPE_TIMEOUT_MS,
      }),
      // Margem sobre o timeout do próprio Firecrawl, para a conexão não
      // ficar pendurada além do que ele já desistiu.
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS + 5_000),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ok: false,
        title: null,
        markdown: null,
        error: `Firecrawl HTTP ${response.status}: ${body.slice(0, 120)}`,
      };
    }

    const json = (await response.json()) as FirecrawlResponse;
    const markdown = json.data?.markdown?.trim() ?? "";

    if (!markdown) {
      return {
        ok: false,
        title: json.data?.metadata?.title ?? null,
        markdown: null,
        error: json.error ?? "Firecrawl não retornou conteúdo.",
      };
    }

    return {
      ok: true,
      title: json.data?.metadata?.title ?? null,
      markdown:
        markdown.length > MAX_MARKDOWN_CHARS
          ? `${markdown.slice(0, MAX_MARKDOWN_CHARS)}\n\n[...truncado]`
          : markdown,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erro de conexão";
    return {
      ok: false,
      title: null,
      markdown: null,
      error: `Firecrawl: ${message}`,
    };
  }
}
