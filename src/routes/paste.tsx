import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { saveFailed, snack, useHoldsInput } from "../components/sheet";
import { useOnline } from "../components/sync-pill";
import { Button, Card, ErrorState, PageHeader, Skeleton } from "../components/ui";
import { foreign, money } from "../lib/format";
import { parsePasted, savePasted } from "../server/daily/fns";

export const Route = createFileRoute("/paste")({
  validateSearch: z.object({ text: z.string().max(2000).optional() }),
  pendingComponent: () => <Skeleton rows={4} />,
  errorComponent: ({ error }) => { const router = useRouter(); return <ErrorState text={error instanceof Error ? error.message : "Couldn't load Paste."} retry={() => void router.invalidate()} />; },
  component: Paste,
});

type Result = Awaited<ReturnType<typeof parsePasted>>;

function Paste() {
  const [text, setText] = useState(Route.useSearch().text ?? "");
  const [bank, setBank] = useState<"axis" | "hdfc" | "indusind" | "">("");
  const [result, setResult] = useState<{ key: string; parsed: Result }>();
  const key = `${bank}\n${text}`;
  // A late response for edited text is ignored: only the result for the current text shows or saves.
  const parsed = result?.key === key ? result.parsed : undefined;
  const failed = result?.key === key && !result.parsed;
  const navigate = useNavigate();
  const online = useOnline();
  useHoldsInput();
  const reset = () => setResult(undefined);
  const parse = async () => {
    if (!online || !text.trim()) return;
    try {
      setResult({ key, parsed: await parsePasted({ data: { text, bank: bank || undefined } }) });
    } catch { saveFailed(parse); }
  };
  const paste = async () => {
    try { setText(await navigator.clipboard.readText()); reset(); }
    catch { snack("Couldn't read clipboard. Paste into message field instead."); }
  };
  const save = async () => {
    if (!parsed || parsed.status !== "parsed" || !online) return;
    try {
      await savePasted({ data: { text, bank: bank || undefined } });
      snack(`Saved ${money(parsed.amount)} · ${parsed.category}`);
      void navigate({ to: "/" });
    } catch { saveFailed(save); }
  };
  return <main className="flex min-h-dvh flex-col">
    <PageHeader back="/add" title="Paste SMS" />
    <div className="flex flex-1 flex-col gap-4 px-5 pb-7 tablet:mx-auto tablet:w-full tablet:max-w-[640px]">
      <label htmlFor="paste-bank" className="flex flex-col gap-1.5 text-[13px] text-ink-2">Bank (optional)
        <select id="paste-bank" className="field" value={bank} onChange={(event) => { setBank(event.target.value as typeof bank); reset(); }}>
          <option value="">Detect from message</option><option value="axis">Axis</option><option value="hdfc">HDFC</option><option value="indusind">IndusInd</option>
        </select>
      </label>
      <label htmlFor="paste-sms" className="flex flex-col gap-1.5 text-[13px] text-ink-2">Message
        <textarea id="paste-sms" value={text} onChange={(event) => { setText(event.target.value); reset(); }} rows={5} maxLength={2000} className="field min-h-32 resize-y font-mono text-[13px] leading-relaxed text-ink" />
      </label>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => void paste()}>Paste from clipboard</Button><Button variant="text" onClick={() => { setText(""); reset(); }}>Clear</Button><Button onClick={() => void parse()} disabled={!online || !text.trim()}>Parse</Button></div>
      {failed && <Card className="p-4 text-[15px]">Couldn’t parse this SMS. Add it manually below.</Card>}
      {parsed && <Card className="mt-2 flex flex-col gap-3.5 p-5">
        <span className="label-caps text-ink-3">Parsed on server · {parsed.bankName}</span>
        <div className="flex justify-between gap-3 border-b-[3px] border-double border-ink pb-3"><span className="min-w-0"><b className="block truncate font-serif text-2xl font-medium">{parsed.merchant}</b><small className="text-[13px] text-ink-3">{parsed.accountLast4 ? `Card ••${parsed.accountLast4}` : "Needs review"}</small></span><b className="shrink-0 font-serif text-[28px] font-medium">{parsed.status === "foreign" ? foreign(parsed.currency, parsed.originalAmount, parsed.amount) : money(parsed.amount)}</b></div>
        <div className="flex justify-between text-sm"><span>{parsed.type} · {parsed.category ?? "Other"}</span><span>{parsed.date ?? "Date unavailable"}</span></div>
        <p className="m-0 text-[13px] text-ink-2">{parsed.status === "foreign" ? "Foreign amount has no verified rupee conversion. Add it manually after checking the card statement." : "Check details before saving. The original message stays on your server."}</p>
      </Card>}
      <div className="mt-auto grid grid-cols-2 gap-2.5 pt-5"><Button variant="outline" onClick={() => void navigate({ to: "/add" })}>Add manually</Button><Button onClick={() => void save()} disabled={!online || parsed?.status !== "parsed"}>Save</Button></div>
    </div>
  </main>;
}
