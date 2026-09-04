import { NextResponse } from "next/server";

// Proxy para OpenAI TTS — normalmente rápido, mas textos longos podem demorar.
export const maxDuration = 30;
export async function POST(req: Request) {
  try {
    const { text } = await req.json();
    if (!text) {
      return NextResponse.json({ error: "Texto é obrigatório." }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENAI_API_KEY não configurada no servidor." },
        { status: 500 }
      );
    }

    const voice = process.env.OPENAI_TTS_VOICE || "onyx";
    // Velocidade da fala (0.25–4.0). 1.15 deixa o Odin mais fluido sem distorcer.
    const speed = Number(process.env.OPENAI_TTS_SPEED) || 1.15;

    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "tts-1",
        input: text,
        voice: voice,
        speed: speed,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Erro na API da OpenAI TTS:", errorText);
      return NextResponse.json(
        { error: `Erro na síntese da OpenAI: ${response.statusText}` },
        { status: response.status }
      );
    }

    const audioBuffer = await response.arrayBuffer();
    return new Response(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
      },
    });
  } catch (error) {
    console.error("Erro no manipulador de TTS:", error);
    return NextResponse.json(
      { error: "Erro interno no servidor de TTS." },
      { status: 500 }
    );
  }
}
