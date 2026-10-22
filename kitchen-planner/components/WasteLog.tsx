"use client";

import { useMemo, useState } from "react";
import { StockItem } from "@/lib/input";
import { REASONS, Reason, summarizeWaste, WasteEntry, entryCost } from "@/lib/waste";
import { wasteToCsv } from "@/lib/export";
import { toIso } from "@/lib/forecast";
import { Card, Table, download, inputClass, primaryButton, rupees } from "./ui";

export function WasteLog(props: {
  entries: WasteEntry[];
  stock: StockItem[]; // used to price entries that don't carry their own cost
  onAdd: (e: Omit<WasteEntry, "id">) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
}) {
  const [date, setDate] = useState(() => toIso(new Date()));
  const [ingredient, setIngredient] = useState("");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<Reason>(REASONS[0]);
  const [msg, setMsg] = useState("");
  const [armed, setArmed] = useState(false);
  const summary = useMemo(() => summarizeWaste(props.entries, props.stock), [props.entries, props.stock]);
  const max = Math.max(1, ...summary.byReason.map((b) => b.cost));

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const n = Number(qty);
    if (!ingredient.trim()) return setMsg("Write which ingredient was thrown away.");
    if (!qty.trim() || !Number.isFinite(n) || n <= 0) return setMsg("Write the amount as a number more than zero, like 1.5.");
    setMsg("");
    props.onAdd({ date, ingredient: ingredient.trim(), qty: n, reason });
    setQty("");
  }

  return (
    <Card
      title="Waste log"
      action={
        props.entries.length > 0 && (
          <span className="flex gap-3 text-sm">
            <button type="button" className="text-brand underline" onClick={() => download("waste-log.csv", wasteToCsv(props.entries, props.stock))}>
              Download (.csv)
            </button>
            <button
              type="button"
              className="text-brand underline"
              onClick={() => {
                if (armed) {
                  props.onClear();
                  setArmed(false);
                } else {
                  setArmed(true);
                  setTimeout(() => setArmed(false), 4000);
                }
              }}
            >
              {armed ? "Click again to delete all" : "Clear log"}
            </button>
          </span>
        )
      }
    >
      <p className="text-sm text-zinc-600">
        Write down food you throw away, and why. It shows where your money goes. Entries are saved in this browser. Waste marked in Stock out, and expired stock you discard, are added here for you. Adding a line here does not
        change your stock.
      </p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-sm">Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className={inputClass} />
        </label>
        <label className="flex flex-col text-sm">Ingredient
          <input list="waste-names" value={ingredient} onChange={(e) => setIngredient(e.target.value)} placeholder="e.g. paneer" className={`w-36 ${inputClass}`} />
          <datalist id="waste-names">{props.stock.map((s) => <option key={s.ingredient} value={s.ingredient} />)}</datalist>
        </label>
        <label className="flex flex-col text-sm">Amount
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="1.5" className={`w-20 ${inputClass}`} />
        </label>
        <label className="flex flex-col text-sm">Reason
          <select value={reason} onChange={(e) => setReason(e.target.value as Reason)} className={inputClass}>
            {REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <button className={primaryButton}>Add</button>
      </form>
      {msg && <p role="alert" className="text-sm text-red-800">{msg}</p>}

      {props.entries.length === 0 ? (
        <p className="text-sm text-zinc-600">Nothing logged yet.</p>
      ) : (
        <>
          <p className="font-semibold">Total wasted: {rupees(summary.total)}</p>
          {summary.unknownCost > 0 && (
            <p className="text-sm text-amber-900">
              {summary.unknownCost} entr{summary.unknownCost === 1 ? "y has" : "ies have"} no rupee value because the ingredient isn&apos;t in your stock. Add it under Stock in.
            </p>
          )}
          <Table
            head={[{ label: "Reason" }, { label: "Entries", num: true }, { label: "" }, { label: "Cost", num: true }]}
            rows={summary.byReason.map((b) => [
              b.reason,
              b.entries,
              <span key="bar" className="inline-block h-2.5 rounded bg-brand align-middle" style={{ width: `${Math.max(4, (b.cost / max) * 140)}px` }} />,
              rupees(b.cost),
            ])}
          />
          <Table
            head={[{ label: "Date" }, { label: "Ingredient" }, { label: "Amount", num: true }, { label: "Reason" }, { label: "Cost", num: true }, { label: "" }]}
            rows={[...props.entries].reverse().map((e) => {
              const c = entryCost(e, props.stock);
              return [
                e.date,
                e.ingredient,
                e.qty,
                e.reason,
                c === null ? "unknown" : rupees(c),
                <button key="x" type="button" className="text-brand underline" onClick={() => props.onRemove(e.id)}>remove</button>,
              ];
            })}
          />
        </>
      )}
    </Card>
  );
}
