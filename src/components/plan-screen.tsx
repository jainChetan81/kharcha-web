import { Plus } from "lucide-react";
import { ButtonLink, PageHeader } from "./ui";
import { PlanTabs } from "./plan-tabs";

export function PlanHeader({ sub }: { sub: string }) {
  return (
    <>
      <PageHeader title="Plan" sub={sub} />
      <PlanTabs />
    </>
  );
}
export function AddPlanLink({ to, label }: { to: "/plan/recurring/new" | "/plan/trips/new"; label: string }) {
  return (
    <ButtonLink to={to} className="fixed right-5 bottom-[calc(66px+env(safe-area-inset-bottom))] z-20 desk:static desk:self-start">
      <Plus size={18} strokeWidth={1.75} />
      {label}
    </ButtonLink>
  );
}
