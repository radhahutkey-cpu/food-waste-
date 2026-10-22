// Demand forecast. Plain arithmetic, no AI.
// Idea: a Saturday looks like past Saturdays. Newer Saturdays count more than older ones.

import { SalesRow, normalizeName } from "./input";

export const DECAY = 0.7; // each week further back counts 30% less

export type DishHistory = { name: string; byDate: Map<string, number> };
export type Grouped = { dishes: Map<string, DishHistory>; dates: string[] };

export function toIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function groupSales(rows: SalesRow[]): Grouped {
  const dishes = new Map<string, DishHistory>();
  const dateSet = new Set<string>();
  for (const r of rows) {
    dateSet.add(r.date);
    const key = normalizeName(r.dish);
    const h = dishes.get(key) ?? { name: r.dish.trim(), byDate: new Map() };
    h.byDate.set(r.date, (h.byDate.get(r.date) ?? 0) + r.qty);
    dishes.set(key, h);
  }
  return { dishes, dates: [...dateSet].sort() };
}

// Days with no row for a dish count as zero sales for that dish.
export function forecastDish(byDate: Map<string, number>, dates: string[], target: Date): number {
  const newestFirst = [...dates].reverse();
  const sameDay = newestFirst.filter((d) => weekday(d) === target.getDay());
  // If the data has never seen this weekday, fall back to all days.
  const pool = sameDay.length ? sameDay : newestFirst;
  let num = 0;
  let den = 0;
  pool.forEach((d, i) => {
    const w = Math.pow(DECAY, i);
    num += w * (byDate.get(d) ?? 0);
    den += w;
  });
  return den ? num / den : 0;
}
