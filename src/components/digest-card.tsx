import { Link } from "@tanstack/react-router";
import type { Digest } from "../server/insights/fns";
import { AiMark } from "./ai-mark";
import { AiProvenance } from "./ai-provenance";
import { Card } from "./ui";

export function DigestCard({ digest }: { digest: Digest }) {
  if (digest.status === "none") return null;
  if (digest.status === "unavailable") return <Card className="mx-5 p-4 desk:mx-0"><p className="m-0 text-[15px] text-ink-2">This week&apos;s summary will be back tomorrow.</p><Link to="/insights" search={{ month: undefined }} className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand">Insights</Link></Card>;
  return (
    <Card className="mx-5 flex flex-col gap-3 p-4 desk:mx-0">
      <div className="flex items-baseline"><AiMark className="mr-2 self-center" /><span className="font-serif text-[22px] italic">This week, in short</span><span className="ml-2 text-xs text-ink-3">{digest.label}</span></div>
      <ol className="m-0 flex list-none flex-col gap-2 p-0">
        {digest.lines.map((line, index) => <li key={`${line.pre}-${line.num}-${line.post}`} className="grid grid-cols-[20px_1fr] gap-2 text-[15px] leading-6"><span className="font-serif text-ink-3">{["I", "II", "III"][index]}</span><span>{line.pre} <Link to={line.href} className="font-medium text-brand underline decoration-brand/50 underline-offset-2">{line.num}</Link>{line.post}</span></li>)}
      </ol>
      <span className="flex flex-col gap-0.5 text-xs text-ink-3">Numbers from your ledger · words by AI{digest.model && <AiProvenance model={digest.model} tokensIn={digest.tokensIn} tokensOut={digest.tokensOut} costUsd={digest.costUsd} when={digest.createdAt} />}</span>
      <Link to="/ask" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand"><AiMark />Ask a follow-up</Link>
    </Card>
  );
}
