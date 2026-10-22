// Reads and writes this account's data in Supabase. Every call runs as the signed-in user,
// so the database rules (RLS) only ever return or change that account's own rows.

import { Batch } from "./inventory";
import { RecipeLine, SalesRow } from "./input";
import { Reason, WasteEntry } from "./waste";
import { diffBatches, diffWaste } from "./sync";
import { getSupabase } from "./supabase";

type DbError = { message: string } | null;

function fail(error: DbError, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

const PAGE = 1000; // the database returns at most 1000 rows per request, so read in pages
const CHUNK = 500;

async function fetchAll<T>(table: string, orderBy: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await getSupabase().from(table).select("*").order(orderBy).order("id").range(from, from + PAGE - 1);
    fail(error, `Could not load ${table}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return out;
  }
}

type BatchRow = { id: number; ingredient: string; unit: string; qty: number; expiry: string; cost_per_unit: number; received: string };
type WasteRow = { id: number; wasted_on: string; ingredient: string; qty: number; reason: Reason; cost_per_unit: number | null };
type RecipeRow = { dish: string; ingredient: string; amount: number };
type SalesRowDb = { sold_on: string; dish: string; qty: number };

export type AccountData = {
  batches: Batch[];
  waste: WasteEntry[];
  recipes: RecipeLine[];
  sales: SalesRow[];
};

export async function loadBatches(): Promise<Batch[]> {
  const rows = await fetchAll<BatchRow>("stock_batches", "expiry");
  return rows.map((r) => ({
    id: r.id,
    ingredient: r.ingredient,
    unit: r.unit,
    qty: Number(r.qty),
    expiry: r.expiry,
    costPerUnit: Number(r.cost_per_unit),
    received: r.received,
  }));
}

export async function loadWaste(): Promise<WasteEntry[]> {
  const rows = await fetchAll<WasteRow>("waste_entries", "wasted_on");
  return rows.map((r) => ({
    id: r.id,
    date: r.wasted_on,
    ingredient: r.ingredient,
    qty: Number(r.qty),
    reason: r.reason,
    ...(r.cost_per_unit === null ? {} : { costPerUnit: Number(r.cost_per_unit) }),
  }));
}

export async function loadAccountData(): Promise<AccountData> {
  const [batches, waste, recipeRows, salesRows] = await Promise.all([
    loadBatches(),
    loadWaste(),
    fetchAll<RecipeRow>("recipe_lines", "dish"),
    fetchAll<SalesRowDb>("sales_rows", "sold_on"),
  ]);
  return {
    batches,
    waste,
    recipes: recipeRows.map((r) => ({ dish: r.dish, ingredient: r.ingredient, amount: Number(r.amount) })),
    sales: salesRows.map((r) => ({ date: r.sold_on, dish: r.dish, qty: Number(r.qty) })),
  };
}

// Sends only what changed, then returns the fresh list from the database.
export async function persistBatches(prev: Batch[], next: Batch[]): Promise<Batch[]> {
  const db = getSupabase();
  const diff = diffBatches(prev, next);
  if (diff.deleteIds.length) fail((await db.from("stock_batches").delete().in("id", diff.deleteIds)).error, "Could not remove stock");
  for (const u of diff.updates) fail((await db.from("stock_batches").update({ qty: u.qty }).eq("id", u.id)).error, "Could not update stock");
  if (diff.inserts.length) {
    const rows = diff.inserts.map((b) => ({
      ingredient: b.ingredient,
      unit: b.unit,
      qty: b.qty,
      expiry: b.expiry,
      cost_per_unit: b.costPerUnit,
      received: b.received,
    }));
    fail((await db.from("stock_batches").insert(rows)).error, "Could not add stock");
  }
  return loadBatches();
}

export async function persistWaste(prev: WasteEntry[], next: WasteEntry[]): Promise<WasteEntry[]> {
  const db = getSupabase();
  const diff = diffWaste(prev, next);
  if (diff.deleteIds.length) fail((await db.from("waste_entries").delete().in("id", diff.deleteIds)).error, "Could not remove waste entries");
  if (diff.inserts.length) {
    const rows = diff.inserts.map((e) => ({
      wasted_on: e.date,
      ingredient: e.ingredient,
      qty: e.qty,
      reason: e.reason,
      cost_per_unit: e.costPerUnit ?? null,
    }));
    fail((await db.from("waste_entries").insert(rows)).error, "Could not save waste entries");
  }
  return loadWaste();
}

// Recipes and sales are whole lists typed or pasted by the owner, so saving replaces the old list.
async function replaceAll(table: string, rows: object[]): Promise<void> {
  const db = getSupabase();
  fail((await db.from(table).delete().not("id", "is", null)).error, `Could not clear old ${table}`);
  for (let i = 0; i < rows.length; i += CHUNK) {
    fail((await db.from(table).insert(rows.slice(i, i + CHUNK))).error, `Could not save ${table}`);
  }
}

export function saveRecipes(lines: RecipeLine[]): Promise<void> {
  return replaceAll("recipe_lines", lines.map((l) => ({ dish: l.dish, ingredient: l.ingredient, amount: l.amount })));
}

export function saveSales(rows: SalesRow[]): Promise<void> {
  return replaceAll("sales_rows", rows.map((r) => ({ sold_on: r.date, dish: r.dish, qty: r.qty })));
}
