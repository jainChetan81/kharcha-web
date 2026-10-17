import { cn } from "../lib/cn";

/** Small gradient orb marking model-made content. Decorative: every use carries a text label nearby. */
export function AiMark({ className }: { className?: string }) {
  return <span aria-hidden className={cn("ai-orb", className)} />;
}
