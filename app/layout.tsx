import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

// Inter: sans cinematográfica/técnica, premium — recomendada pela skill
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
  title: "Odin — Orquestrador de Conhecimento",
  description: "A versão externa do cérebro de Gabriel Rabelo.",
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
