import { createFileRoute, useBlocker, useNavigate, useRouter } from "@tanstack/react-router";
import { Check, ImagePlus, LoaderCircle, Plus, RotateCcw, RotateCw, Trash2, WandSparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { saveFailed, snack, useHoldsInput } from "../components/sheet";
import { useOnline } from "../components/sync-pill";
import { Button, Empty, ErrorState, PageHeader, Skeleton } from "../components/ui";
import { money } from "../lib/format";
import { getDetail } from "../server/daily/fns";
import { getCategories } from "../server/fns";
import { deleteAttachment, getReceiptAvailability, getReceiptJob, saveReceipt, startReceiptJob, uploadReceipt } from "../server/daily/receipt";

type Item = { key: string; name: string; qty: number | null; amount: number; category: string; confidence: number | null; source: "ai" | "manual" | "adjustment" };
type SavedFile = { id: number; mime: string };
type Draft = { file: File; url: string; rotate: number };
type Rect = { x: number; y: number; width: number; height: number };
const PRIVACY = "Photos stay on your server. Kharcha reads the text there, removes card, account and UPI numbers, and sends only the remaining text to the AI service.";
const MIN_CROP = 24;

/** Render the photo with its Rotate turns applied. maxSide caps the longer edge (preview 900, upload 2400). */
function rotatedCanvas(image: HTMLImageElement, rotate: number, maxSide: number): HTMLCanvasElement {
  const swapped = rotate % 2 === 1;
  const width = swapped ? image.naturalHeight : image.naturalWidth;
  const height = swapped ? image.naturalWidth : image.naturalHeight;
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const out = document.createElement("canvas");
  out.width = Math.round(width * scale);
  out.height = Math.round(height * scale);
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(rotate * Math.PI / 2);
  ctx.drawImage(image, -image.naturalWidth * scale / 2, -image.naturalHeight * scale / 2, image.naturalWidth * scale, image.naturalHeight * scale);
  return out;
}

/** Paint the preview canvas: rotated photo, dimmed outside the crop frame, handles on the frame. */
function drawCrop(image: HTMLImageElement, canvas: HTMLCanvasElement, rect: Rect | null, rotate: number) {
  if (!image.naturalWidth) return;
  const source = rotatedCanvas(image, rotate, 900);
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(source, 0, 0);
  const frame = rect ?? { x: 0, y: 0, width: canvas.width, height: canvas.height };
  const x = Math.max(0, Math.min(canvas.width - MIN_CROP, frame.x));
  const y = Math.max(0, Math.min(canvas.height - MIN_CROP, frame.y));
  const w = Math.max(MIN_CROP, Math.min(canvas.width - x, frame.width));
  const h = Math.max(MIN_CROP, Math.min(canvas.height - y, frame.height));
  ctx.fillStyle = "rgb(0 0 0 / 40%)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.clearRect(x, y, w, h);
  ctx.drawImage(source, x, y, w, h, x, y, w, h);
  ctx.strokeStyle = "white";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);
  for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    ctx.fillStyle = "white";
    ctx.fillRect(cx - 5, cy - 5, 10, 10);
  }
}

export const Route = createFileRoute("/txn/$id_/receipt")({
  loader: async ({ params }) => {
    const [detail, categories, availability] = await Promise.all([
      getDetail({ data: { id: Number(params.id) } }), getCategories(), getReceiptAvailability(),
    ]);
    return detail && { ...detail, categories, aiOn: availability.aiOn };
  },
  pendingComponent: () => <Skeleton rows={5} />,
  errorComponent: ({ error }) => { const router = useRouter(); return <ErrorState text={error instanceof Error ? error.message : "Couldn't load receipt."} retry={() => void router.invalidate()} />; },
  component: Receipt,
});

// Compare item content only; React keys are not part of the saved draft.
const sig = (list: Item[]) => JSON.stringify(list.map(({ key: _key, ...item }) => item));

function Receipt() {
  const data = Route.useLoaderData();
  const navigate = useNavigate();
  const router = useRouter();
  const online = useOnline();
  useHoldsInput();
  const [items, setItems] = useState<Item[]>(() => (data?.items ?? []).map((item) => ({ ...item, key: crypto.randomUUID(), confidence: item.confidence ?? null, source: item.source as Item["source"] })));
  const [baseline, setBaseline] = useState(() => sig(items));
  // Unsaved item edits block in-app navigation (confirm) and tab close. Read by the blocker, so a ref.
  const dirtyRef = useRef(false);
  useBlocker({ shouldBlockFn: () => dirtyRef.current && !window.confirm("Discard receipt items?"), enableBeforeUnload: () => dirtyRef.current });
  const [split, setSplit] = useState(Boolean(data?.splits.length));
  const [files, setFiles] = useState<SavedFile[]>(() => (data?.files ?? []).map(({ id, mime }) => ({ id, mime })));
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<{ status: string; error: string | null } | null>(null);
  const [jobRun, setJobRun] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; edge: string } | null>(null);
  const txnId = data?.txn.id;
  const activeDraft = drafts[0];

  useEffect(() => {
    if (!txnId || jobRun < 0) return;
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
          const next = refreshed.items.map((item) => ({ ...item, key: crypto.randomUUID(), confidence: item.confidence ?? null, source: item.source as Item["source"] }));
          setItems(next); setBaseline(sig(next));
          setSplit(Boolean(refreshed.splits.length));
        }
      }
      if (result.job.status === "failed") clearInterval(timer);
    };
    void poll();
    timer = setInterval(() => void poll(), 1500);
    return () => { alive = false; clearInterval(timer); };
  }, [txnId, router, jobRun]);

  useEffect(() => {
    const image = imageRef.current;
    const target = canvas.current;
    if (!image || !target || !activeDraft || !image.complete) return;
    drawCrop(image, target, crop, activeDraft.rotate);
  }, [crop, activeDraft]);

  dirtyRef.current = sig(items) !== baseline;
  if (!data) return <main className="p-5"><Empty text="Transaction not found." /></main>;
  const categories = data.categories.filter((item) => item.type === (data.txn.type === "income" ? "income" : "expense")).map((item) => item.name);
  const total = items.reduce((sum, item) => sum + (Number.isFinite(item.amount) ? item.amount : 0), 0);
  const agrees = Math.abs(total - data.txn.amount) < 0.01;
  const low = items.filter((item) => item.confidence !== null && item.confidence < 0.7).length;
  const grouped = categories.map((category) => ({ category, amount: items.filter((item) => item.category === category).reduce((sum, item) => sum + item.amount, 0), rows: items.filter((item) => item.category === category) })).filter((group) => group.rows.length);
  const updateItem = (index: number, patch: Partial<Item>) => setItems((current) => current.map((item, i) => i === index ? { ...item, ...patch } : item));
  const fallbackCategory = categories.includes(data.txn.category ?? "") ? data.txn.category! : categories.includes("Other") ? "Other" : categories[0] ?? "Other";
  const addItem = () => setItems((current) => [...current, { key: crypto.randomUUID(), name: "", qty: 1, amount: 0, category: fallbackCategory, confidence: null, source: "manual" }]);
  const pick = (list: FileList | null) => {
    if (!list || !online || busy) return;
    const next = [...list].slice(0, Math.max(0, 5 - files.length - drafts.length));
    if (next.length === 0) return snack("A receipt can have at most five files.");
    for (const file of next) {
      if (file.size > 8 * 1024 * 1024) { snack(`${file.name} is larger than 8 MB.`); continue; }
      if (!(file.type === "application/pdf" || file.type.startsWith("image/"))) { snack("Unsupported receipt file."); continue; }
      if (file.type.startsWith("image/")) {
        setDrafts((old) => [...old, { file, url: URL.createObjectURL(file), rotate: 0 }]);
        setCrop(null);
      } else void sendPdf(file);
    }
  };
  const sendBytes = async (uploadFile: File) => {
    setBusy(true); setError(null);
    try {
      const bytes = new Uint8Array(await uploadFile.arrayBuffer());
      let binary = "";
      for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      const { id } = await uploadReceipt({ data: { transactionId: data.txn.id, mime: uploadFile.type as "image/jpeg" | "application/pdf", base64: btoa(binary) } });
      setFiles((old) => [...old, { id, mime: uploadFile.type }]);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't save receipt file."); return false; }
    finally { setBusy(false); }
  };
  const sendPdf = async (file: File) => {
    if (file.type !== "application/pdf" || file.size > 8 * 1024 * 1024) return;
    await sendBytes(file);
  };
  const addCropped = async () => {
    const draft = drafts[0];
    const image = imageRef.current;
    const preview = canvas.current;
    if (!draft || !image || !preview || !online) return;
    // Crop is in preview pixels; map it onto a full-resolution render of the same rotation.
    const full = rotatedCanvas(image, draft.rotate, 2400);
    const k = full.width / preview.width;
    const frame = crop ?? { x: 0, y: 0, width: preview.width, height: preview.height };
    const sx = Math.max(0, Math.round(frame.x * k));
    const sy = Math.max(0, Math.round(frame.y * k));
    const sw = Math.max(1, Math.min(full.width - sx, Math.round(frame.width * k)));
    const sh = Math.max(1, Math.min(full.height - sy, Math.round(frame.height * k)));
    const out = document.createElement("canvas");
    out.width = sw; out.height = sh;
    const ctx = out.getContext("2d");
    if (!ctx) return setError("Couldn't crop image.");
    ctx.drawImage(full, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) return setError("Couldn't crop image.");
    // Re-encoded JPEG from canvas: EXIF and the original file never leave the device.
    const file = new File([blob], "receipt.jpg", { type: "image/jpeg" });
    if (await sendBytes(file)) {
      URL.revokeObjectURL(draft.url);
      setDrafts((old) => old.slice(1));
      setCrop(null);
    }
  };
  const removeDraft = () => {
    const draft = drafts[0];
    if (!draft) return;
    URL.revokeObjectURL(draft.url);
    setDrafts((old) => old.slice(1));
    setCrop(null);
  };
  const cropPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const target = event.currentTarget;
    const bounds = target.getBoundingClientRect();
    const x = Math.max(0, Math.min(target.width, (event.clientX - bounds.left) * target.width / bounds.width));
    const y = Math.max(0, Math.min(target.height, (event.clientY - bounds.top) * target.height / bounds.height));
    if (event.type === "pointerdown") {
      const current = crop ?? { x: 0, y: 0, width: target.width, height: target.height };
      const near = (a: number, b: number) => Math.abs(a - b) < 30;
      const edges = `${near(x, current.x) ? "l" : near(x, current.x + current.width) ? "r" : ""}${near(y, current.y) ? "t" : near(y, current.y + current.height) ? "b" : ""}`;
      dragRef.current = { x, y, edge: edges };
      target.setPointerCapture(event.pointerId);
    } else if (dragRef.current) {
      const drag = dragRef.current;
      setCrop((old) => {
        const base = old ?? { x: 0, y: 0, width: target.width, height: target.height };
        if (drag.edge === "") return { ...base, x: Math.max(0, Math.min(target.width - base.width, base.x + x - drag.x)), y: Math.max(0, Math.min(target.height - base.height, base.y + y - drag.y)) };
        let left = base.x; let top = base.y; let right = base.x + base.width; let bottom = base.y + base.height;
        if (drag.edge.includes("l")) left = Math.max(0, Math.min(right - MIN_CROP, x));
        if (drag.edge.includes("r")) right = Math.min(target.width, Math.max(left + MIN_CROP, x));
        if (drag.edge.includes("t")) top = Math.max(0, Math.min(bottom - MIN_CROP, y));
        if (drag.edge.includes("b")) bottom = Math.min(target.height, Math.max(top + MIN_CROP, y));
        return { x: left, y: top, width: right - left, height: bottom - top };
      });
    }
  };
  const removeFile = async (id: number) => {
    if (!online || busy) return;
    try { await deleteAttachment({ data: { id } }); setFiles((old) => old.filter((file) => file.id !== id)); }
    catch { snack("Couldn't remove receipt file."); }
  };
  const startRead = async () => {
    if (!online || busy || files.length === 0) return;
    if (!data.aiOn) { setJob({ status: "failed", error: "ai_unavailable" }); return; }
    setBusy(true); setError(null);
    try {
      const result = await startReceiptJob({ data: { transactionId: data.txn.id } });
      setJob({ status: result.status, error: result.error });
      setJobRun((run) => run + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Couldn't start receipt reading."); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!online || busy || items.some((item) => !item.name.trim() || !Number.isFinite(item.amount) || item.amount <= 0)) return;
    const clean = items.map(({ key: _key, ...item }) => ({ ...item, name: item.name.trim() }));
    if (split && !agrees) return snack("Split totals must equal transaction amount.");
    setBusy(true);
    try { await saveReceipt({ data: { id: data.txn.id, split, items: clean } }); snack("Receipt items saved."); dirtyRef.current = false; void navigate({ to: "/txn/$id", params: { id: String(data.txn.id) } }); }
    catch (e) { if (e instanceof Error && (/Splits must equal/.test(e.message) || /Cancel the item reimbursement claim/.test(e.message))) snack(e.message); else saveFailed(save); }
    finally { setBusy(false); }
  };
  const selectedItems = selected.length > 1 ? items.filter((item) => selected.includes(item.key)) : [];
  const merge = () => {
    if (selectedItems.length < 2 || !online) return;
    const first = items.findIndex((item) => selected.includes(item.key));
    const merged = { ...items[first]!, amount: selectedItems.reduce((n, item) => n + item.amount, 0), qty: selectedItems.reduce((n, item) => n + (item.qty ?? 1), 0) };
    setItems((old) => [...old.filter((item) => !selected.includes(item.key)).slice(0, first), merged, ...old.filter((item) => !selected.includes(item.key)).slice(first)]);
    setSelected([]);
  };
  const deleteItems = (keys: string[]) => {
    if (!online) return;
    const removed = items.filter((item) => keys.includes(item.key));
    setItems((old) => old.filter((item) => !keys.includes(item.key)));
    setSelected([]);
    snack(removed.length === 1 ? "Item deleted." : `${removed.length} items deleted.`, { label: "Undo", onClick: () => setItems((old) => {
      const restored = [...old];
      for (const item of removed) restored.splice(Math.min(items.findIndex((x) => x.key === item.key), restored.length), 0, item);
      return restored;
    }) });
  };
  const adjustment = () => {
    if (!online || !items.length) return;
    const largest = items.reduce((a, b) => a.amount >= b.amount ? a : b);
    const gap = Math.round((data.txn.amount - total) * 100) / 100;
    if (gap <= 0) return;
    setItems((old) => [...old, { key: crypto.randomUUID(), name: "Adjustment", qty: 1, amount: gap, category: largest.category, confidence: null, source: "adjustment" }]);
  };

  return <main>
    <PageHeader back="/txn/$id" title="Receipt" sub={`${data.txn.merchant} · ${money(data.txn.amount)}`} />
    <div className="space-y-6 px-5 pb-10 tablet:mx-auto tablet:max-w-[960px]">
      <div className="grid gap-6 desk:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
        <section className="space-y-3 rounded-card border border-dashed border-field bg-card p-4">
          <p className="m-0 text-sm leading-relaxed text-ink-2">{PRIVACY}</p>
          <div className="grid grid-cols-3 gap-2">
            {[{ label: "Camera", capture: "environment" as const }, { label: "Gallery", capture: undefined }, { label: "Files", capture: undefined }].map((source) => <label key={source.label} className="flex min-h-[88px] cursor-pointer flex-col items-center justify-center gap-2 rounded-card border border-field bg-input px-2 text-sm font-medium focus-within:ring-2 focus-within:ring-brand"><ImagePlus size={22} aria-hidden="true" />{source.label}<input className="sr-only" type="file" accept={source.label === "Files" ? "application/pdf,image/*" : "image/*"} capture={source.capture} multiple={files.length + drafts.length < 5} disabled={!online || busy || files.length + drafts.length >= 5} onChange={(event) => { pick(event.currentTarget.files); event.currentTarget.value = ""; }} /></label>)}
          </div>
          {activeDraft && <div className="space-y-3 rounded-card border border-hairline p-3">
            <p className="m-0 text-sm font-medium">Crop photo before adding</p>
            <img ref={imageRef} src={activeDraft.url} alt="Receipt crop preview" className="sr-only" onLoad={(event) => { const image = event.currentTarget; const width = activeDraft.rotate % 2 ? image.naturalHeight : image.naturalWidth; const height = activeDraft.rotate % 2 ? image.naturalWidth : image.naturalHeight; const scale = Math.min(1, 900 / Math.max(width, height)); const next = { x: 0, y: 0, width: Math.round(width * scale), height: Math.round(height * scale) }; setCrop(next); if (canvas.current) drawCrop(image, canvas.current, next, activeDraft.rotate); }} />
            <canvas ref={canvas} className="max-h-[55vh] w-full touch-none rounded-lg object-contain" onPointerDown={(event) => cropPointer(event)} onPointerMove={(event) => { if (dragRef.current) cropPointer(event); }} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }} aria-label="Drag crop frame corners or edges" role="img" />
            <p className="m-0 text-sm text-ink-2">Only the part inside the frame is uploaded.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" disabled={busy} onClick={() => { setDrafts((old) => old.map((d, i) => i ? d : { ...d, rotate: (d.rotate + 1) % 4 })); setCrop(null); }}><RotateCw size={17} />Rotate 90°</Button>
              <Button variant="outline" disabled={busy} onClick={() => setCrop(null)}><RotateCcw size={17} />Reset</Button>
            </div>
            <div className="grid grid-cols-2 gap-2"><Button variant="outline" disabled={busy} onClick={removeDraft}><X size={16} />Retake</Button><Button disabled={busy || !online} onClick={() => void addCropped()}>{busy ? "Adding…" : "Use photo"}</Button></div>
          </div>}
          {files.length > 0 && <div className="space-y-2">
            <p className="m-0 text-sm font-medium">{files.length} of 5 files</p>
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0">{files.map((file, i) => <li key={file.id} className="flex min-h-11 items-center gap-2 rounded-chip border border-field px-3 text-sm"><a href={`/api/attachments/${file.id}`} target="_blank" rel="noreferrer" className="text-brand">{file.mime === "application/pdf" ? "PDF" : `Photo ${i + 1}`}</a><button type="button" aria-label={`Remove receipt file ${i + 1}`} disabled={!online || busy} className="flex min-h-11 min-w-11 items-center justify-center text-over disabled:opacity-50" onClick={() => void removeFile(file.id)}><Trash2 size={16} /></button></li>)}</ul>
          </div>}
          <Button onClick={() => void startRead()} disabled={!online || busy || !data.aiOn || files.length === 0 || drafts.length > 0}>{job?.status === "reading" || job?.status === "queued" ? <><LoaderCircle className="animate-spin motion-reduce:animate-none" size={17} />Reading receipt…</> : <><WandSparkles size={17} />Read receipt</>}</Button>
          {!data.aiOn && <p className="m-0 text-sm text-ink-3">Receipt reading is off on this server. Add items by hand.</p>}
          {!online && <p className="m-0 text-sm text-ink-3">Offline. Receipt files and saved items remain viewable; editing is disabled.</p>}
          {error && <p role="alert" className="m-0 text-sm text-over">{error}</p>}
          {job?.status === "failed" && <section className="space-y-2 rounded-card border border-hairline bg-card p-4"><h2 className="m-0 font-serif text-lg">{job.error === "not_receipt" ? "This doesn't look like a bill." : job.error === "ai_unavailable" ? "Receipt reading is unavailable right now." : "Couldn't read this photo."}</h2><p className="m-0 text-sm text-ink-2">{job.error === "not_receipt" ? "No prices or totals were found. Pick the order summary or invoice instead." : job.error === "ai_unavailable" ? "The daily limit is reached or the AI service is down. Your images are saved and you can read them later." : "It's too blurry or dark. Try a sharper photo, or a screenshot of the order page."} Images stay attached.</p><Button onClick={addItem}>Enter items by hand</Button><Button variant="outline" disabled={!online} onClick={() => void startRead()}><RotateCcw size={16} />{job.error === "ai_unavailable" ? "Try again later" : "Try another photo"}</Button></section>}
          {job && (job.status === "queued" || job.status === "reading") && <section aria-live="polite" className="space-y-3 rounded-card border border-hairline bg-card p-4"><div className="flex gap-2">{files.map((file, i) => <div key={file.id} className="flex flex-1 flex-col gap-1"><div className="flex h-20 items-center justify-center rounded-lg border border-hairline bg-input text-earn">{i < (job.status === "reading" ? 1 : 0) && <Check />}{i === (job.status === "reading" ? 1 : 0) && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}</div><span className="text-center text-xs text-ink-2">{i < 1 ? "Read" : i === 1 ? "Reading" : "Waiting"}</span></div>)}</div><p className="m-0 font-serif text-xl italic">Reading receipt…</p><p className="m-0 text-sm text-ink-2">Usually 5–15 seconds. You can leave; items will be waiting on this transaction.</p>{[1, 2, 3].map((n) => <div key={n} className="h-11 animate-pulse rounded-lg bg-sunken motion-reduce:animate-none" />)}</section>}
        </section>
        <section className="space-y-4">
          {data.items.length > 0 || items.length > 0 ? <>
            <div className="space-y-3 border-b-[3px] border-double border-ink pb-4">
              <span className="label-caps text-ink-3">Matched to transaction</span>
              <div className="flex items-baseline justify-between gap-3"><strong className="font-serif text-2xl font-medium">{data.txn.merchant}</strong><strong className="font-serif text-2xl font-medium">{money(data.txn.amount)}</strong></div>
              {grouped.length > 0 && <button type="button" aria-expanded={groupsOpen} onClick={() => setGroupsOpen(!groupsOpen)} className="w-full text-left">
                <span className="flex h-3 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={grouped.map((group) => `${group.category} ${money(group.amount)}`).join(", ")}>{grouped.map((group) => <span key={group.category} style={{ flex: group.amount, background: `var(--color-${data.categories.find((category) => category.name === group.category)?.colorToken ?? "cat-other"})` }} />)}</span>
                {groupsOpen && <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">{grouped.map((group) => <span key={group.category} className="flex items-center gap-1.5"><i aria-hidden className="size-2 rounded-sm" style={{ background: `var(--color-${data.categories.find((category) => category.name === group.category)?.colorToken ?? "cat-other"})` }} />{group.category} <strong>{money(group.amount)}</strong></span>)}</span>}
              </button>}
            </div>
            {low > 0 && <p className="m-0 rounded-card bg-watch-soft p-3 text-sm text-ink">{low} low-confidence line{low === 1 ? "" : "s"}. Check details before saving.</p>}
            {!data.aiOn && <p className="m-0 rounded-card bg-card p-3 text-sm text-ink-2">{money(Math.max(0, data.txn.amount - total))} not itemised · Stays in {fallbackCategory}</p>}
            <div className="flex items-center justify-between gap-3 rounded-card bg-watch-soft p-3 text-sm">
              <span className={agrees ? "flex items-center gap-1 text-earn" : "text-watch-text"}>{agrees ? <><Check size={16} />Totals match · {money(total)}</> : <>Items {money(total)} · bank {money(data.txn.amount)} · {money(Math.abs(data.txn.amount - total))} apart</>}</span>
              {!agrees && total < data.txn.amount && <Button className="shrink-0 text-sm" disabled={!online} onClick={adjustment}>Add as adjustment</Button>}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="label-caps m-0 text-ink-3">Items · {items.length} rows</h2><div className="flex gap-2">{selectedItems.length > 1 && <Button variant="outline" onClick={merge} disabled={!online}>Merge</Button>}{selected.length > 0 && <Button variant="outline" onClick={() => deleteItems(selected)} disabled={!online}>Delete</Button>}</div></div>
            <div className="space-y-2">{items.map((item, index) => <div key={item.key} onTouchStart={(event) => { (event.currentTarget as HTMLDivElement).dataset.touchX = String(event.touches[0]?.clientX ?? 0); }} onTouchEnd={(event) => { const start = Number((event.currentTarget as HTMLDivElement).dataset.touchX); if (online && start - event.changedTouches[0]!.clientX > 70) deleteItems([item.key]); }} className={`grid grid-cols-[28px_minmax(0,1fr)_80px] gap-2 rounded-card border p-2 ${item.confidence !== null && item.confidence < 0.7 ? "border-watch bg-watch-soft" : "border-hairline bg-card"}`}>
              <input type="checkbox" aria-label={`Select item ${index + 1}`} checked={selected.includes(item.key)} disabled={!online} onChange={(e) => setSelected((old) => e.currentTarget.checked ? [...old, item.key] : old.filter((key) => key !== item.key))} className="size-5 self-center accent-brand" />
              <div className="grid min-w-0 grid-cols-2 gap-2"><input aria-label={`Item ${index + 1} name`} className="field col-span-2 min-w-0" value={item.name} placeholder="Item name" disabled={!online} onChange={(e) => updateItem(index, { name: e.currentTarget.value, confidence: null })} /><input aria-label={`Item ${index + 1} quantity`} className="field min-w-0 text-sm" inputMode="decimal" value={item.qty ?? ""} placeholder="Qty" disabled={!online} onChange={(e) => updateItem(index, { qty: Number(e.currentTarget.value) || null })} /><select aria-label={`Item ${index + 1} category`} className="field min-w-0 px-2 text-sm" value={item.category} disabled={!online} onChange={(e) => updateItem(index, { category: e.currentTarget.value })}>{categories.map((category) => <option key={category}>{category}</option>)}</select></div>
              <div><input aria-label={`Item ${index + 1} amount`} className="field min-w-0 text-right" inputMode="decimal" value={item.amount || ""} placeholder="₹0" disabled={!online} onChange={(e) => updateItem(index, { amount: Number(e.currentTarget.value) || 0 })} />{item.confidence !== null && item.confidence < 0.7 && <button type="button" className="min-h-11 text-sm text-watch" disabled={!online} onClick={() => updateItem(index, { confidence: null })}>? Looks right</button>}</div>
            </div>)}</div>
            <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={addItem} disabled={!online}><Plus size={17} />Add a missed item</Button></div>
            <Button className="min-h-[52px] w-full" disabled={!online || busy || items.some((item) => !item.name.trim() || !Number.isFinite(item.amount) || item.amount <= 0) || (split && !agrees)} onClick={() => void save()}>{low ? "Save anyway" : split ? "Save split" : "Save items"}</Button>
            <label className="flex min-h-11 items-center justify-between gap-3 border-y border-hairline py-2"><span><strong className="block text-[15px]">Split by category</strong><span className="text-sm text-ink-3">Use item totals in spending views</span></span><input aria-label="Split by category" type="checkbox" checked={split} disabled={!online} onChange={(e) => setSplit(e.currentTarget.checked)} className="size-6 accent-brand" /></label>
          </> : <div className="space-y-3 rounded-card border border-hairline bg-card p-4"><h2 className="m-0 font-serif text-xl">Add items by hand</h2><p className="m-0 text-sm text-ink-2">{files.length ? "Read receipt to fill items, or enter them by hand." : "Add a receipt photo, or enter items by hand."}</p>{!data.aiOn && <p className="m-0 text-sm text-ink-3">Receipt reading is off on this server. Add items by hand.</p>}<Button variant="outline" onClick={addItem} disabled={!online}><Plus size={17} />Add item</Button></div>}
        </section>
      </div>
    </div>
  </main>;
}
