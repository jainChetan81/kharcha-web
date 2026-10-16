import { Link, useRouter } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { ErrorState, PageHeader, Skeleton } from "./ui";
import { PlanTabs } from "./plan-tabs";

export function PlanHeader({ sub }: { sub: string }) { return <><PageHeader title="Plan" sub={sub} /><PlanTabs /></>; }
export function PlanPending() { return <div className="px-5 desk:px-0"><Skeleton rows={7} /></div>; }
export function PlanError() { const router = useRouter(); return <div className="px-5 desk:px-0"><ErrorState retry={() => void router.invalidate()} /></div>; }
export function AddPlanLink({ to, label }: { to: "/plan/recurring/new" | "/plan/trips/new"; label: string }) { return <Link to={to} className="fixed right-5 bottom-[calc(66px+env(safe-area-inset-bottom))] z-20 flex min-h-11 items-center gap-2 rounded-button bg-ink px-4 text-sm font-medium text-paper desk:static desk:self-start"><Plus size={18} strokeWidth={1.75} />{label}</Link>; }
