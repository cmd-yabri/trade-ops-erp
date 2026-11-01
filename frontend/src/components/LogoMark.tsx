import { cn } from "@/lib/utils";

/** The TradeOps mark: a ring around a dot (the dot is the studio's «نقطة»). Draws in the current text colour. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={cn("shrink-0", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="2.2" strokeDasharray="42 9.5" strokeLinecap="round" transform="rotate(-60 12 12)" />
      <circle cx="12" cy="12" r="3.4" fill="currentColor" />
    </svg>
  );
}
