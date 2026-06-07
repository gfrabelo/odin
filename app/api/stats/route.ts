import { NextResponse } from "next/server";
import { getSupabase, isSupabaseConfigured } from "@/lib/rag/supabase";

export async function GET() {
  try {
    if (!isSupabaseConfigured()) {
      return NextResponse.json({
        configured: false,
        count: 0,
      });
    }

    const supabase = getSupabase();
    // Consulta rápida usando head: true para obter apenas o count exato
    const { count, error } = await supabase
      .from("documents")
      .select("*", { count: "exact", head: true });

    if (error) {
      throw error;
    }

    return NextResponse.json({
      configured: true,
      count: count || 0,
    });
  } catch (error) {
    console.error("Erro ao obter estatísticas do Supabase:", error);
    return NextResponse.json({
      configured: true,
      count: 0,
      error: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
}
