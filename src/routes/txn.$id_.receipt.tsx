import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { ImagePlus, Plus } from "lucide-react";
import { useState } from "react";
import { saveFailed, snack, useHoldsInput } from "../components/sheet";
import { useOnline } from "../components/sync-pill";
import { Button, Empty, ErrorState, PageHeader, Skeleton, Switch } from "../components/ui";
import { money } from "../lib/format";
import { getDetail } from "../server/daily/fns";
import { getCategories } from "../server/fns";
import { saveReceipt, uploadReceipt } from "../server/daily/receipt";

type Item = {
  key: string;
  name: string;
  qty: number | null;
  amount: number;
  category: string;
};

export const Route = createFileRoute("/txn/$id_/receipt")({
  loader: async ({ params }) => {
    const [detail, categories] = await Promise.all([getDetail({ data: { id: Number(params.id) } }), getCategories()]);
    return detail && { ...detail, categories };
  },
  pendingComponent: () => <Skeleton rows={5} />,
  errorComponent: ({ error }) => { const router = useRouter(); return <ErrorState text={error instanceof Error ? error.message : "Couldn't load receipt."} retry={() => void router.invalidate()} />; },
  component: Receipt,
});

function Receipt() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const online = useOnline();
  useHoldsInput();
  const [items, setItems] = useState<Item[]>(() => (data?.items ?? []).map((item) => ({ ...item, key: crypto.randomUUID() })));
  const [split, setSplit] = useState(Boolean(data?.splits.length));
  const [uploading, setUploading] = useState(false);
  const [files, setFiles] = useState(() => (data?.files ?? []).map(({ id, mime }) => ({ id, mime })));
  const uploads = files.length;

  if (!data) return <main className="p-5"><Empty text="Transaction not found." /></main>;
  const categories = data.categories.filter((item) => item.type === (data.txn.type === "income" ? "income" : "expense")).map((item) => item.name);

  const total = items.reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0);
  const agrees = Math.abs(total - data.txn.amount) < 0.01;
  const updateItem = (index: number, patch: Partial<Item>) =>
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  const addItem = () => setItems((current) => [...current, { key: crypto.randomUUID(), name: "", qty: 1, amount: 0, category: "Other" }]);

  const upload = async (files: FileList | null) => {
    if (!files?.length || !online || uploading) return;
    const chosen = [...files].slice(0, 5 - uploads);
    if (!chosen.length) return snack("A receipt can have at most five files.");
    setUploading(true);
    let saved = 0;
    try {
      for (const file of chosen) {
        if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} is larger than 8 MB.`);
        if (file.type !== "image/jpeg" && file.type !== "image/png" && file.type !== "image/webp" && file.type !== "application/pdf") throw new Error("Unsupported receipt file.");
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
        const { id } = await uploadReceipt({ data: { transactionId: data.txn.id, mime: file.type, base64: btoa(binary) } });
        saved++;
        setFiles((current) => [...current, { id, mime: file.type }]);
      }
      snack(`${saved} receipt file${saved === 1 ? "" : "s"} saved.`);
    } catch (error) {
      snack(error instanceof Error ? error.message : "Couldn't save receipt files.");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    if (!online || uploading || items.some((item) => !item.name.trim() || !Number.isFinite(item.amount) || item.amount <= 0)) return;
    const clean = items.map((item) => ({ name: item.name.trim(), qty: item.qty, amount: item.amount, category: item.category }));
    const grouped = clean.reduce<Record<string, number>>((result, item) => {
      result[item.category] = (result[item.category] ?? 0) + item.amount;
      return result;
    }, {});
    const splits = split ? Object.entries(grouped).map(([category, amount]) => ({ category, amount })) : [];
    if (split && !agrees) return snack("Split totals must equal transaction amount.");
    try {
      await saveReceipt({ data: { id: data.txn.id, items: clean, splits } });
      snack("Receipt items saved.");
      void navigate({ to: "/txn/$id", params: { id: String(data.txn.id) } });
    } catch {
      saveFailed(save);
    }
  };

  return (
    <main>
      <PageHeader back="/txn/$id" title="Receipt" />
      <div className="space-y-6 px-5 pb-10 tablet:mx-auto tablet:max-w-[640px]">
        <section className="rounded-card border border-dashed border-field bg-card p-4">
          <label className="flex min-h-20 cursor-pointer items-center gap-3" htmlFor="receipt-files">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"><ImagePlus size={20} /></span>
            <span className="flex flex-col gap-0.5">
              <strong className="text-[15px]">Add receipt images or PDFs</strong>
              <span className="text-[13px] text-ink-3">Up to 5 files · 8 MB each</span>
            </span>
          </label>
          <input id="receipt-files" className="sr-only" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple disabled={!online || uploading || uploads >= 5} onChange={(event) => void upload(event.currentTarget.files)} />
          {uploads > 0 && (
            <ul className="mt-3 mb-0 flex list-none flex-wrap gap-2 p-0">
              {files.map((file, index) => (
                <li key={file.id}>
                  <a href={`/api/attachments/${file.id}`} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-chip border border-field bg-card px-3 text-sm font-medium">
                    {file.mime === "application/pdf" ? "PDF" : "Image"} {index + 1}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>


        <section className="border-b-[3px] border-double border-ink pb-4">
          <span className="label-caps text-ink-3">Matched to transaction</span>
          <div className="mt-1 flex items-baseline justify-between gap-3"><strong className="font-serif text-2xl font-medium">{data.txn.merchant}</strong><strong className="font-serif text-2xl font-medium">{money(data.txn.amount)}</strong></div>
          <span className={`mt-2 block text-sm font-medium ${agrees ? "text-earn" : "text-over"}`}>{agrees ? "Totals agree" : `${money(total)} of ${money(data.txn.amount)}`}</span>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between"><h2 className="label-caps m-0 text-ink-3">Items</h2><span className="text-sm text-ink-3">{items.length} rows</span></div>
          <div className="space-y-2">
            {items.map((item, index) => (
              <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_76px] gap-2 rounded-card border border-hairline bg-card p-2">
                <input aria-label={`Item ${index + 1} name`} className="field min-w-0" value={item.name} placeholder="Item name" onChange={(event) => updateItem(index, { name: event.currentTarget.value })} />
                <input aria-label={`Item ${index + 1} amount`} className="field min-w-0 text-right" inputMode="decimal" defaultValue={item.amount || ""} placeholder="₹0" onChange={(event) => updateItem(index, { amount: Number(event.currentTarget.value) || 0 })} />
                <input aria-label={`Item ${index + 1} quantity`} className="field min-w-0 text-sm" inputMode="decimal" defaultValue={item.qty ?? ""} placeholder="Qty" onChange={(event) => updateItem(index, { qty: Number(event.currentTarget.value) || null })} />
                <select aria-label={`Item ${index + 1} category`} className="field min-w-0 px-2 text-sm" value={item.category} onChange={(event) => updateItem(index, { category: event.currentTarget.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select>
              </div>
            ))}
          </div>
          <Button variant="outline" className="mt-3" onClick={addItem} disabled={!online}><Plus size={17} />Add item</Button>
        </section>

        <div className="flex items-center justify-between border-y border-hairline py-3"><span><strong className="block text-[15px]">Split by category</strong><span className="text-sm text-ink-3">Use item totals in spending views</span></span><Switch label="Split by category" checked={split} onChange={setSplit} disabled={!online} /></div>
        <Button className="min-h-[52px]" disabled={!online || uploading || items.some((item) => !item.name.trim() || !Number.isFinite(item.amount) || item.amount <= 0) || (split && !agrees)} onClick={() => void save()}>Save items</Button>
      </div>
    </main>
  );
}
