import { describe, expect, it } from "vitest";
import { Parsed, parseRecipes, parseSales, parseStock } from "./input";
import { buildPlan, PrepLine } from "./plan";
import { OTHER, dishSlots, segmentsFor } from "./demand";

const TODAY = new Date(2026, 9, 22);

function ok<T>(r: Parsed<T>): T {
  if (!r.ok) throw new Error("fixture: " + r.errors.join(" | "));
  return r.data;
}
function sales() {
  const lines: string[] = [];
  for (let d = 8; d <= 21; d++) {
    const day = `2026-10-${String(d).padStart(2, "0")}`;
    lines.push(`${day}, Tea, 10`, `${day}, Chai Latte, 5`);
  }
  return ok(parseSales(lines.join("\n")));
}

describe("demand: dishes to ingredients", () => {
  // Tea: prep 11 (10 * 1.1). Chai Latte: prep 6 (ceil(5 * 1.1)).
  // Milk: Tea 0.1 * 11 = 1.1, Chai Latte 0.2 * 6 = 1.2, total 2.3.
  const recipes = ok(parseRecipes("Tea, milk, 0.1\nTea, sugar, 0.01\nChai Latte, milk, 0.2"));
  const stock = ok(parseStock("milk, litre, 1, 30, 60\nsugar, kg, 1, 30, 50"));
  const plan = buildPlan(sales(), recipes, stock, TODAY);

  it("splits each ingredient by dish, largest ingredient first", () => {
    expect(plan.demand.map((d) => d.ingredient)).toEqual(["milk", "sugar"]);
    const milk = plan.demand[0];
    expect(milk.unit).toBe("litre");
    expect(milk.total).toBeCloseTo(2.3, 5);
    expect(milk.parts.find((p) => p.dish === "Tea")!.amount).toBeCloseTo(1.1, 5);
    expect(milk.parts.find((p) => p.dish === "Chai Latte")!.amount).toBeCloseTo(1.2, 5);
  });
  it("matches the buy list's 'needed' amounts", () => {
    for (const d of plan.demand) {
      const b = plan.buy.find((x) => x.ingredient === d.ingredient)!;
      expect(d.total).toBeCloseTo(b.need, 9);
      expect(d.parts.reduce((t, p) => t + p.amount, 0)).toBeCloseTo(d.total, 9);
    }
  });
  it("shares add up to 100%", () => {
    const segs = segmentsFor(plan.demand[0], dishSlots(plan.prep));
    expect(segs.reduce((t, s) => t + s.share, 0)).toBeCloseTo(1, 9);
    // Tea has the bigger prep (11 vs 6), so it takes colour slot 0.
    expect(segs[0]).toMatchObject({ slot: 0, label: "Tea" });
    expect(segs[0].share).toBeCloseTo(1.1 / 2.3, 5);
  });
});

describe("colour slots", () => {
  const prep: PrepLine[] = Array.from({ length: 10 }, (_, i) => ({ dish: `Dish ${i + 1}`, expected: 0, prep: 100 - i, hasRecipe: true }));
  it("gives the top 7 their own colour and groups the rest", () => {
    const slots = dishSlots(prep);
    expect(slots.get("Dish 1")).toBe(0);
    expect(slots.get("Dish 7")).toBe(6);
    expect(slots.get("Dish 8")).toBe(OTHER);
    expect(slots.get("Dish 10")).toBe(OTHER);
  });
  it("merges grouped dishes into one 'Other dishes' segment", () => {
    const slots = dishSlots(prep);
    const segs = segmentsFor(
      { ingredient: "oil", unit: "l", total: 10, parts: [{ dish: "Dish 1", amount: 4 }, { dish: "Dish 8", amount: 3 }, { dish: "Dish 9", amount: 3 }] },
      slots
    );
    expect(segs).toHaveLength(2);
    expect(segs[1]).toMatchObject({ slot: OTHER, label: "Other dishes", amount: 6 });
  });
});
