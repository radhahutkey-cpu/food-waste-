import { describe, expect, it } from "vitest";
import { diffBatches, diffWaste } from "./sync";
import { Batch } from "./inventory";
import { WasteEntry } from "./waste";

const b = (id: number, qty: number, ingredient = "milk"): Batch => ({
  id,
  ingredient,
  unit: "litre",
  qty,
  expiry: "2026-11-01",
  costPerUnit: 60,
  received: "2026-10-22",
});

describe("what to send to the database after a stock change", () => {
  it("nothing changed: nothing to send", () => {
    expect(diffBatches([b(1, 5)], [b(1, 5)])).toEqual({ deleteIds: [], updates: [], inserts: [] });
  });
  it("used some stock: only the quantity is updated", () => {
    expect(diffBatches([b(1, 5), b(2, 3)], [b(1, 5), b(2, 1)])).toEqual({ deleteIds: [], updates: [{ id: 2, qty: 1 }], inserts: [] });
  });
  it("used all of a delivery: it is deleted", () => {
    expect(diffBatches([b(1, 5), b(2, 3)], [b(2, 3)])).toEqual({ deleteIds: [1], updates: [], inserts: [] });
  });
  it("new delivery: inserted without its temporary id", () => {
    const d = diffBatches([b(1, 5)], [b(1, 5), b(2, 4, "paneer")]);
    expect(d.inserts).toHaveLength(1);
    expect(d.inserts[0]).not.toHaveProperty("id");
    expect(d.inserts[0]).toMatchObject({ ingredient: "paneer", qty: 4 });
  });
  it("replacing everything with a sample whose ids sit above the old ones deletes all and inserts all", () => {
    const d = diffBatches([b(1, 5), b(2, 3)], [b(3, 9, "rice"), b(4, 2, "dal")]);
    expect(d.deleteIds).toEqual([1, 2]);
    expect(d.inserts).toHaveLength(2);
    expect(d.updates).toEqual([]);
  });
  it("clear all", () => {
    expect(diffBatches([b(1, 5), b(2, 3)], []).deleteIds).toEqual([1, 2]);
  });
});

const w = (id: number): WasteEntry => ({ id, date: "2026-10-22", ingredient: "milk", qty: 1, reason: "Plate waste" });

describe("what to send after a waste log change", () => {
  it("added and removed entries", () => {
    const d = diffWaste([w(1), w(2)], [w(2), w(3)]);
    expect(d.deleteIds).toEqual([1]);
    expect(d.inserts).toHaveLength(1);
    expect(d.inserts[0]).not.toHaveProperty("id");
  });
});
