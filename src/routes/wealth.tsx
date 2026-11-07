import { useState } from "react";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { DeskPage } from "../components/app-shell";
import { GainChart } from "../components/gain-chart";
import { InkHero, HeroAmount } from "../components/ink-hero";
import { saveFailed, Sheet, snack } from "../components/sheet";
import { useOnline } from "../components/sync-pill";
import { Button, ButtonLink, Empty, PageHeader } from "../components/ui";
import { holdingCsvRows } from "../lib/csv";
import { money, navsOf, signed, statementOf } from "../lib/format";
import { SipList } from "../components/sip-list";
import { realDay } from "../server/wealth/xirr";
import { getWealth, importHoldingCsv } from "../server/wealth/fns";
import { importCas } from "../server/wealth/cas";
import { errorText } from "../lib/error-text";

export const Route = createFileRoute("/wealth")({
  loader: () => getWealth(),
  component: Wealth,
});
function parseCsv(csv: string, names: Set<string>) {
  return holdingCsvRows(csv).map(([date = "", fund = "", amount = "", units = "", nav = ""]) => {
    return {
      date,
      fund,
      amount,
      units,
      nav,
      ok:
        realDay(date) &&
        date <= new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()) &&
        [amount, units, nav].every((value) => Number.isFinite(Number(value))) &&
        names.has(fund.toLowerCase()) &&
        Number(nav) > 0 &&
        Number(amount) !== 0 &&
        Math.sign(Number(amount)) === Math.sign(Number(units)),
    };
  });
}
function ImportSheet({ names, onClose }: { names: Set<string>; onClose: () => void }) {
  const router = useRouter();
  const online = useOnline();
  const [csv, setCsv] = useState("");
  const [pending, setPending] = useState(false);
  const rows = parseCsv(csv, names);
  const bad = rows.filter((row) => !row.ok).length;
  const good = rows.length - bad;
  const run = async () => {
    setPending(true);
    try {
      const result = await importHoldingCsv({ data: { csv } });
      snack(`Imported ${result.imported} · ${result.errors} errors${result.skipped ? ` · ${result.skipped} already there` : ""}`);
      void router.invalidate();
      onClose();
    } catch {
      saveFailed(() => void run());
    } finally {
      setPending(false);
    }
  };
  return (
    <Sheet
      title="Import CSV"
      description="Columns: date, fund, amount, units, nav. Fund must match a holding name. Use negative amount and units for a redemption."
      onClose={onClose}
    >
      <input
        type="file"
        accept=".csv,text/csv,text/plain"
        aria-label="CSV file"
        className="text-control"
        onChange={(event) => {
          void event.target.files?.[0]?.text().then(setCsv);
        }}
      />
      <textarea
        aria-label="CSV text"
        className="field min-h-28 font-mono text-meta"
        placeholder="2026-01-05,Fund name,5000,12.34,405.1"
        value={csv}
        onChange={(event) => setCsv(event.target.value)}
      />
      {rows.length ? (
        <>
          <p className="m-0 text-control text-ink-2">
            {good} ready · {bad} errors
          </p>
          <div className="max-h-40 overflow-y-auto rounded-panel border border-hairline">
            {rows.slice(0, 50).map((row) => (
              <div
                key={`${row.date}-${row.fund}-${row.amount}-${row.units}-${row.nav}`}
                className={`flex min-h-9 items-center justify-between gap-2 border-b border-hairline px-3 text-meta ${row.ok ? "" : "text-over"}`}
              >
                <span className="truncate">
                  {row.date} · {row.fund}
                </span>
                <span className="shrink-0">{row.ok ? `${row.amount} · ${row.units} u` : "Error"}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
      <Button disabled={!online || pending || !good || csv.length > 1_000_000} onClick={() => void run()}>
        Import
      </Button>
    </Sheet>
  );
}
function CasSheet({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const online = useOnline();
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const run = async () => {
    if (!file) return;
    setPending(true);
    setError(null);
    setSkipped([]);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
      const result = await importCas({ data: { base64: btoa(binary), password } });
      setPassword("");
      void router.invalidate();
      snack(`CAS: ${result.imported.length} funds live${result.skipped.length ? ` · ${result.skipped.length} skipped` : ""}`);
      if (result.skipped.length) setSkipped(result.skipped);
      else onClose();
    } catch (e) {
      setError(errorText(e, "Couldn't import CAS."));
    } finally {
      setPending(false);
    }
  };
  return (
    <Sheet
      title="Import CAS"
      description="CAMS or KFintech Detailed CAS PDF, from inception. Gives exact units, so funds switch from statement value to live NAV. The file and password are not kept."
      onClose={onClose}
    >
      <input
        type="file"
        accept="application/pdf,.pdf"
        aria-label="CAS PDF"
        aria-describedby={error ? "cas-error" : undefined}
        className="text-control"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <input
        type="password"
        autoComplete="off"
        aria-label="PDF password"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "cas-error" : undefined}
        placeholder="PDF password (usually PAN)"
        className="field"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      {error && (
        <p id="cas-error" role="alert" className="m-0 text-control text-over">
          {error}
        </p>
      )}
      {skipped.length ? (
        <div className="rounded-panel border border-hairline">
          {skipped.map((row) => (
            <p key={row.name} className="m-0 border-b border-hairline px-3 py-2 text-meta">
              <b>{row.name}</b>
              <br />
              <span className="text-ink-2">{row.reason}</span>
            </p>
          ))}
        </div>
      ) : null}
      <Button disabled={!online || pending || !file || file.size > 10 * 1024 * 1024} onClick={() => void run()}>
        {pending ? "Reading…" : "Import"}
      </Button>
    </Sheet>
  );
}
function Wealth() {
  const data = Route.useLoaderData();
  const [importing, setImporting] = useState(false);
  const [cas, setCas] = useState(false);
  const rail = (
    <>
      {/* Phone: the Holdings header carries these actions. */}
      <div className="hidden flex-col gap-5 desk:flex">
        <ButtonLink to="/wealth/new">Add holding</ButtonLink>
        <Button variant="outline" onClick={() => setCas(true)}>
          Import CAS
        </Button>
        <Button variant="outline" onClick={() => setImporting(true)}>
          Import CSV
        </Button>
      </div>
      <section hidden={!data.allocation.length} className="rounded-panel border border-hairline bg-card p-4">
        <b>Allocation vs target</b>
        {data.allocation.map((row) => (
          <div key={row.name} className="mt-3">
            <span className="flex justify-between gap-2 text-control">
              <span className="min-w-0 truncate">{row.name}</span>
              <span className="shrink-0">
                {data.value ? Math.round((row.value / data.value) * 100) : 0}% / {row.hasTarget ? `${row.target}%` : "Target not set"}
              </span>
            </span>
            <div className="mt-1 h-1.5 rounded-control bg-sunken">
              <span
                className="block h-full rounded-control bg-brand"
                style={{ width: `${data.value ? (row.value / data.value) * 100 : 0}%` }}
              />
            </div>
          </div>
        ))}
      </section>
      <section className="rounded-panel border border-hairline bg-card p-4">
        <b>
          NPS 80CCD(1B) · FY {data.financialYear}–{String(data.financialYear + 1).slice(2)}
        </b>
        <p className="mb-0 text-control text-ink-2">{money(data.nps)} of ₹50,000</p>
      </section>
    </>
  );
  return (
    <DeskPage rail={rail}>
      <PageHeader title="Wealth" />
      <InkHero className="mt-2 desk:mt-0">
        <span className="label-muted text-on-ink-2">Portfolio value</span>
        <HeroAmount value={money(data.value)} size="lg" />
        <span className="label-muted text-on-ink-2">Gain</span>
        <span className={data.gain >= 0 ? "text-on-ink-gain" : "text-on-ink-over"}>
          {data.gain >= 0 ? "+" : "−"}
          {money(Math.abs(data.gain))}
          {data.invested ? ` · ${data.gain >= 0 ? "+" : "−"}${Math.abs((data.gain / data.invested) * 100).toFixed(1)}%` : ""} ·{" "}
          {data.navDate ? navsOf(data.navDate) : data.asOf ? `${statementOf(data.asOf)} · not live` : "No NAV yet"}
        </span>
        {data.navDate && <small className="text-on-ink-2">{signed(data.dayChange)} since previous NAV</small>}
        <GainChart values={data.spark} invested={data.invested} />
        {data.spark.length > 1 && <small className="text-on-ink-2">Net contributions by transaction · final point is current value</small>}
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-control">
          <span>Invested {money(data.invested)}</span>
          <span>XIRR {data.xirr == null ? "—" : `${(data.xirr * 100).toFixed(1)}%`}</span>
        </div>
      </InkHero>
      <section className="mx-5 mt-6 desk:mx-0">
        <div className="flex items-baseline justify-between border-b border-ink pb-2">
          <h2 className="m-0 font-serif text-section">Holdings</h2>
          <span className="flex gap-4 text-control font-medium text-brand">
            <button type="button" className="min-h-11 desk:hidden" onClick={() => setCas(true)}>
              Import CAS
            </button>
            <button type="button" className="min-h-11 desk:hidden" onClick={() => setImporting(true)}>
              Import CSV
            </button>
            <Link to="/wealth/new" className="grid min-h-11 content-center">
              Add holding
            </Link>
          </span>
        </div>
        {data.rows.length ? (
          data.rows.map((row) => (
            <Link
              key={row.id}
              to="/wealth/$id"
              params={{ id: String(row.id) }}
              className="flex min-h-14 items-center justify-between gap-2 border-b border-hairline"
            >
              <span className="min-w-0 flex-1">
                <b className="block truncate text-body">{row.name}</b>
                <small className="block truncate text-ink-2">
                  {row.assetClass}
                  {row.price
                    ? ` · ${navsOf(row.price.date)}`
                    : row.manualValueDate
                      ? ` · ${statementOf(row.manualValueDate)}`
                      : " · Manual"}
                </small>
              </span>
              <span className="shrink-0 text-right">
                <b>{money(row.value)}</b>
                <small className={row.gain >= 0 ? "block text-earn" : "block text-over"}>
                  {row.gain >= 0 ? "+" : "−"}
                  {money(Math.abs(row.gain))}
                </small>
              </span>
            </Link>
          ))
        ) : (
          <Empty text="No holdings yet. Add one, or import a CAS or CSV statement." />
        )}
      </section>
      <SipList sips={data.sips} />
      {importing ? (
        <ImportSheet names={new Set(data.rows.map((row) => row.name.toLowerCase()))} onClose={() => setImporting(false)} />
      ) : null}
      {cas ? <CasSheet onClose={() => setCas(false)} /> : null}
    </DeskPage>
  );
}
