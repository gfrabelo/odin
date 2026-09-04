import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

// Inter: sans cinematográfica/técnica, premium - recomendada pela skill
// ui-ux-pro-max para AI dashboards dark.
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Mono para o input de comando (estética terminal).
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Odin — Cockpit de IA Pessoal",
  description:
    "Assistente de IA com RAG sobre Obsidian, workflows multi-agente, " +
    "voz bidirecional e interface 3D imersiva. Por Gabriel Rabelo.",
  openGraph: {
    title: "Odin — Cockpit de IA Pessoal",
    description:
      "Chat com segundo cérebro, prospecção B2B automatizada, " +
      "e robô 3D interativo. Next.js + Gemini + LangGraph.",
    type: "website",
    locale: "pt_BR",
  },
  twitter: {
    card: "summary_large_image",
    title: "Odin — Cockpit de IA Pessoal",
    description: "Assistente de IA com RAG, workflows multi-agente e voz.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`dark ${inter.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
