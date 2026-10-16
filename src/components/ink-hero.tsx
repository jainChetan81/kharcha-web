// InkHero (§5): the one dark ink surface per screen. Today and Wealth only.
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export function InkHero({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3 bg-ink px-5 pt-3 pb-[18px] text-on-ink desk:gap-3.5 desk:rounded-hero desk:p-6", className)}>
      {children}
    </section>
  );
}

/** "₹47,854" in display serif with a smaller muted rupee sign. */
export function HeroAmount({ value, size = "md" }: { value: string; size?: "md" | "lg" }) {
  const [sign, rest] = value.startsWith("₹") ? ["₹", value.slice(1)] : ["", value];
  return (
    <span className={cn("font-serif leading-none font-medium tracking-[-0.02em]", size === "lg" ? "text-[56px] desk:text-[64px]" : "text-[44px]")}>
      {sign && <span className={cn("text-on-ink-2", size === "lg" ? "text-[30px] desk:text-[34px]" : "text-[26px]")}>{sign}</span>}
      {rest}
    </span>
  );
}
