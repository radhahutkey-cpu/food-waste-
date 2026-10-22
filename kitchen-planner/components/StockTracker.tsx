"use client";

import { useMemo, useState } from "react";
import {
  Batch,
  StockRow,
  discardExpired,
  isExpired,
  receiveStock,
  sampleBatches,
  stockTotals,
  summarizeStock,
  takeStock,
} from "@/lib/inventory";
import { REASONS, Reason, WasteEntry } from "@/lib/waste";
import { stockToCsv } from "@/lib/export";
import { addDays, toIso } from "@/lib/forecast";
import { Card, Table, download, inputClass, primaryButton, r1, rupees } from "./ui";

type NewWaste = Omit<WasteEntry, "id">;
type Msg = { kind: "ok" | "error"; text: string } | null;

function expiryText(days: number): string {
  if (days < 0) return `expired ${-days} day${days === -1 ? "" : "s"} ago`;
  if (days === 0) return "expires today";
  return `in ${days} day${days === 1 ? "" : "s"}`;
}

const STATUS_STYLE = {
  expired: "bg-red-100 text-red-900",
  soon: "bg-amber-100 text-amber-900",
  ok: "bg-emerald-100 text-emerald-900",
} as const;
const STATUS_LABEL = { expired: "Expired", soon: "Use soon", ok: "OK" } as const;

export function StockTracker(props: {
  batches: Batch[];
  onBatches: (next: Batch[]) => void;
  onWaste: (entries: NewWaste[]) => void;
}) {
  const today = new Date();
  const { batches } = props;
  const rows = useMemo(() => summarizeStock(batches, new Date()), [batches]);
  const totals = stockTotals(rows);
  const names = rows.map((r) => r.ingredient);
  const [armed, setArmed] = useState<"clear" | "sample" | null>(null);

  function arm(which: "clear" | "sample", run: () => void) {
    if (armed === which) {
      setArmed(null);
      run();
    } else {
      setArmed(which);
      setTimeout(() => setArmed(null), 4000);
    }
  }

  function discard() {
    const r = discardExpired(batches, new Date());
    props.onBatches(r.batches);
    props.onWaste(
      r.discarded.map((d) => ({
        date: toIso(new Date()),
        ingredient: d.ingredient,
        qty: d.qty,
        reason: "Spoiled / expired" as Reason,
        costPerUnit: d.qty ? d.cost / d.qty : 0,
      }))
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Items tracked" value={String(totals.items)} />
        <Stat label="Use soon" value={String(totals.soon)} sub={`expire within 2 days`} tone={totals.soon ? "amber" : undefined} />
        <Stat label="Expired" value={String(totals.expired)} sub={totals.expired ? `${rupees(totals.expiredValue)} lost` : "none"} tone={totals.expired ? "red" : undefined} />
        <Stat label="Fresh stock value" value={rupees(totals.freshValue)} />
      </div>

      {totals.expired > 0 && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-900">
          <span>
            {totals.expired} item{totals.expired === 1 ? " has" : "s have"} expired ({rupees(totals.expiredValue)}). Take {totals.expired === 1 ? "it" : "them"} out of stock so your numbers stay true.
          </span>
          <button type="button" onClick={discard} className="rounded-md bg-red-700 px-3 py-1.5 font-semibold text-white hover:brightness-110">
            Discard expired and log as waste
          </button>
        </div>
      )}

      <Card
        title="What's in stock"
        action={
          <span className="flex flex-wrap gap-3 text-sm">
            {batches.length > 0 && (
              <button type="button" className="text-brand underline" onClick={() => download("stock.csv", stockToCsv(batches))}>
                Download (.csv)
              </button>
            )}
            <button type="button" className="text-brand underline" onClick={() => arm("sample", () => props.onBatches(sampleBatches()))}>
              {armed === "sample" ? "Click again to replace with sample" : "Load sample stock"}
            </button>
            {batches.length > 0 && (
              <button type="button" className="text-brand underline" onClick={() => arm("clear", () => props.onBatches([]))}>
                {armed === "clear" ? "Click again to delete all" : "Clear all"}
              </button>
            )}
          </span>
        }
      >
        {rows.length === 0 ? (
          <p className="text-sm text-zinc-600">No stock yet. Add your first delivery below under Stock in, or load sample stock to see how it works.</p>
        ) : (
          <>
            <Table
              head={[{ label: "Ingredient" }, { label: "Quantity", num: true }, { label: "Soonest expiry" }, { label: "Value", num: true }, { label: "Status" }]}
              rows={rows.map((r) => [
                r.ingredient,
                <QtyCell key="q" row={r} />,
                `${r.nearestExpiry} (${expiryText(r.daysToNearest)})`,
                rupees(r.freshValue),
                <span key="s" className={`rounded px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status]}`}>{STATUS_LABEL[r.status]}</span>,
              ])}
            />
            <details className="text-sm">
              <summary className="cursor-pointer text-brand">Show every delivery ({batches.length})</summary>
              <div className="mt-2">
                <Table
                  head={[{ label: "Ingredient" }, { label: "Quantity", num: true }, { label: "Expiry" }, { label: "Cost/unit", num: true }, { label: "Received" }, { label: "" }]}
                  rows={[...batches]
                    .sort((a, b) => a.expiry.localeCompare(b.expiry))
                    .map((b) => [
                      b.ingredient,
                      `${r1(b.qty)} ${b.unit}`,
                      `${b.expiry}${isExpired(b, today) ? " (expired)" : ""}`,
                      rupees(b.costPerUnit),
                      b.received,
                      <button key="x" type="button" className="text-brand underline" onClick={() => props.onBatches(batches.filter((x) => x.id !== b.id))}>
                        remove
                      </button>,
                    ])}
                />
                <p className="mt-1 text-xs text-zinc-600">&quot;remove&quot; fixes a mistaken entry. It does not add to the waste log.</p>
              </div>
            </details>
          </>
        )}
        <p className="text-xs text-zinc-600">Stock is saved in this browser on this device only. Download the .csv to keep a copy.</p>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <StockIn names={names} batches={batches} onBatches={props.onBatches} />
        <StockOut names={names} batches={batches} onBatches={props.onBatches} onWaste={props.onWaste} />
      </div>
    </div>
  );
}

function QtyCell({ row }: { row: StockRow }) {
  return (
    <span>
      {r1(row.freshQty)} {row.unit}
      {row.expiredQty > 0 && <span className="text-red-800"> (+{r1(row.expiredQty)} expired)</span>}
    </span>
  );
}

function Stat(props: { label: string; value: string; sub?: string; tone?: "red" | "amber" }) {
  const tone = props.tone === "red" ? "border-red-300 bg-red-50" : props.tone === "amber" ? "border-amber-300 bg-amber-50" : "border-zinc-300 bg-white";
  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-zinc-600">{props.label}</p>
      <p className="text-2xl font-bold tabular-nums">{props.value}</p>
      {props.sub && <p className="text-xs text-zinc-600">{props.sub}</p>}
    </div>
  );
}

function Feedback({ msg }: { msg: Msg }) {
  if (!msg) return null;
  return msg.kind === "error" ? (
    <p role="alert" className="rounded-md border-l-4 border-red-600 bg-red-50 p-2 text-sm text-red-900">{msg.text}</p>
  ) : (
    <p role="status" className="rounded-md border-l-4 border-emerald-600 bg-emerald-50 p-2 text-sm text-emerald-900">{msg.text}</p>
  );
}

function StockIn(props: { names: string[]; batches: Batch[]; onBatches: (next: Batch[]) => void }) {
  const [ingredient, setIngredient] = useState("");
  const [unit, setUnit] = useState("kg");
  const [qty, setQty] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cost, setCost] = useState("");
  const [msg, setMsg] = useState<Msg>(null);

  function pickIngredient(v: string) {
    setIngredient(v);
    const known = props.batches.find((b) => b.ingredient.toLowerCase() === v.trim().toLowerCase());
    if (known) setUnit(known.unit);
  }

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const r = receiveStock(props.batches, { ingredient, unit, qty: qty.trim() === "" ? NaN : Number(qty), expiry, costPerUnit: cost.trim() === "" ? NaN : Number(cost) }, new Date());
    if (!r.ok) return setMsg({ kind: "error", text: r.error });
    props.onBatches(r.data);
    setMsg({ kind: "ok", text: `Added ${qty} ${unit} of ${ingredient.trim()}.` });
    setQty("");
  }

  return (
    <Card title="Stock in (delivery)">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label className="flex flex-col text-sm">Ingredient
          <input list="stock-in-names" value={ingredient} onChange={(e) => pickIngredient(e.target.value)} placeholder="e.g. paneer" className={inputClass} />
          <datalist id="stock-in-names">{props.names.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col text-sm">Amount
            <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="5" className={`w-full ${inputClass}`} />
          </label>
          <label className="flex w-24 flex-col text-sm">Unit
            <input value={unit} onChange={(e) => setUnit(e.target.value)} className={`w-full ${inputClass}`} />
          </label>
          <label className="flex flex-1 flex-col text-sm">Cost per unit (₹)
            <input value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="380" className={`w-full ${inputClass}`} />
          </label>
        </div>
        <label className="flex flex-col text-sm">Expires on
          <input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={inputClass} />
        </label>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-600">Or expires in:</span>
          {[3, 7, 30].map((d) => (
            <button key={d} type="button" className="rounded border border-zinc-300 px-2 py-0.5 hover:bg-zinc-100" onClick={() => setExpiry(toIso(addDays(new Date(), d)))}>
              {d} days
            </button>
          ))}
        </div>
        <button className={`self-start ${primaryButton}`}>Add to stock</button>
        <Feedback msg={msg} />
      </form>
    </Card>
  );
}

function StockOut(props: {
  names: string[];
  batches: Batch[];
  onBatches: (next: Batch[]) => void;
  onWaste: (entries: NewWaste[]) => void;
}) {
  const [ingredient, setIngredient] = useState("");
  const [qty, setQty] = useState("");
  const [why, setWhy] = useState<"used" | "wasted">("used");
  const [reason, setReason] = useState<Reason>(REASONS[0]);
  const [msg, setMsg] = useState<Msg>(null);

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const n = qty.trim() === "" ? NaN : Number(qty);
    const r = takeStock(props.batches, ingredient, n, new Date());
    if (!r.ok) return setMsg({ kind: "error", text: r.error });
    props.onBatches(r.data.batches);
    if (why === "wasted") {
      props.onWaste([{ date: toIso(new Date()), ingredient: r.data.ingredient, qty: n, reason, costPerUnit: r.data.cost / n }]);
    }
    setMsg({
      kind: "ok",
      text: why === "wasted" ? `Removed ${n} ${r.data.unit} of ${r.data.ingredient} and logged ${rupees(r.data.cost)} as waste (${reason}).` : `Used ${n} ${r.data.unit} of ${r.data.ingredient}, worth ${rupees(r.data.cost)}.`,
    });
    setQty("");
  }

  return (
    <Card title="Stock out (used or wasted)">
      <form onSubmit={submit} className="flex flex-col gap-2">
        <label className="flex flex-col text-sm">Ingredient
          <input list="stock-out-names" value={ingredient} onChange={(e) => setIngredient(e.target.value)} placeholder="e.g. paneer" className={inputClass} />
          <datalist id="stock-out-names">{props.names.map((n) => <option key={n} value={n} />)}</datalist>
        </label>
        <label className="flex flex-col text-sm">Amount
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="1.5" className={inputClass} />
        </label>
        <fieldset className="flex flex-wrap gap-4 text-sm">
          <legend className="mb-1">What happened</legend>
          <label className="flex items-center gap-1"><input type="radio" name="why" checked={why === "used"} onChange={() => setWhy("used")} /> Used in cooking</label>
          <label className="flex items-center gap-1"><input type="radio" name="why" checked={why === "wasted"} onChange={() => setWhy("wasted")} /> Wasted</label>
        </fieldset>
        {why === "wasted" && (
          <label className="flex flex-col text-sm">Why was it wasted?
            <select value={reason} onChange={(e) => setReason(e.target.value as Reason)} className={inputClass}>
              {REASONS.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
        )}
        <p className="text-xs text-zinc-600">Oldest-expiry stock is used first. Expired stock is never used.</p>
        <button className={`self-start ${primaryButton}`}>Remove from stock</button>
        <Feedback msg={msg} />
      </form>
    </Card>
  );
}

