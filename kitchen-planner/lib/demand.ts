// Helpers for the demand visual: one colour per dish, and "Other dishes" when there are too many to colour.

import { DemandLine, PrepLine } from "./plan";

export const MAX_COLORS = 7;
export const OTHER = MAX_COLORS; // slot used for every dish beyond the top MAX_COLORS

// Biggest dishes get their own colour (slot 0 is the biggest), the rest share the "Other" slot.
export function dishSlots(prep: PrepLine[]): Map<string, number> {
  const ranked = [...prep].sort((a, b) => b.prep - a.prep || a.dish.localeCompare(b.dish));
  return new Map(ranked.map((p, i) => [p.dish, Math.min(i, OTHER)]));
}

export type Segment = { slot: number; label: string; amount: number; share: number };

export function segmentsFor(line: DemandLine, slots: Map<string, number>): Segment[] {
  const merged = new Map<number, { label: string; amount: number }>();
  for (const p of line.parts) {
    const slot = slots.get(p.dish) ?? OTHER;
    const cur = merged.get(slot) ?? { label: slot === OTHER ? "Other dishes" : p.dish, amount: 0 };
    cur.amount += p.amount;
    merged.set(slot, cur);
  }
  const total = [...merged.values()].reduce((t, m) => t + m.amount, 0);
  return [...merged.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([slot, m]) => ({ slot, label: m.label, amount: m.amount, share: total ? m.amount / total : 0 }));
}
