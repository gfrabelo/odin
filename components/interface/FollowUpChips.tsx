"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface FollowUpChipsProps {
  /** Sugestões de próxima pergunta (vindas do structured output do Gemini). */
  suggestions: string[];
  /** Disparado ao clicar num chip — manda a sugestão como novo comando. */
  onPick: (text: string) => void;
  /** Desabilita os chips enquanto o Odin responde. */
  disabled?: boolean;
}

/**
 * Chips de follow-up abaixo do input. Nada renderiza se a lista vier vazia,
 * então o cockpit fica idêntico ao de hoje quando não há sugestões.
 */
export function FollowUpChips({ suggestions, onPick, disabled }: FollowUpChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 px-1">
      <Sparkles aria-hidden className="size-3.5 shrink-0 text-[var(--odin-accent)]/70" />
      {suggestions.map((text, i) => (
        <button
          key={`${i}-${text}`}
          type="button"
          onClick={() => onPick(text)}
          disabled={disabled}
          className={cn(
            "glass rounded-full px-3 py-1.5 text-xs text-neutral-300",
            "cursor-pointer transition-all duration-200",
            "hover:border-[var(--odin-accent)]/40 hover:text-neutral-100",
            "hover:shadow-[0_0_30px_-12px_var(--odin-accent-soft)]",
            "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--odin-accent)]",
            "disabled:cursor-not-allowed disabled:opacity-40"
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
