// InkHero (§5): the one dark ink surface per screen. Today and Wealth only.
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export function InkHero({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={cn("flex flex-col gap-3 bg-hero px-5 pt-3 pb-[18px] text-on-ink desk:gap-3.5 desk:rounded-panel desk:p-6", className)}
    >
      {children}
    </section>
  );
}

export function HeroAmount({ value, size = "md" }: { value: string; size?: "md" | "lg" }) {
  const [sign, rest] = value.startsWith("₹") ? ["₹", value.slice(1)] : ["", value];
  return (
    <span
      className={cn(
        "inline-block font-serif leading-none font-medium tracking-tight min-w-0 break-words",
        size === "lg" ? "text-figure-sm tablet:text-figure desk:text-figure-lg" : "text-figure-sm tablet:text-figure desk:text-figure",
      )}
    >
      {sign && <span className={cn("text-on-ink-2", size === "lg" ? "text-title desk:text-page-lg" : "text-page")}>{sign}</span>}
      {rest}
    </span>
  );
}
