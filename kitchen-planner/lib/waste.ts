// Waste log: what was thrown away and why. Plain code, kept only while the page is open.

import { StockItem, normalizeName } from "./input";

export const REASONS = [
  "Over-prepared",
  "Spoiled / expired",
  "Plate waste",
  "Kitchen mistake",
  "Returned by customer",
  "Other",
] as const;
export type Reason = (typeof REASONS)[number];

export type WasteEntry = {
  id: number;
  date: string;
  ingredient: string;
  qty: number;
  reason: Reason;
  costPerUnit?: number; // set when the entry came from stock tracking, so it has a known cost
};

export function isWasteList(v: unknown): v is WasteEntry[] {
  return (
    Array.isArray(v) &&
    v.every(
      (e) =>
        e &&
        typeof e.id === "number" &&
        typeof e.date === "string" &&
        typeof e.ingredient === "string" &&
        typeof e.qty === "number" &&
        (REASONS as readonly string[]).includes(e.reason) &&
        (e.costPerUnit === undefined || typeof e.costPerUnit === "number")
    )
  );
}

export type ReasonTotal = { reason: Reason; entries: number; cost: number };
export type WasteSummary = {
  byReason: ReasonTotal[];
  total: number;
  unknownCost: number; // entries whose ingredient isn't in the stock list, so no rupee value
};

export function entryCost(e: WasteEntry, stock: StockItem[]): number | null {
  if (e.costPerUnit !== undefined) return e.qty * e.costPerUnit;
  const s = stock.find((x) => normalizeName(x.ingredient) === normalizeName(e.ingredient));
  return s ? e.qty * s.costPerUnit : null;
}

export function summarizeWaste(entries: WasteEntry[], stock: StockItem[]): WasteSummary {
  const map = new Map<Reason, ReasonTotal>();
  let total = 0;
  let unknownCost = 0;
  for (const e of entries) {
    const cost = entryCost(e, stock);
    const row = map.get(e.reason) ?? { reason: e.reason, entries: 0, cost: 0 };
    row.entries += 1;
    if (cost === null) unknownCost += 1;
    else {
      row.cost += cost;
      total += cost;
    }
    map.set(e.reason, row);
  }
  return { byReason: [...map.values()].sort((a, b) => b.cost - a.cost), total, unknownCost };
}
