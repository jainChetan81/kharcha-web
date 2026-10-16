// Single entry point for keyboard shortcuts (§10). The "?" dialog is generated from KEYS.
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const KEYS = [
  { key: "N", label: "Add" },
  { key: "/", label: "Ask" },
  { key: "R", label: "Review" },
  { key: "J / K", label: "Move" },
  { key: "X", label: "Select" },
  { key: "C", label: "Category" },
  { key: "E", label: "Not a spend" },
  { key: "Esc", label: "Close" },
  { key: "?", label: "Shortcuts" },
] as const;

/** Page-level actions (J/K/X/C/E) that a screen like Review or Activity registers while mounted. */
export type PageKeys = Partial<Record<"j" | "k" | "x" | "c" | "e" | "enter", () => void>>;
let pageKeys: PageKeys = {};
export function usePageKeys(keys: PageKeys) {
  useEffect(() => {
    pageKeys = keys;
    return () => {
      if (pageKeys === keys) pageKeys = {};
    };
  }, [keys]);
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/** Global keys. Mount once in the root layout. */
export function useGlobalKeys(openHelp: () => void) {
  const navigate = useNavigate();
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (document.querySelector("[role=dialog]") && e.key !== "Escape") return;
      const k = e.key.toLowerCase();
      if (k === "n") void navigate({ to: "/add" });
      else if (k === "/") void navigate({ to: "/ask" });
      else if (k === "r") void navigate({ to: "/review" });
      else if (e.key === "?") openHelp();
      else if (k in pageKeys) pageKeys[k as keyof PageKeys]?.();
      else return;
      e.preventDefault();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, openHelp]);
}
