import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { DeskPage } from "../components/app-shell";
import { ReviewDeck } from "../components/review-deck";
import { ErrorState, PageHeader, Skeleton, Empty } from "../components/ui";
import { createRule, flagTransaction } from "../server/fns";
import { getReview } from "../server/daily/fns";
import { snack } from "../components/sheet";
export const Route = createFileRoute("/review")({ loader: () => getReview(), pendingComponent: () => <Skeleton />, errorComponent: ({ error }) => { const router = useRouter(); return <ErrorState text={error instanceof Error ? error.message : "Couldn't load review."} retry={() => void router.invalidate()} />; }, component: Review });
function Review() {
  const rows = Route.useLoaderData();
  const [index, setIndex] = useState(0);
  const current = rows[index];
  const router = useRouter();
  const act = async (kind: "confirm" | "skip" | "exclude", rule = false) => {
    if (!current) return;
    if (kind === "confirm") {
      if (rule) await createRule({ data: { match: current.rawMerchant ?? current.merchant, displayMerchant: current.merchant, category: current.suggestion, createdFromTxnId: current.id } });
      else await flagTransaction({ data: { id: current.id, category: current.suggestion, needsReview: false } });
      snack(`Saved ₹${current.amount} · ${current.suggestion}`);
    }
    if (kind === "exclude") await flagTransaction({ data: { id: current.id, excluded: true, needsReview: false } });
    setIndex(index + 1);
    void router.invalidate();
  };
  return <DeskPage rail={<p className="text-sm text-ink-2">J/K move · X select · R confirm · C category · E not a spend</p>}><PageHeader title="Review" sub={`${Math.max(0, rows.length - index)} remaining`} />{!current ? <div className="px-5 desk:px-0"><Empty text="Nothing needs review." /></div> : <div className="px-5 desk:px-0"><ReviewDeck row={current} onConfirm={(rule) => void act("confirm", rule)} onSkip={() => void act("skip")} onExclude={() => void act("exclude")} /></div>}</DeskPage>;
}
