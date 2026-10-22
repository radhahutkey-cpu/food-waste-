// CSV download helpers, so owners can keep results without accounts or saved data.

import { StockItem } from "./input";
import { Plan } from "./plan";
import { WasteEntry, entryCost } from "./waste";

type Cell = string | number | null;

function esc(c: Cell): string {
  if (c === null) return "";
  const s = String(c);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]): string {
  return rows.map((r) => r.map(esc).join(",")).join("\n");
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function planToCsv(plan: Plan): string {
  return toCsv([
    [`Plan for ${plan.planDate}`],
    [],
    ["PREP"],
    ["Dish", "Expected sales", "Prep portions"],
    ...plan.prep.map((p) => [p.dish, r1(p.expected), p.prep]),
    [],
    ["BUY"],
    ["Ingredient", "Unit", "Needed", "In stock", "To buy", "Est. cost (Rs)"],
    ...plan.buy.map((b) => [b.ingredient, b.unit, r1(b.need), r1(b.onHand), r1(b.toBuy), b.cost === null ? null : Math.round(b.cost)]),
    [],
    ["WASTE RISK"],
    ["Ingredient", "Unit", "On hand", "Days to expiry", "Likely unused", "Value at risk (Rs)"],
    ...plan.risks.map((r) => [r.ingredient, r.unit, r1(r.onHand), r.daysToExpiry, r1(r.unused), Math.round(r.value)]),
  ]);
}

export function wasteToCsv(entries: WasteEntry[], stock: StockItem[]): string {
  return toCsv([
    ["Date", "Ingredient", "Amount", "Reason", "Cost (Rs)"],
    ...entries.map((e) => {
      const c = entryCost(e, stock);
      return [e.date, e.ingredient, e.qty, e.reason, c === null ? null : Math.round(c)];
    }),
  ]);
}
