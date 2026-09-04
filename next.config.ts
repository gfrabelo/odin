import type { NextConfig } from "next";

/**
 * Configuração de produção do Odin.
 *
 * O warning de NFT trace em `lib/vault.ts` (operações de filesystem dinâmicas)
 * é suprimido pelo `turbopackIgnore` direto no código do vault. Não precisa de
 * `outputFileTracingExcludes` aqui — o Turbopack rejeita globs que saem da
 * raiz do projeto ("../segundo-cerebro" é externo).
 */
const nextConfig: NextConfig = {
  // Pacote opcional: só instalado quando REDIS_URL existe. O import dinâmico
  // em checkpointer.ts trata a ausência, mas o Turbopack emite warning de
  // module-not-found se tentar bundlar. Excluí-lo do bundle resolve.
  serverExternalPackages: ["@langchain/langgraph-checkpoint-redis"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-DNS-Prefetch-Control", value: "on" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            // Microfone liberado — o STT do Odin precisa.
            key: "Permissions-Policy",
            value: "camera=(), geolocation=(), browsing-topics=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
