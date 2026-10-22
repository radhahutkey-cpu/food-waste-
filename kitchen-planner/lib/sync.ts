// Works out what to send to the database after the screen changes stock or waste.
// Pure functions (no network), so the logic can be tested. The database stays the source of truth:
// after saving, the app reloads from it, so new rows get their real ids.

import { Batch } from "./inventory";
import { WasteEntry } from "./waste";

export type BatchDiff = {
  deleteIds: number[];
  updates: { id: number; qty: number }[]; // only the quantity ever changes on an existing delivery
  inserts: Omit<Batch, "id">[];
};

export function diffBatches(prev: Batch[], next: Batch[]): BatchDiff {
  const prevById = new Map(prev.map((b) => [b.id, b]));
  const nextIds = new Set(next.map((b) => b.id));
  const inserts: Omit<Batch, "id">[] = [];
  const updates: { id: number; qty: number }[] = [];
  for (const b of next) {
    const old = prevById.get(b.id);
    if (!old) {
      const { id, ...rest } = b;
      void id;
      inserts.push(rest);
    } else if (old.qty !== b.qty) {
      updates.push({ id: b.id, qty: b.qty });
    }
  }
  return { deleteIds: prev.filter((b) => !nextIds.has(b.id)).map((b) => b.id), updates, inserts };
}

export type WasteDiff = { deleteIds: number[]; inserts: Omit<WasteEntry, "id">[] };

export function diffWaste(prev: WasteEntry[], next: WasteEntry[]): WasteDiff {
  const prevIds = new Set(prev.map((e) => e.id));
  const nextIds = new Set(next.map((e) => e.id));
  return {
    deleteIds: prev.filter((e) => !nextIds.has(e.id)).map((e) => e.id),
    inserts: next
      .filter((e) => !prevIds.has(e.id))
      .map((e) => {
        const { id, ...rest } = e;
        void id;
        return rest;
      }),
  };
}
