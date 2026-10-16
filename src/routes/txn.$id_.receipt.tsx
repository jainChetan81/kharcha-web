import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import { Check, ImagePlus, LoaderCircle, Plus, RotateCcw, Trash2, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { saveFailed, snack, useHoldsInput } from "../components/sheet";
import { useOnline } from "../components/sync-pill";
import { Button, Empty, ErrorState, PageHeader, Skeleton } from "../components/ui";
import { money } from "../lib/format";
import { getDetail } from "../server/daily/fns";
import { getCategories } from "../server/fns";
import { deleteAttachment, getReceiptJob, saveReceipt, startReceiptJob, uploadReceipt } from "../server/daily/receipt";

type Item = { key: string; name: string; qty: number | null; amount: number; category: string; confidence: number | null; source: "ai" | "manual" | "adjustment" };
type SavedFile = { id: number; mime: string };
type Draft = { file: File; url: string };
const PRIVACY = "Photos go to the AI service only to read the items. Kharcha removes card numbers and UPI IDs from what it saves. Crop out full card numbers before adding a photo.";

function drawCrop(image: HTMLImageElement, canvas: HTMLCanvasElement, crop: { start: [number, number]; end: [number, number] } | null) {
  if (!image.naturalWidth) return;
  const scale = Math.min(1, 640 / image.naturalWidth);
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (!crop) return;
  const x = Math.min(crop.start[0], crop.end[0]); const y = Math.min(crop.start[1], crop.end[1]);
  const w = Math.abs(crop.start[0] - crop.end[0]); const h = Math.abs(crop.start[1] - crop.end[1]);
  ctx.fillStyle = "rgb(0 0 0 / 35%)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.clearRect(x, y, w, h); ctx.drawImage(image, x / scale, y / scale, w / scale, h / scale, x, y, w, h);
  ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
}

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
  const router = useRouter();
  const online = useOnline();
  useHoldsInput();
  const [items, setItems] = useState<Item[]>(() => (data?.items ?? []).map((item) => ({ ...item, key: crypto.randomUUID(), confidence: item.confidence ?? null, source: item.source as Item["source"] })));
  const [split, setSplit] = useState(Boolean(data?.splits.length));
  const [files, setFiles] = useState<SavedFile[]>(() => (data?.files ?? []).map(({ id, mime }) => ({ id, mime })));
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<{ status: string; error: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState<{ start: [number, number]; end: [number, number] } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const txnId = data?.txn.id;
  const activeDraft = drafts[0];

  useEffect(() => {
    if (!txnId) return;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const poll = async () => {
      const result = await getReceiptJob({ data: { transactionId: txnId } }).catch(() => null);
      if (!alive || !result?.job) return;
      setJob({ status: result.job.status, error: result.job.error });
      if (result.job.status === "done") {
        clearInterval(timer);
        await router.invalidate();
        const refreshed = await getDetail({ data: { id: txnId } });
        if (alive && refreshed) {
          setItems(refreshed.items.map((item) => ({ ...item, key: crypto.randomUUID(), confidence: item.confidence ?? null, source: item.source as Item["source"] })));
          setSplit(Boolean(refreshed.splits.length));
        }
      }
      if (result.job.status === "failed") clearInterval(timer);
    };
    void poll();
    timer = setInterval(() => void poll(), 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [txnId, router]);

  useEffect(() => {
    const image = imageRef.current;
    if (image && canvas.current) drawCrop(image, canvas.current, crop);
  }, [crop]);

  if (!data) return <main className="p-5"><Empty text="Transaction not found." /></main>;
  const categories = data.categories.filter((item) => item.type === (data.txn.type === "income" ? "income" : "expense")).map((item) => item.name);
  const total = items.reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0);
  const agrees = Math.abs(total - data.txn.amount) < 0.01;
  const low = items.filter((item) => item.confidence !== null && item.confidence < 0.7).length;
  const updateItem = (index: number, patch: Partial<Item>) => setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  const addItem = () => setItems((current) => [...current, { key: crypto.randomUUID(), name: "", qty: 1, amount: 0, category: data.txn.category ?? "Food", confidence: null, source: "manual" }]);
  const pick = (list: FileList | null) => {
    if (!list || !online) return;
    const next = [...list].slice(0, Math.max(0, 5 - files.length - drafts.length));
    if (next.length === 0) return snack("A receipt can have at most five files.");
    const prepared: Draft[] = [];
    for (const file of next) {
      if (file.size > 8 * 1024 * 1024) { snack(`${file.name} is larger than 8 MB.`); continue; }
      if (!(["image/jpeg", "image/png", "image/webp", "application/pdf"] as string[]).includes(file.type)) { snack("Unsupported receipt file."); continue; }
      if (file.type.startsWith("image/")) prepared.push({ file, url: URL.createObjectURL(file) });
      else void send(file);
    }
    setDrafts((old) => [...old, ...prepared]);
  };
  const send = async (file: File, cropRect?: { x: number; y: number; width: number; height: number }) => {
    setBusy(true); setError(null);
    try {
      let uploadFile = file;
      if (cropRect && file.type.startsWith("image/")) {
        const image = new Image(); image.src = URL.createObjectURL(file); await image.decode();
        const canvas = document.createElement("canvas"); canvas.width = cropRect.width; canvas.height = cropRect.height;
        canvas.getContext("2d")?.drawImage(image, cropRect.x, cropRect.y, cropRect.width, cropRect.height, 0, 0, cropRect.width, cropRect.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
        URL.revokeObjectURL(image.src); if (!blob) throw new Error("Couldn't crop image.");
        uploadFile = new File([blob], "receipt.jpg", { type: "image/jpeg" });
      }
      const bytes = new Uint8Array(await uploadFile.arrayBuffer()); let binary = "";
      for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      const { id } = await uploadReceipt({ data: { transactionId: data.txn.id, mime: uploadFile.type as "image/jpeg" | "image/png" | "image/webp" | "application/pdf", base64: btoa(binary) } });
      setFiles((old) => [...old, { id, mime: uploadFile.type }]);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save receipt file."); return false; }
    finally { setBusy(false); }
  };
  const addCropped = async () => {
    const draft = drafts[0]; if (!draft) return;
    let rect: { x: number; y: number; width: number; height: number } | undefined;
    const image = imageRef.current; const target = canvas.current;
    if (crop && image && target) {
      const x = Math.min(crop.start[0], crop.end[0]); const y = Math.min(crop.start[1], crop.end[1]);
      const scale = target.width / image.naturalWidth;
      const width = Math.abs(crop.start[0] - crop.end[0]); const height = Math.abs(crop.start[1] - crop.end[1]);
      if (width > 20 && height > 20) rect = { x: x / scale, y: y / scale, width: width / scale, height: height / scale };
    }
    if (await send(draft.file, rect)) { URL.revokeObjectURL(draft.url); setDrafts((old) => old.slice(1)); setCrop(null); }
  };
  const removeFile = async (id: number) => {
    if (!online) return;
    try { await deleteAttachment({ data: { id } }); setFiles((old) => old.filter((file) => file.id !== id)); }
    catch { snack("Couldn't remove receipt file."); }
  };
  const startRead = async () => {
    if (!online || busy || files.length === 0) return;
    setBusy(true); setError(null);
    try { await startReceiptJob({ data: { transactionId: data.txn.id } }); setJob({ status: "queued", error: null }); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't start receipt reading."); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!online || busy || items.some((item) => !item.name.trim() || !Number.isFinite(item.amount) || item.amount <= 0)) return;
    const clean = items.map(({ key: _key, ...item }) => ({ ...item, name: item.name.trim() }));
    if (split && !agrees) return snack("Split totals must equal transaction amount.");
    setBusy(true);
    try { await saveReceipt({ data: { id: data.txn.id, split, items: clean } }); snack("Receipt items saved."); void navigate({ to: "/txn/$id", params: { id: String(data.txn.id) } }); }
    catch (e) { if (e instanceof Error && /Splits must equal/.test(e.message)) snack(e.message); else saveFailed(save); }
    finally { setBusy(false); }
  };
  const selectedItems = selected.length > 1 ? items.filter((item) => selected.includes(item.key)) : [];
  const merge = () => {
    if (selectedItems.length < 2) return;
    const first = items.findIndex((item) => selected.includes(item.key));
    const merged = { ...items[first], amount: selectedItems.reduce((n, item) => n + item.amount, 0), qty: selectedItems.reduce((n, item) => n + (item.qty ?? 1), 0) };
    setItems((old) => [...old.filter((item) => !selected.includes(item.key)).slice(0, first), merged, ...old.filter((item) => !selected.includes(item.key)).slice(first)]); setSelected([]);
  };
  const removeSelected = () => { setItems((old) => old.filter((item) => !selected.includes(item.key))); setSelected([]); };
  const adjustment = () => {
    if (!items.length) return addItem();
    const largest = items.reduce((a, b) => a.amount >= b.amount ? a : b);
    const gap = Math.round((data.txn.amount - total) * 100) / 100;
    if (!gap) return;
    setItems((old) => [...old, { key: crypto.randomUUID(), name: "Adjustment", qty: 1, amount: Math.abs(gap), category: largest.category, confidence: null, source: "adjustment" }]);
  };

  return <main>
    <PageHeader back="/txn/$id" title="Receipt" />
    <div className="space-y-6 px-5 pb-10 tablet:mx-auto tablet:max-w-[640px]">
      <section className="space-y-3 rounded-card border border-dashed border-field bg-card p-4">
        <p className="m-0 text-sm text-ink-2">{PRIVACY}</p>
        <div className="grid grid-cols-3 gap-2">
          {[{ label: "Camera", capture: "environment" as const }, { label: "Gallery", capture: undefined }, { label: "Files", capture: undefined }].map((source) => <label key={source.label} className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-card border border-field bg-input px-2 text-sm font-medium focus-within:ring-2 focus-within:ring-brand"><ImagePlus size={17} aria-hidden="true" />{source.label}<input className="sr-only" type="file" accept={source.label === "Files" ? "application/pdf,image/*" : "image/*"} capture={source.capture} multiple={files.length + drafts.length < 5} disabled={!online || busy || files.length + drafts.length >= 5} onChange={(event) => { pick(event.currentTarget.files); event.currentTarget.value = ""; }} /></label>)}
        </div>
        {activeDraft && <div className="space-y-2 rounded-card border border-hairline p-2"><p className="m-0 text-sm">Crop photo before adding. Drag to select area; full image uploads if no crop selected.</p><img ref={imageRef} src={activeDraft.url} alt="Receipt crop preview" className="sr-only" onLoad={(event) => { setCrop(null); if (canvas.current) drawCrop(event.currentTarget, canvas.current, null); }} /><canvas ref={canvas} className="max-h-[55vh] w-full touch-none rounded-lg object-contain" onPointerDown={(event) => { const r = event.currentTarget.getBoundingClientRect(); const p: [number, number] = [(event.clientX - r.left) * event.currentTarget.width / r.width, (event.clientY - r.top) * event.currentTarget.height / r.height]; setCrop({ start: p, end: p }); event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={(event) => { if (!crop) return; const r = event.currentTarget.getBoundingClientRect(); setCrop((old) => old && { ...old, end: [(event.clientX - r.left) * event.currentTarget.width / r.width, (event.clientY - r.top) * event.currentTarget.height / r.height] }); }} onPointerUp={() => undefined} aria-label="Select crop area" role="img" /><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => void addCropped()}>{busy ? "Adding…" : "Crop & add photo"}</Button><Button variant="outline" disabled={busy} onClick={() => { URL.revokeObjectURL(activeDraft.url); setDrafts((old) => old.slice(1)); }}>Cancel</Button></div></div>}
        {files.length > 0 && <ul className="m-0 flex list-none flex-wrap gap-2 p-0">{files.map((file, i) => <li key={file.id} className="flex min-h-11 items-center gap-2 rounded-chip border border-field px-3 text-sm"><a href={`/api/attachments/${file.id}`} target="_blank" rel="noreferrer" className="text-brand">{file.mime === "application/pdf" ? "PDF" : `Photo ${i + 1}`}</a><button type="button" aria-label={`Remove receipt file ${i + 1}`} disabled={!online || busy} className="min-h-11 min-w-11 text-over disabled:opacity-50" onClick={() => void removeFile(file.id)}><Trash2 size={16} /></button></li>)}</ul>}
        <Button onClick={() => void startRead()} disabled={!online || busy || files.length === 0 || drafts.length > 0}>{job?.status === "reading" || job?.status === "queued" ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" size={17} />Reading receipt…</> : <><WandSparkles size={17} />Read receipt</>}</Button>
        {!online && <p className="m-0 text-sm text-ink-3">Offline. Receipt files and saved items remain viewable; editing is disabled.</p>}
      </section>
      {error && <p role="alert" className="m-0 text-sm text-over">{error}</p>}
      {job?.status === "failed" && <section className="space-y-2 rounded-card border border-hairline bg-card p-4"><h2 className="m-0 text-lg">Receipt couldn't be read</h2><p className="m-0 text-sm text-ink-2">{job.error === "not_receipt" ? "These images don't look like a receipt." : job.error === "ai_unavailable" ? "AI is off, busy or over its daily limit." : "The image was unreadable. Try a clearer photo."} Images stay attached.</p><Button variant="outline" disabled={!online} onClick={() => void startRead()}><RotateCcw size={16} />Retry</Button></section>}
      {job && (job.status === "queued" || job.status === "reading") && <section aria-live="polite" className="space-y-3 rounded-card border border-hairline bg-card p-4"><p className="m-0 flex items-center gap-2"><LoaderCircle size={17} className="animate-spin motion-reduce:animate-none" />Reading {files.length} file{files.length === 1 ? "" : "s"}…</p>{[1, 2, 3].map((n) => <div key={n} className="h-11 animate-pulse rounded-lg bg-sunken" />)}</section>}
      {data.items.length > 0 || items.length > 0 ? <>
        <section className="border-b-[3px] border-double border-ink pb-4"><span className="label-caps text-ink-3">Matched to transaction</span><div className="mt-1 flex items-baseline justify-between gap-3"><strong className="font-serif text-2xl font-medium">{data.txn.merchant}</strong><strong className="font-serif text-2xl font-medium">{money(data.txn.amount)}</strong></div><span className={`mt-2 block text-sm font-medium ${agrees ? "text-earn" : "text-over"}`}>{agrees ? <><Check size={16} className="inline" /> Totals agree</> : `${money(total)} of ${money(data.txn.amount)} · gap ${money(Math.abs(data.txn.amount - total))}`}</span><div className="mt-3 h-3 overflow-hidden rounded-full bg-sunken" role="img" aria-label={`Item total ${money(total)} of ${money(data.txn.amount)}`}><div className="h-full bg-brand" style={{ width: `${Math.min(100, data.txn.amount ? total / data.txn.amount * 100 : 0)}%` }} /></div></section>
        {low > 0 && <p className="m-0 rounded-card bg-watch-soft p-3 text-sm text-ink">{low} low-confidence line{low === 1 ? "" : "s"}. Check details before saving.</p>}
        {job?.status === "failed" && job.error === "ai_unavailable" && <p className="m-0 rounded-card bg-card p-3 text-sm text-ink-2">Receipt reading is off on this server. Add items by hand. {money(Math.max(0, data.txn.amount - total))} not itemised · Stays in {data.txn.category ?? "Other"}.</p>}
        <section><div className="mb-2 flex items-center justify-between"><h2 className="label-caps m-0 text-ink-3">Items · {items.length} rows</h2><div className="flex gap-2">{selectedItems.length > 1 && <Button variant="outline" onClick={merge} disabled={!online}>Merge</Button>}{selected.length > 0 && <Button variant="outline" onClick={removeSelected} disabled={!online}>Delete</Button>}</div></div><div className="space-y-2">{items.map((item, index) => <div key={item.key} className={`grid grid-cols-[28px_minmax(0,1fr)_80px] gap-2 rounded-card border p-2 ${item.confidence !== null && item.confidence < 0.7 ? "border-watch bg-watch-soft" : "border-hairline bg-card"}`}><input type="checkbox" aria-label={`Select item ${index + 1}`} checked={selected.includes(item.key)} disabled={!online} onChange={(e) => setSelected((old) => e.currentTarget.checked ? [...old, item.key] : old.filter((key) => key !== item.key))} className="size-5 self-center accent-brand" /><div className="grid min-w-0 grid-cols-2 gap-2"><input aria-label={`Item ${index + 1} name`} className="field col-span-2 min-w-0" value={item.name} placeholder="Item name" disabled={!online} onChange={(e) => updateItem(index, { name: e.currentTarget.value, confidence: null })} /><input aria-label={`Item ${index + 1} quantity`} className="field min-w-0 text-sm" inputMode="decimal" value={item.qty ?? ""} placeholder="Qty" disabled={!online} onChange={(e) => updateItem(index, { qty: Number(e.currentTarget.value) || null })} /><select aria-label={`Item ${index + 1} category`} className="field min-w-0 px-2 text-sm" value={item.category} disabled={!online} onChange={(e) => updateItem(index, { category: e.currentTarget.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></div><div><input aria-label={`Item ${index + 1} amount`} className="field min-w-0 text-right" inputMode="decimal" value={item.amount || ""} placeholder="₹0" disabled={!online} onChange={(e) => updateItem(index, { amount: Number(e.currentTarget.value) || 0 })} />{item.confidence !== null && item.confidence < 0.7 && <button type="button" className="min-h-11 text-sm text-watch" disabled={!online} onClick={() => updateItem(index, { confidence: 1 })}>? Looks right</button>}</div></div>)}</div><div className="mt-3 flex gap-2"><Button variant="outline" onClick={addItem} disabled={!online}><Plus size={17} />Add item</Button>{total < data.txn.amount - 0.01 && <Button variant="outline" onClick={adjustment} disabled={!online}>Add as adjustment</Button>}</div></section>
        <div className="flex items-center justify-between border-y border-hairline py-3"><span><strong className="block text-[15px]">Split by category</strong><span className="text-sm text-ink-3">Use item totals in spending views</span></span><input aria-label="Split by category" type="checkbox" checked={split} disabled={!online} onChange={(e) => setSplit(e.currentTarget.checked)} className="size-6 accent-brand" /></div>
        <Button className="min-h-[52px]" disabled={!online || busy || items.some((item) => !item.name.trim() || !Number.isFinite(item.amount) || item.amount <= 0) || (split && !agrees)} onClick={() => void save()}>{low ? "Save anyway" : "Save items"}</Button>
      </> : <section className="space-y-3"><h2 className="m-0 font-serif text-xl">Add items by hand</h2><p className="m-0 text-sm text-ink-2">{files.length ? "Read receipt to fill items, or enter them by hand." : "Add a receipt photo, or enter items by hand."}</p><Button variant="outline" onClick={addItem} disabled={!online}><Plus size={17} />Add item</Button></section>}
    </div>
  </main>;
}
