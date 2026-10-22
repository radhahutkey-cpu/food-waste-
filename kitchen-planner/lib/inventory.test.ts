import { describe, expect, it } from "vitest";
import {
  Batch,
  daysUntil,
  discardExpired,
  isBatchList,
  receiveStock,
  sampleBatches,
  stockItemsToText,
  stockTotals,
  summarizeStock,
  toPlannerStock,
  takeStock,
} from "./inventory";
import { parseStock } from "./input";

const TODAY = new Date(2026, 9, 22); // 22 Oct 2026

function batch(id: number, ingredient: string, qty: number, expiry: string, cost = 10, unit = "kg"): Batch {
  return { id, ingredient, unit, qty, expiry, costPerUnit: cost, received: "2026-10-20" };
}

describe("daysUntil", () => {
  it("counts whole days, negative when expired", () => {
    expect(daysUntil("2026-10-22", TODAY)).toBe(0);
    expect(daysUntil("2026-10-25", TODAY)).toBe(3);
    expect(daysUntil("2026-10-21", TODAY)).toBe(-1);
  });
});

describe("stock in", () => {
  const ok = { ingredient: "Paneer", unit: "kg", qty: 5, expiry: "2026-10-27", costPerUnit: 380 };
  it("adds a batch with the delivery date", () => {
    const r = receiveStock([], ok, TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data[0]).toMatchObject({ id: 1, ingredient: "Paneer", qty: 5, received: "2026-10-22" });
  });
  it("keeps the first spelling and unit for the same ingredient", () => {
    const r1 = receiveStock([], ok, TODAY);
    if (!r1.ok) throw new Error("fixture");
    const r2 = receiveStock(r1.data, { ...ok, ingredient: " paneer ", qty: 2 }, TODAY);
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.data.map((b) => b.ingredient)).toEqual(["Paneer", "Paneer"]);
  });
  it("rejects bad input with plain messages", () => {
    const err = (patch: object) => {
      const r = receiveStock([], { ...ok, ...patch }, TODAY);
      return r.ok ? "" : r.error;
    };
    expect(err({ ingredient: "  " })).toMatch(/ingredient name/);
    expect(err({ unit: "" })).toMatch(/unit/);
    expect(err({ qty: 0 })).toMatch(/more than zero/);
    expect(err({ qty: NaN })).toMatch(/more than zero/);
    expect(err({ costPerUnit: -1 })).toMatch(/cost per unit/);
    expect(err({ expiry: "" })).toMatch(/expiry date/);
    expect(err({ expiry: "2026-10-01" })).toMatch(/already passed/);
    expect(err({ ingredient: "a, b" })).toMatch(/commas/);
  });
  it("refuses a different unit for an ingredient already tracked", () => {
    const r1 = receiveStock([], ok, TODAY);
    if (!r1.ok) throw new Error("fixture");
    const r2 = receiveStock(r1.data, { ...ok, unit: "litre" }, TODAY);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/already tracked in kg/);
  });
});

describe("stock out", () => {
  // A: 3 kg expires in 1 day at Rs 10. B: 5 kg expires in 5 days at Rs 20.
  const batches = [batch(1, "Milk", 3, "2026-10-23", 10), batch(2, "Milk", 5, "2026-10-27", 20)];
  it("uses the oldest expiry first: 4 kg = 3 from A + 1 from B = Rs 50", () => {
    const r = takeStock(batches, "milk", 4, TODAY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.cost).toBe(50);
    expect(r.data.batches).toHaveLength(1);
    expect(r.data.batches[0]).toMatchObject({ id: 2, qty: 4 });
  });
  it("does not change the input", () => {
    takeStock(batches, "milk", 4, TODAY);
    expect(batches[0].qty).toBe(3);
  });
  it("says what is available when asked for too much", () => {
    const r = takeStock(batches, "milk", 9, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/only have 8 kg of Milk/);
  });
  it("never uses expired stock", () => {
    const withExpired = [batch(1, "Curd", 2, "2026-10-21"), batch(2, "Curd", 1, "2026-10-25")];
    const r = takeStock(withExpired, "curd", 2, TODAY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/only have 1 kg.*Discard the expired stock first/);
  });
  it("unknown ingredient and bad amount", () => {
    expect(takeStock(batches, "saffron", 1, TODAY).ok).toBe(false);
    expect(takeStock(batches, "milk", 0, TODAY).ok).toBe(false);
  });
  it("handles decimals without leftover dust", () => {
    const b = [batch(1, "Oil", 0.3, "2026-10-30")];
    const r = takeStock(b, "oil", 0.1 + 0.2, TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.batches).toHaveLength(0);
  });
});

describe("expiry", () => {
  const batches = [
    batch(1, "Curd", 2, "2026-10-21", 70), // expired yesterday
    batch(2, "Cream", 6, "2026-10-24", 220), // 2 days: soon
    batch(3, "Rice", 15, "2027-02-01", 80), // fine
    batch(4, "Paneer", 4, "2026-10-25", 380),
    batch(5, "Paneer", 1, "2026-10-20", 380), // an expired lot of an otherwise fresh item
  ];
  it("summarises status, nearest expiry and value", () => {
    const rows = summarizeStock(batches, TODAY);
    expect(rows.map((r) => [r.ingredient, r.status])).toEqual([
      ["Curd", "expired"],
      ["Paneer", "expired"],
      ["Cream", "soon"],
      ["Rice", "ok"],
    ]);
    const paneer = rows.find((r) => r.ingredient === "Paneer")!;
    expect(paneer).toMatchObject({ freshQty: 4, expiredQty: 1, daysToNearest: 3 });
    expect(paneer.freshValue).toBe(1520);
    expect(paneer.expiredValue).toBe(380);
  });
  it("totals", () => {
    const t = stockTotals(summarizeStock(batches, TODAY));
    expect(t).toMatchObject({ items: 4, soon: 1, expired: 2 });
    expect(t.expiredValue).toBe(2 * 70 + 380);
  });
  it("discards expired stock and reports its value for the waste log", () => {
    const r = discardExpired(batches, TODAY);
    expect(r.batches.map((b) => b.id)).toEqual([2, 3, 4]);
    expect(r.discarded).toEqual(
      expect.arrayContaining([
        { ingredient: "Curd", unit: "kg", qty: 2, cost: 140 },
        { ingredient: "Paneer", unit: "kg", qty: 1, cost: 380 },
      ])
    );
  });
  it("can discard one ingredient only", () => {
    const r = discardExpired(batches, TODAY, "curd");
    expect(r.batches.map((b) => b.id)).toEqual([2, 3, 4, 5]);
    expect(r.discarded).toHaveLength(1);
  });
});

describe("feeding the planner", () => {
  it("excludes expired stock and uses the soonest fresh expiry and a weighted cost", () => {
    const batches = [
      batch(1, "Paneer", 2, "2026-10-25", 300), // 3 days
      batch(2, "Paneer", 2, "2026-10-28", 500), // 6 days
      batch(3, "Paneer", 9, "2026-10-20", 100), // expired, ignored
    ];
    const items = toPlannerStock(batches, TODAY);
    expect(items).toEqual([{ ingredient: "Paneer", unit: "kg", onHand: 4, daysToExpiry: 3, costPerUnit: 400 }]);
  });
  it("produces text the planner's own reader accepts", () => {
    const text = stockItemsToText(toPlannerStock(sampleBatches(TODAY), TODAY));
    const parsed = parseStock(text);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.find((s) => s.ingredient === "paneer")).toMatchObject({ onHand: 6, daysToExpiry: 3 });
      expect(parsed.data.find((s) => s.ingredient === "curd")).toBeUndefined(); // expired
    }
  });
});

describe("saved data check", () => {
  it("accepts good lists and rejects damaged ones", () => {
    expect(isBatchList(sampleBatches(TODAY))).toBe(true);
    expect(isBatchList([])).toBe(true);
    expect(isBatchList("nope")).toBe(false);
    expect(isBatchList([{ id: 1 }])).toBe(false);
    expect(isBatchList([{ ...batch(1, "x", 1, "not-a-date") }])).toBe(false);
  });
});
