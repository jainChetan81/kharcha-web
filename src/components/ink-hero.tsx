// InkHero (§5): the one dark ink surface per screen. Today and Wealth only.
import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export function InkHero({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-3 bg-hero px-5 pt-3 pb-[18px] text-on-ink desk:gap-3.5 desk:rounded-hero desk:p-6", className)}>
      {children}
    </section>
  );
}

/** "₹47,854" in display serif with a smaller muted rupee sign. */
export function HeroAmount({ value, size = "md" }: { value: string; size?: "md" | "lg" }) {
  const [sign, rest] = value.startsWith("₹") ? ["₹", value.slice(1)] : ["", value];
  return (
    <span className={cn("inline-block font-serif leading-none font-medium tracking-[-0.02em] min-w-0 break-words", size === "lg" ? "text-[clamp(34px,11vw,44px)] desk:text-[56px]" : "text-[clamp(34px,11vw,44px)] desk:text-[44px]")}>
      {sign && <span className={cn("text-on-ink-2", size === "lg" ? "text-[clamp(20px,6vw,26px)] desk:text-[30px]" : "text-[26px]")}>{sign}</span>}
      {rest}
    </span>
  );
}
