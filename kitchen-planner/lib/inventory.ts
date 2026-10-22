// Stock tracking: what is in the kitchen, how much, and when it expires.
// Stock is kept as batches (one per delivery), so each delivery has its own expiry date and cost.
// Plain code, no AI. All functions return new data and never change what you pass in.

import { StockItem, normalizeName, parseDate } from "./input";
import { addDays, toIso } from "./forecast";

export type Batch = {
  id: number;
  ingredient: string;
  unit: string;
  qty: number;
  expiry: string; // YYYY-MM-DD
  costPerUnit: number;
  received: string; // YYYY-MM-DD
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export const SOON_DAYS = 2; // "use soon" when it expires within this many days

const DAY_MS = 24 * 60 * 60 * 1000;
const EPS = 1e-9;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

function midnight(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

// 0 = expires today, negative = already expired
export function daysUntil(expiryIso: string, today: Date): number {
  const [y, m, d] = expiryIso.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - midnight(today)) / DAY_MS);
}

export function isExpired(b: Batch, today: Date): boolean {
  return daysUntil(b.expiry, today) < 0;
}

export function isBatchList(v: unknown): v is Batch[] {
  return (
    Array.isArray(v) &&
    v.every(
      (b) =>
        b &&
        typeof b.id === "number" &&
        typeof b.ingredient === "string" &&
        typeof b.unit === "string" &&
        typeof b.qty === "number" &&
        typeof b.costPerUnit === "number" &&
        typeof b.expiry === "string" &&
        parseDate(b.expiry) !== null &&
        typeof b.received === "string"
    )
  );
}

export function nextBatchId(batches: Batch[]): number {
  return batches.reduce((m, b) => Math.max(m, b.id), 0) + 1;
}

export type ReceiveInput = { ingredient: string; unit: string; qty: number; expiry: string; costPerUnit: number };

// STOCK IN
export function receiveStock(batches: Batch[], input: ReceiveInput, today: Date): Result<Batch[]> {
  const name = input.ingredient.trim().replace(/\s+/g, " ");
  const unit = input.unit.trim();
  if (!name) return { ok: false, error: "Write the ingredient name." };
  if (/[,|]/.test(name) || /[,|]/.test(unit)) return { ok: false, error: "Names and units can't contain commas." };
  if (!unit) return { ok: false, error: "Write the unit, like kg or litre." };
  if (!Number.isFinite(input.qty) || input.qty <= 0) return { ok: false, error: "Write the amount as a number more than zero, like 5." };
  if (!Number.isFinite(input.costPerUnit) || input.costPerUnit < 0) return { ok: false, error: "Write the cost per unit as a number, like 40. Use 0 if you don't know." };
  const expiry = parseDate(input.expiry);
  if (!expiry) return { ok: false, error: "Pick the expiry date." };
  if (daysUntil(expiry, today) < 0) return { ok: false, error: "That expiry date has already passed. Check the date on the packet." };

  const key = normalizeName(name);
  const existing = batches.find((b) => normalizeName(b.ingredient) === key);
  if (existing && normalizeName(existing.unit) !== normalizeName(unit)) {
    return { ok: false, error: `${existing.ingredient} is already tracked in ${existing.unit}, not ${unit}. Use the same unit.` };
  }
  const batch: Batch = {
    id: nextBatchId(batches),
    ingredient: existing ? existing.ingredient : name,
    unit: existing ? existing.unit : unit,
    qty: round6(input.qty),
    expiry,
    costPerUnit: input.costPerUnit,
    received: toIso(today),
  };
  return { ok: true, data: [...batches, batch] };
}

export type UseOutcome = { batches: Batch[]; cost: number; unit: string; ingredient: string };

// STOCK OUT. Oldest expiry first. Expired stock is never used.
export function takeStock(batches: Batch[], ingredient: string, qty: number, today: Date): Result<UseOutcome> {
  const key = normalizeName(ingredient);
  const mine = batches.filter((b) => normalizeName(b.ingredient) === key);
  if (!mine.length) return { ok: false, error: `I don't have "${ingredient.trim()}" in stock. Add it under Stock in first.` };
  if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: "Write the amount as a number more than zero, like 1.5." };
  const fresh = mine.filter((b) => !isExpired(b, today)).sort((a, b) => a.expiry.localeCompare(b.expiry) || a.id - b.id);
  const available = fresh.reduce((t, b) => t + b.qty, 0);
  if (qty > available + EPS) {
    const unit = mine[0].unit;
    const expired = mine.length - fresh.length;
    return {
      ok: false,
      error: `You only have ${round6(available)} ${unit} of ${mine[0].ingredient} that hasn't expired.${expired ? " Discard the expired stock first." : ""}`,
    };
  }
  let left = qty;
  let cost = 0;
  const taken = new Map<number, number>();
  for (const b of fresh) {
    if (left <= EPS) break;
    const t = Math.min(b.qty, left);
    taken.set(b.id, t);
    cost += t * b.costPerUnit;
    left -= t;
  }
  const next = batches
    .map((b) => (taken.has(b.id) ? { ...b, qty: round6(b.qty - (taken.get(b.id) ?? 0)) } : b))
    .filter((b) => b.qty > EPS);
  return { ok: true, data: { batches: next, cost, unit: mine[0].unit, ingredient: mine[0].ingredient } };
}

export type Discarded = { ingredient: string; unit: string; qty: number; cost: number };

// Removes expired batches and reports what was thrown away (so it can go in the waste log).
export function discardExpired(batches: Batch[], today: Date, ingredient?: string): { batches: Batch[]; discarded: Discarded[] } {
  const key = ingredient ? normalizeName(ingredient) : null;
  const gone = batches.filter((b) => isExpired(b, today) && (key === null || normalizeName(b.ingredient) === key));
  const goneIds = new Set(gone.map((b) => b.id));
  const byKey = new Map<string, Discarded>();
  for (const b of gone) {
    const k = normalizeName(b.ingredient);
    const row = byKey.get(k) ?? { ingredient: b.ingredient, unit: b.unit, qty: 0, cost: 0 };
    row.qty = round6(row.qty + b.qty);
    row.cost += b.qty * b.costPerUnit;
    byKey.set(k, row);
  }
  return { batches: batches.filter((b) => !goneIds.has(b.id)), discarded: [...byKey.values()] };
}

export type StockStatus = "expired" | "soon" | "ok";
export type StockRow = {
  ingredient: string;
  unit: string;
  freshQty: number;
  expiredQty: number;
  nearestExpiry: string; // soonest expiry among fresh batches, or the oldest expired date if none fresh
  daysToNearest: number;
  avgCost: number; // weighted over fresh batches (or all if none fresh)
  freshValue: number;
  expiredValue: number;
  status: StockStatus;
};

export function summarizeStock(batches: Batch[], today: Date): StockRow[] {
  const groups = new Map<string, Batch[]>();
  for (const b of batches) {
    const k = normalizeName(b.ingredient);
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  const rows: StockRow[] = [];
  for (const list of groups.values()) {
    const fresh = list.filter((b) => !isExpired(b, today));
    const expired = list.filter((b) => isExpired(b, today));
    const basis = fresh.length ? fresh : list;
    const nearest = [...basis].sort((a, b) => a.expiry.localeCompare(b.expiry))[0].expiry;
    const qtyBasis = basis.reduce((t, b) => t + b.qty, 0);
    const days = daysUntil(nearest, today);
    rows.push({
      ingredient: list[0].ingredient,
      unit: list[0].unit,
      freshQty: round6(fresh.reduce((t, b) => t + b.qty, 0)),
      expiredQty: round6(expired.reduce((t, b) => t + b.qty, 0)),
      nearestExpiry: nearest,
      daysToNearest: days,
      avgCost: qtyBasis ? basis.reduce((t, b) => t + b.qty * b.costPerUnit, 0) / qtyBasis : 0,
      freshValue: fresh.reduce((t, b) => t + b.qty * b.costPerUnit, 0),
      expiredValue: expired.reduce((t, b) => t + b.qty * b.costPerUnit, 0),
      status: expired.length ? "expired" : days <= SOON_DAYS ? "soon" : "ok",
    });
  }
  const order: Record<StockStatus, number> = { expired: 0, soon: 1, ok: 2 };
  return rows.sort((a, b) => order[a.status] - order[b.status] || a.daysToNearest - b.daysToNearest || a.ingredient.localeCompare(b.ingredient));
}

export type StockTotals = { items: number; soon: number; expired: number; freshValue: number; expiredValue: number };

export function stockTotals(rows: StockRow[]): StockTotals {
  return {
    items: rows.length,
    soon: rows.filter((r) => r.status === "soon").length,
    expired: rows.filter((r) => r.status === "expired").length,
    freshValue: rows.reduce((t, r) => t + r.freshValue, 0),
    expiredValue: rows.reduce((t, r) => t + r.expiredValue, 0),
  };
}

// Feeds the planner. Only stock that has not expired counts. The planner takes one expiry per
// ingredient, so it uses the soonest expiry among the fresh batches (this can make waste alerts cautious).
export function toPlannerStock(batches: Batch[], today: Date): StockItem[] {
  return summarizeStock(batches, today)
    .filter((r) => r.freshQty > 0)
    .map((r) => ({
      ingredient: r.ingredient,
      unit: r.unit,
      onHand: r.freshQty,
      daysToExpiry: r.daysToNearest,
      costPerUnit: r.avgCost,
    }));
}

export function stockItemsToText(items: StockItem[]): string {
  const n2 = (n: number) => Math.round(n * 100) / 100;
  return items.map((s) => `${s.ingredient}, ${s.unit}, ${n2(s.onHand)}, ${s.daysToExpiry}, ${n2(s.costPerUnit)}`).join("\n");
}

// Made-up starting stock, with dates relative to today so alerts always show.
// startId lets the sample's ids sit above any existing ones, so loading it replaces them cleanly.
export function sampleBatches(today: Date = new Date(), startId = 1): Batch[] {
  const rows: [string, string, number, number, number][] = [
    // ingredient, unit, qty, days until expiry, cost per unit
    ["paneer", "kg", 4, 3, 380],
    ["paneer", "kg", 2, 6, 380],
    ["tomato", "kg", 30, 3, 40],
    ["cream", "kg", 6, 2, 220],
    ["dal", "kg", 8, 90, 120],
    ["onion", "kg", 12, 10, 35],
    ["rice", "kg", 15, 120, 80],
    ["flour", "kg", 10, 60, 45],
    ["coriander", "kg", 1, 1, 100],
    ["curd", "kg", 2, -1, 70],
  ];
  return rows.map(([ingredient, unit, qty, days, cost], i) => ({
    id: startId + i,
    ingredient,
    unit,
    qty,
    expiry: toIso(addDays(today, days)),
    costPerUnit: cost,
    received: toIso(addDays(today, -2)),
  }));
}
