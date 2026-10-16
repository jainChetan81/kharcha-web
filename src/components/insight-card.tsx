import { Link } from "@tanstack/react-router";
import { X } from "lucide-react";
import { money } from "../lib/format";
import { StatusTag, Card, IconButton } from "./ui";

export type InsightView = { id: number; detector: string; payload: Record<string, unknown> };
const words: Record<string, { tag: "unusual" | "check" | "neutral"; text: (p: Record<string, unknown>) => string; href: (p: Record<string, unknown>) => string }> = {
  unusual: { tag: "unusual", text: (p) => `${p.merchant} is ${Math.round(Number(p.current) / Math.max(1, Number(p.median)))}× its usual weekly spend.`, href: (p) => String(p.href ?? "/activity") },
  repeat: { tag: "check", text: (p) => `${p.merchant} has repeat charges on ${p.date}.`, href: () => "/activity" },
  recurring: { tag: "neutral", text: (p) => `${p.merchant} looks recurring at about ${money(Math.round(Number(p.average)))}.`, href: (p) => String(p.href ?? "/activity") },
  missing_sip: { tag: "check", text: (p) => `No SIP debit found for ${p.holding}.`, href: (p) => String(p.href ?? "/wealth") },
  budget: { tag: "unusual", text: (p) => `${p.category} may cross its budget around day ${p.crossing}.`, href: () => "/plan/budgets" },
};

export function InsightCard({ insight, onDismiss }: { insight: InsightView; onDismiss: (id: number) => void }) {
  const item = words[insight.detector] ?? { tag: "check" as const, text: () => "Ledger pattern worth checking.", href: () => "/insights" };
  return <Card className="grid grid-cols-[minmax(0,1fr)_44px] gap-1 p-4"><div className="flex flex-col items-start gap-2"><StatusTag tone={item.tag}>{insight.detector === "unusual" ? "Unusual" : insight.detector === "recurring" ? "Recurring?" : "Check"}</StatusTag><p className="m-0 text-[15px] leading-6">{item.text(insight.payload)}</p><Link to={item.href(insight.payload)} className="min-h-8 text-sm font-medium text-brand">See rows</Link></div><IconButton label="Dismiss" onClick={() => onDismiss(insight.id)}><X size={18} strokeWidth={1.75} /></IconButton></Card>;
}
