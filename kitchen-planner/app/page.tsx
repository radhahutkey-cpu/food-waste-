"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { parseRecipes, parseSales, parseStock, recipesToText, salesToText, RECIPE_HELP, SALES_HELP, STOCK_HELP, StockItem } from "@/lib/input";
import { buildPlan, Plan } from "@/lib/plan";
import { SAMPLE_RECIPES, SAMPLE_STOCK, sampleSales } from "@/lib/sample";
import { WasteEntry } from "@/lib/waste";
import { Batch, stockItemsToText, summarizeStock, toPlannerStock } from "@/lib/inventory";
import { planToCsv } from "@/lib/export";
import { loadAccountData, loadBatches, loadWaste, persistBatches, persistWaste, saveRecipes, saveSales } from "@/lib/db";
import { Card, Table, download, r1, rupees } from "@/components/ui";
import { AuthGate } from "@/components/AuthGate";
import { DemandChart } from "@/components/DemandChart";
import { StockTracker } from "@/components/StockTracker";
import { WasteLog } from "@/components/WasteLog";

type Errors = { sales: string[]; stock: string[]; recipes: string[] };
const NO_ERRORS: Errors = { sales: [], stock: [], recipes: [] };
type Note =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; note: string }
  | { status: "blocked"; reason: string }
  | { status: "unavailable"; message: string };
type Tab = "stock" | "plan" | "waste";

const MAX_FILE_BYTES = 1_000_000;
const noSubscribe = () => () => {};

// Drawn only in the browser: sign-in state and today's date only exist there.
export default function Home() {
  const inBrowser = useSyncExternalStore(noSubscribe, () => true, () => false);
  if (!inBrowser) return <p className="p-6 text-zinc-600">Loading...</p>;
  return <AuthGate>{(user) => <Planner email={user.email} onSignOut={user.signOut} />}</AuthGate>;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : "Something went wrong.";
}

function Planner({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("stock");
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [retry, setRetry] = useState(0);
  const [dbError, setDbError] = useState("");

  const [batches, setBatches] = useState<Batch[]>([]);
  const [waste, setWaste] = useState<WasteEntry[]>([]);
  const savingBatches = useRef(false);
  const savingWaste = useRef(false);

  const [salesText, setSalesText] = useState("");
  const [stockText, setStockText] = useState("");
  const [recipeText, setRecipeText] = useState("");
  const savedText = useRef({ sales: "", recipes: "" }); // what is already in the database
  const [stockInfo, setStockInfo] = useState("");
  const [errors, setErrors] = useState<Errors>(NO_ERRORS);
  const [fileError, setFileError] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [saveNote, setSaveNote] = useState("");
  const [note, setNote] = useState<Note>({ status: "idle" });
  const runId = useRef(0);

  // Load this account's saved data. A new account starts empty.
  useEffect(() => {
    let alive = true;
    loadAccountData()
      .then((d) => {
        if (!alive) return;
        setBatches(d.batches);
        setWaste(d.waste);
        const sales = salesToText(d.sales);
        const recipes = recipesToText(d.recipes);
        savedText.current = { sales, recipes };
        setSalesText(sales);
        setRecipeText(recipes);
        setStockText(stockItemsToText(toPlannerStock(d.batches, new Date())));
        setLoadError("");
        setLoaded(true);
      })
      .catch((e) => alive && setLoadError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [retry]);

  // Saving: show the change at once, send it to the database, then reload so rows get their real ids.
  async function updateBatches(next: Batch[]) {
    if (savingBatches.current) return setDbError("Still saving your last change. Wait a second and try again.");
    savingBatches.current = true;
    const prev = batches;
    setBatches(next);
    try {
      setBatches(await persistBatches(prev, next));
      setDbError("");
    } catch (e) {
      setDbError(`${errorText(e)} Your change was not saved.`);
      try {
        setBatches(await loadBatches());
      } catch {}
    } finally {
      savingBatches.current = false;
    }
  }
  async function updateWaste(next: WasteEntry[]) {
    if (savingWaste.current) return setDbError("Still saving your last change. Wait a second and try again.");
    savingWaste.current = true;
    const prev = waste;
    setWaste(next);
    try {
      setWaste(await persistWaste(prev, next));
      setDbError("");
    } catch (e) {
      setDbError(`${errorText(e)} Your change was not saved.`);
      try {
        setWaste(await loadWaste());
      } catch {}
    } finally {
      savingWaste.current = false;
    }
  }
  function addWaste(entries: Omit<WasteEntry, "id">[]) {
    if (!entries.length) return;
    let id = waste.reduce((m, e) => Math.max(m, e.id), 0);
    void updateWaste([...waste, ...entries.map((e) => ({ ...e, id: ++id }))]);
  }

  // Prices for the waste log: tracked stock first, then whatever is in the planner's stock box.
  const priceList: StockItem[] = useMemo(() => {
    const tracked = summarizeStock(batches, new Date()).map((r) => ({
      ingredient: r.ingredient,
      unit: r.unit,
      onHand: r.freshQty,
      daysToExpiry: r.daysToNearest,
      costPerUnit: r.avgCost,
    }));
    const parsed = parseStock(stockText);
    const extra = parsed.ok ? parsed.data.filter((s) => !tracked.some((t) => t.ingredient.toLowerCase() === s.ingredient.toLowerCase())) : [];
    return [...tracked, ...extra];
  }, [batches, stockText]);

  function loadSample() {
    setSalesText(sampleSales());
    setStockText(SAMPLE_STOCK);
    setRecipeText(SAMPLE_RECIPES);
    setErrors(NO_ERRORS);
    setFileError("");
    setStockInfo("");
  }

  function useTrackedStock() {
    const items = toPlannerStock(batches, new Date());
    if (!items.length) {
      setStockInfo("You have no unexpired stock tracked yet. Add deliveries on the Stock tab first.");
      return;
    }
    setStockText(stockItemsToText(items));
    setStockInfo(`Filled in ${items.length} ingredient${items.length === 1 ? "" : "s"} from your tracked stock. Expired stock is left out, and each ingredient uses its soonest expiry date.`);
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
    setSaveNote("");
    const s = parseSales(salesText);
    const st = parseStock(stockText);
    const r = parseRecipes(recipeText);
    setErrors({
      sales: s.ok ? [] : s.errors,
      stock: st.ok ? [] : st.errors,
      recipes: r.ok ? [] : r.errors,
    });
    if (!s.ok || !st.ok || !r.ok) {
      setPlan(null); // no plan when the input is bad
      return;
    }
    const p = buildPlan(s.data, r.data, st.data);
    setPlan(p);

    // Keep this account's sales and recipes for next time (only what changed).
    const toSave: Promise<void>[] = [];
    if (salesText !== savedText.current.sales) toSave.push(saveSales(s.data).then(() => void (savedText.current.sales = salesText)));
    if (recipeText !== savedText.current.recipes) toSave.push(saveRecipes(r.data).then(() => void (savedText.current.recipes = recipeText)));
    if (toSave.length) {
      Promise.all(toSave)
        .then(() => setSaveNote("Your sales and recipes are saved to your account."))
        .catch((e) => setDbError(`${errorText(e)} Your sales or recipes were not saved, but the plan below is still correct.`));
    }

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

  const header = (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Kitchen Planner</h1>
        <p className="mt-1 max-w-prose text-zinc-600">Track what is in your kitchen and when it expires, see where food is wasted, and plan tomorrow&apos;s prep and purchases.</p>
      </div>
      <div className="text-right text-sm">
        <p className="text-zinc-600">{email}</p>
        <button type="button" onClick={onSignOut} className="text-brand underline">
          Log out
        </button>
      </div>
    </header>
  );

  if (!loaded) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        {header}
        {loadError ? (
          <div role="alert" className="rounded-md border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-900">
            <p>Could not load your data. {loadError}</p>
            <button type="button" className="mt-2 font-semibold underline" onClick={() => { setLoadError(""); setRetry((n) => n + 1); }}>
              Try again
            </button>
          </div>
        ) : (
          <p className="text-zinc-600">Loading your kitchen...</p>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
      {header}

      <nav role="tablist" aria-label="Sections" className="flex gap-1 border-b border-zinc-300">
        {([["stock", "Stock"], ["plan", "Plan tomorrow"], ["waste", `Waste log${waste.length ? ` (${waste.length})` : ""}`]] as [Tab, string][]).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            type="button"
            onClick={() => setTab(id)}
            className={`-mb-px rounded-t-md border border-b-0 px-4 py-2 text-sm font-semibold ${tab === id ? "border-zinc-300 bg-white text-brand" : "border-transparent text-zinc-600 hover:text-foreground"}`}
          >
            {label}
          </button>
        ))}
      </nav>

      {dbError && (
        <p role="alert" className="flex items-start justify-between gap-3 rounded-md border-l-4 border-red-600 bg-red-50 p-3 text-sm text-red-900">
          <span>{dbError}</span>
          <button type="button" className="underline" onClick={() => setDbError("")}>Dismiss</button>
        </p>
      )}

      {tab === "stock" && <StockTracker batches={batches} onBatches={(n) => void updateBatches(n)} onWaste={addWaste} />}

      {tab === "plan" && (
        <>
          <section className="flex flex-col gap-4 rounded-lg border border-zinc-300 bg-white p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold">Your data</h2>
              <button type="button" onClick={loadSample} className="text-sm text-brand underline">
                Fill in sample data to try it
              </button>
            </div>
            {!salesText && !recipeText && (
              <p className="rounded-md bg-zinc-100 p-3 text-sm text-zinc-700">
                New here? Paste your last 2 weeks of sales and your recipes below. Your stock fills in from the Stock tab. Or fill in sample data to see how it works.
              </p>
            )}

            <Field
              id="sales"
              label="Sales, last 2 weeks"
              help={SALES_HELP}
              value={salesText}
              onChange={setSalesText}
              errors={[...(fileError ? [fileError] : []), ...errors.sales]}
              rows={7}
              extra={
                <label className="cursor-pointer text-sm text-brand underline">
                  Upload a .csv instead
                  <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
                </label>
              }
            />
            <Field
              id="stock"
              label="Stock now"
              help={STOCK_HELP}
              value={stockText}
              onChange={(v) => { setStockText(v); setStockInfo(""); }}
              errors={errors.stock}
              info={stockInfo}
              rows={6}
              extra={
                <button type="button" onClick={useTrackedStock} className="text-sm text-brand underline">
                  Use my tracked stock
                </button>
              }
            />
            <Field id="recipes" label="Recipes" help={RECIPE_HELP} value={recipeText} onChange={setRecipeText} errors={errors.recipes} rows={6} />

            <button
              type="button"
              onClick={makePlan}
              className="self-start rounded-md bg-brand px-5 py-2.5 font-semibold text-white hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              Make tomorrow&apos;s plan
            </button>
          </section>

          {plan && <Results plan={plan} note={note} saveNote={saveNote} />}
        </>
      )}

      {tab === "waste" && (
        <WasteLog
          entries={waste}
          stock={priceList}
          onAdd={(e) => addWaste([e])}
          onRemove={(id) => void updateWaste(waste.filter((x) => x.id !== id))}
          onClear={() => void updateWaste([])}
        />
      )}

      <footer className="max-w-prose text-sm text-zinc-600">
        Forecasts use recent sales on the same weekday, with newer days counting more. They don&apos;t know about events, weather or offers. Your data is saved to your account and is private to it.
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
  info?: string;
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
      {props.info && <p role="status" className="text-sm text-emerald-900">{props.info}</p>}
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

function Results({ plan, note, saveNote }: { plan: Plan; note: Note; saveNote: string }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-700" data-testid="read-summary">
        Plan for <b>{plan.planDate}</b>. I read {plan.daysOfData} days of sales, {plan.dishCount} dishes and {plan.ingredientCount} ingredients in stock. If that is not what you
        expected, check your data above.{" "}
        <button type="button" onClick={() => download(`plan-${plan.planDate}.csv`, planToCsv(plan))} className="text-brand underline">
          Download plan (.csv)
        </button>
        {saveNote && <span className="block text-emerald-900">{saveNote}</span>}
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

      <DemandChart plan={plan} />

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
