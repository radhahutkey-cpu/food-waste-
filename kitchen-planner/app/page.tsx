"use client";

import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import { parseRecipes, parseSales, parseStock, RECIPE_HELP, SALES_HELP, STOCK_HELP, StockItem } from "@/lib/input";
import { buildPlan, Plan } from "@/lib/plan";
import { SAMPLE_RECIPES, SAMPLE_STOCK, sampleSales } from "@/lib/sample";
import { REASONS, Reason, summarizeWaste, WasteEntry, entryCost } from "@/lib/waste";
import { planToCsv, wasteToCsv } from "@/lib/export";
import { toIso } from "@/lib/forecast";

type Errors = { sales: string[]; stock: string[]; recipes: string[] };
const NO_ERRORS: Errors = { sales: [], stock: [], recipes: [] };
type Note =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; note: string }
  | { status: "blocked"; reason: string }
  | { status: "unavailable"; message: string };

const MAX_FILE_BYTES = 1_000_000;
const r1 = (n: number) => Math.round(n * 10) / 10;
const rupees = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const noSubscribe = () => () => {};

// The sample data and the log date use today's date, so the planner is drawn only in the browser.
export default function Home() {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!inBrowser) return <p className="p-6 text-zinc-600">Loading...</p>;
  return <Planner />;
}

function Planner() {
  const [salesText, setSalesText] = useState(() => sampleSales());
  const [stockText, setStockText] = useState(SAMPLE_STOCK);
  const [recipeText, setRecipeText] = useState(SAMPLE_RECIPES);
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  const [fileError, setFileError] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [note, setNote] = useState<Note>({ status: "idle" });
  const [stockForLog, setStockForLog] = useState<StockItem[]>([]);
  const [waste, setWaste] = useState<WasteEntry[]>([]);
  const nextId = useRef(1);
  const runId = useRef(0);

  function loadSample() {
    setSalesText(sampleSales());
    setStockText(SAMPLE_STOCK);
    setRecipeText(SAMPLE_RECIPES);
    setErrors(NO_ERRORS);
    setFileError("");
  }

  async function onFile(file: File | undefined) {
    setFileError("");
    if (!file) return;
    if (file.size === 0) return setFileError("That file is empty. Upload a .csv with your sales, or paste the text instead.");
    if (file.size > MAX_FILE_BYTES) return setFileError("That file is too big (over 1 MB). Upload a smaller .csv, or paste the last 2 weeks.");
    if (!/\.(csv|txt)$/i.test(file.name)) return setFileError("I can only read .csv or .txt files. Save your sheet as CSV, or paste the text instead.");
    try {
      setSalesText(await file.text());
    } catch {
      setFileError("I couldn't read that file. Paste the text instead.");
    }
  }

  async function makePlan() {
    const myRun = ++runId.current;
    setNote({ status: "idle" });
    const s = parseSales(salesText);
    const st = parseStock(stockText);
    const r = parseRecipes(recipeText);
    const next: Errors = {
      sales: s.ok ? [] : s.errors,
      stock: st.ok ? [] : st.errors,
      recipes: r.ok ? [] : r.errors,
    };
    setErrors(next);
    if (!s.ok || !st.ok || !r.ok) {
      setPlan(null); // no plan when the input is bad
      return;
    }
    const p = buildPlan(s.data, r.data, st.data);
    setPlan(p);
    setStockForLog(st.data);

    // The plan is already on screen. The AI note arrives afterwards and can fail without affecting it.
    setNote({ status: "loading" });
    const facts = {
      planDate: p.planDate,
      daysOfSalesData: p.daysOfData,
      prep: p.prep.map((x) => ({ dish: x.dish, expectedSales: r1(x.expected), prepPortions: x.prep })),
      buy: p.buy.filter((b) => b.toBuy > 0).map((b) => ({ ingredient: b.ingredient, unit: b.unit, toBuy: r1(b.toBuy), costRupees: b.cost === null ? null : Math.round(b.cost) })),
      wasteRisks: p.risks.map((x) => ({ ingredient: x.ingredient, unit: x.unit, daysToExpiry: x.daysToExpiry, likelyUnused: r1(x.unused), valueAtRiskRupees: Math.round(x.value) })),
      totalBuyCostRupees: Math.round(p.totalBuyCost),
      totalValueAtRiskRupees: Math.round(p.totalRiskValue),
    };
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(facts),
        signal: AbortSignal.timeout(14_000),
      });
      const data = await res.json();
      if (myRun === runId.current) setNote(data as Note);
    } catch {
      if (myRun === runId.current) setNote({ status: "unavailable", message: "The note took too long or could not load." });
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">Kitchen Planner</h1>
        <p className="mt-1 max-w-prose text-zinc-600">
          Paste your last 2 weeks of sales and what is in stock. Get tomorrow&apos;s prep list, buy list and waste alerts.
          The sample below is a made-up North Indian menu. Replace it with yours.
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded-lg border border-zinc-300 bg-white p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold">1. Your data</h2>
          <button type="button" onClick={loadSample} className="text-sm text-brand underline">
            Load sample data
          </button>
        </div>

        <Field
          id="sales"
          label="Sales, last 2 weeks"
          help={SALES_HELP}
          value={salesText}
          onChange={setSalesText}
          errors={[...(fileError ? [fileError] : []), ...errors.sales]}
          rows={7}
          extra={
            <label className="text-sm text-brand underline cursor-pointer">
              Upload a .csv instead
              <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          }
        />
        <Field id="stock" label="Stock now" help={STOCK_HELP} value={stockText} onChange={setStockText} errors={errors.stock} rows={6} />
        <Field id="recipes" label="Recipes" help={RECIPE_HELP} value={recipeText} onChange={setRecipeText} errors={errors.recipes} rows={6} />

        <button
          type="button"
          onClick={makePlan}
          className="self-start rounded-md bg-brand px-5 py-2.5 font-semibold text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Make tomorrow&apos;s plan
        </button>
      </section>

      {plan && <Results plan={plan} note={note} />}

      <WasteLog
        entries={waste}
        stock={stockForLog}
        onAdd={(e) => setWaste((w) => [...w, { ...e, id: nextId.current++ }])}
        onRemove={(id) => setWaste((w) => w.filter((x) => x.id !== id))}
        onClear={() => setWaste([])}
      />

      <footer className="max-w-prose text-sm text-zinc-600">
        Forecasts use recent sales on the same weekday, with newer days counting more. They don&apos;t know about events,
        weather or offers. Nothing is saved when you close this page, so download what you want to keep.
      </footer>
    </main>
  );
}

function Field(props: {
  id: string;
  label: string;
  help: string;
  value: string;
  onChange: (v: string) => void;
  errors: string[];
  rows: number;
  extra?: React.ReactNode;
}) {
  const bad = props.errors.length > 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={props.id} className="font-semibold">
          {props.label}
        </label>
        {props.extra}
      </div>
      <p id={`${props.id}-help`} className="text-sm text-zinc-600">
        {props.help}
      </p>
      <textarea
        id={props.id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={props.rows}
        spellCheck={false}
        aria-describedby={`${props.id}-help`}
        aria-invalid={bad}
        className={`w-full resize-y rounded-md border bg-zinc-50 p-2 font-mono text-[13px] leading-5 ${bad ? "border-red-600" : "border-zinc-300"}`}
      />
      {bad && (
        <ul role="alert" className="rounded-md border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-900">
          {props.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Table(props: { head: { label: string; num?: boolean }[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm tabular-nums">
        <thead>
          <tr>
            {props.head.map((h) => (
              <th key={h.label} className={`border-b border-zinc-300 px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-600 ${h.num ? "text-right" : "text-left"}`}>
                {h.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={`whitespace-nowrap border-b border-zinc-200 px-2 py-1.5 ${props.head[j].num ? "text-right" : "text-left"}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card(props: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-300 bg-white p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold">{props.title}</h2>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

function Results({ plan, note }: { plan: Plan; note: Note }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-700" data-testid="read-summary">
        Plan for <b>{plan.planDate}</b>. I read {plan.daysOfData} days of sales, {plan.dishCount} dishes and {plan.ingredientCount} ingredients in stock. If that is not what you
        expected, check your data above.{" "}
        <button type="button" onClick={() => download(`plan-${plan.planDate}.csv`, planToCsv(plan))} className="text-brand underline">
          Download plan (.csv)
        </button>
      </p>

      {plan.warnings.length > 0 && (
        <ul className="rounded-md border-l-4 border-amber-600 bg-amber-50 p-3 text-sm text-amber-900">
          {plan.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}

      <Card title="What to prep">
        <Table
          head={[{ label: "Dish" }, { label: "Expected sales", num: true }, { label: "Prep portions", num: true }]}
          rows={plan.prep.map((p) => [p.dish, r1(p.expected), <b key="p">{p.prep}</b>])}
        />
      </Card>

      <Card title="What to buy">
        <Table
          head={[{ label: "Ingredient" }, { label: "Needed", num: true }, { label: "In stock", num: true }, { label: "Buy", num: true }, { label: "Est. cost", num: true }]}
          rows={plan.buy.map((b) => [
            b.ingredient + (b.inStockList ? "" : " (not in stock list)"),
            `${r1(b.need)} ${b.unit}`.trim(),
            `${r1(b.onHand)} ${b.unit}`.trim(),
            b.toBuy > 0 ? <b key="b">{`${r1(b.toBuy)} ${b.unit}`.trim()}</b> : "enough",
            b.cost === null ? "unknown" : b.toBuy > 0 ? rupees(b.cost) : "-",
          ])}
        />
        <p className="text-sm text-zinc-700">Estimated total to buy: <b>{rupees(plan.totalBuyCost)}</b></p>
      </Card>

      <Card title="Waste-risk alerts">
        {plan.risks.length === 0 ? (
          <p className="text-sm text-emerald-800">No ingredient looks likely to expire unused.</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {plan.risks.map((r) => (
                <li key={r.ingredient} className={`rounded-md border-l-4 p-3 text-sm ${r.level === "high" ? "border-red-600 bg-red-50 text-red-900" : "border-amber-600 bg-amber-50 text-amber-900"}`}>
                  <b>{r.ingredient}</b>: about {r1(r.unused)} {r.unit} (≈{rupees(r.value)}) will probably be unused before it expires in {r.daysToExpiry} day{r.daysToExpiry === 1 ? "" : "s"}.
                </li>
              ))}
            </ul>
            <p className="text-sm text-zinc-700">Total value at risk: <b>{rupees(plan.totalRiskValue)}</b></p>
          </>
        )}
      </Card>

      <NoteCard note={note} />
    </div>
  );
}

function NoteCard({ note }: { note: Note }) {
  if (note.status === "idle") return null;
  return (
    <section aria-live="polite" className="rounded-lg border border-dashed border-zinc-400 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-600">AI note</h2>
      {note.status === "loading" && <p className="mt-1 text-sm text-zinc-600">Writing a short note...</p>}
      {note.status === "ok" && (
        <>
          <p className="mt-1">{note.note}</p>
          <p className="mt-2 text-xs text-zinc-600">Written by AI from the numbers above. Check it against the tables. The tables are the plan.</p>
        </>
      )}
      {note.status === "blocked" && (
        <p className="mt-1 text-sm text-amber-900">AI note hidden: {note.reason}. The plan above is not affected.</p>
      )}
      {note.status === "unavailable" && (
        <p className="mt-1 text-sm text-zinc-700">Note unavailable. {note.message} The plan above is not affected.</p>
      )}
    </section>
  );
}

function WasteLog(props: {
  entries: WasteEntry[];
  stock: StockItem[];
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
      <p className="text-sm text-zinc-600">Write down food you throw away, and why. It shows where your money goes. Entries are kept only while this page is open.</p>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col text-sm">Date
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="rounded-md border border-zinc-300 bg-zinc-50 p-2" />
        </label>
        <label className="flex flex-col text-sm">Ingredient
          <input list="stock-names" value={ingredient} onChange={(e) => setIngredient(e.target.value)} placeholder="e.g. paneer" className="w-36 rounded-md border border-zinc-300 bg-zinc-50 p-2" />
          <datalist id="stock-names">{props.stock.map((s) => <option key={s.ingredient} value={s.ingredient} />)}</datalist>
        </label>
        <label className="flex flex-col text-sm">Amount
          <input value={qty} onChange={(e) => setQty(e.target.value)} inputMode="decimal" placeholder="1.5" className="w-20 rounded-md border border-zinc-300 bg-zinc-50 p-2" />
        </label>
        <label className="flex flex-col text-sm">Reason
          <select value={reason} onChange={(e) => setReason(e.target.value as Reason)} className="rounded-md border border-zinc-300 bg-zinc-50 p-2">
            {REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <button className="rounded-md bg-brand px-4 py-2 font-semibold text-white hover:brightness-110">Add</button>
      </form>
      {msg && <p role="alert" className="text-sm text-red-800">{msg}</p>}

      {props.entries.length === 0 ? (
        <p className="text-sm text-zinc-600">Nothing logged yet.</p>
      ) : (
        <>
          <p className="font-semibold">Total wasted: {rupees(summary.total)}</p>
          {summary.unknownCost > 0 && (
            <p className="text-sm text-amber-900">
              {summary.unknownCost} entr{summary.unknownCost === 1 ? "y has" : "ies have"} no rupee value because the ingredient isn&apos;t in your stock list (click Make tomorrow&apos;s plan after adding it).
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
