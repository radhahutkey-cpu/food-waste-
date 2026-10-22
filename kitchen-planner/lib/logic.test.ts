import { describe, expect, it } from "vitest";
import { parseRecipes, parseSales, parseStock } from "./input";
import { forecastDish } from "./forecast";
import { buildPlan } from "./plan";
import { checkNote } from "./guard";
import { summarizeWaste } from "./waste";
import { sampleSales, SAMPLE_RECIPES, SAMPLE_STOCK } from "./sample";

const TODAY = new Date(2026, 9, 22); // 22 Oct 2026 (a Thursday)

// 14 days, 2026-10-08 .. 2026-10-21, one dish "Tea", always 10 sold
function steadySales(qty = 10): string {
  const lines: string[] = [];
  for (let d = 8; d <= 21; d++) lines.push(`2026-10-${String(d).padStart(2, "0")}, Tea, ${qty}`);
  return lines.join("\n");
}
const sales = (t: string) => {
  const r = parseSales(t);
  if (!r.ok) throw new Error(r.errors.join(" | "));
  return r.data;
};

describe("test 3: bad input gives plain messages and never crashes", () => {
  it("empty sales", () => {
    const r = parseSales("   \n  ");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/Paste your last 2 weeks of sales/);
  });
  it("wrong number of columns", () => {
    const r = parseSales("2026-10-20, Dal Tadka");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/Line 1 has 2 parts but needs 3/);
  });
  it("text where a number belongs", () => {
    const r = parseSales("2026-10-20, Dal Tadka, twelve");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/"twelve" isn't a number/);
  });
  it("unreadable date", () => {
    const r = parseSales("31/02/2026, Dal Tadka, 5");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/isn't a date/);
  });
  it("negative quantity", () => {
    const r = parseSales("2026-10-20, Dal Tadka, -3");
    expect(r.ok).toBe(false);
  });
  it("fewer than 7 days", () => {
    const r = parseSales(["2026-10-15, Tea, 5", "2026-10-16, Tea, 6", "2026-10-17, Tea, 4"].join("\n"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/only see 3 days/);
  });
  it("lists at most 5 problems and counts the rest", () => {
    const bad = Array.from({ length: 9 }, () => "oops").join("\n");
    const r = parseSales(bad);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(6);
      expect(r.errors[5]).toMatch(/and 4 more lines/);
    }
  });
  it("accepts a header row, tabs and day-first dates", () => {
    const text = "Date\tDish\tQuantity\n" + Array.from({ length: 7 }, (_, i) => `${10 + i}/10/2026\tTea\t5`).join("\n");
    const r = parseSales(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data[0].date).toBe("2026-10-10");
  });
  it("bad stock and recipe lines", () => {
    expect(parseStock("").ok).toBe(false);
    expect(parseStock("milk, litre, lots, 2, 60").ok).toBe(false);
    expect(parseStock("milk, litre, 5, 2").ok).toBe(false);
    expect(parseStock("milk, litre, 5, 2, 60\nMilk, litre, 1, 2, 60").ok).toBe(false);
    expect(parseRecipes("").ok).toBe(false);
    expect(parseRecipes("Tea, milk, 0").ok).toBe(false);
  });
});

describe("forecast", () => {
  it("weights newer same-weekday sales more (hand-worked: (20 + 0.7*10) / 1.7)", () => {
    // Two Thursdays: 15 Oct sold 10, 22 Oct sold 20. Plan for a Thursday.
    const byDate = new Map([["2026-10-15", 10], ["2026-10-22", 20]]);
    const f = forecastDish(byDate, ["2026-10-15", "2026-10-22"], new Date(2026, 9, 29));
    expect(f).toBeCloseTo(27 / 1.7, 5);
  });
  it("counts missing days as zero", () => {
    const byDate = new Map([["2026-10-22", 10]]);
    const f = forecastDish(byDate, ["2026-10-15", "2026-10-22"], new Date(2026, 9, 29));
    expect(f).toBeCloseTo(10 / 1.7, 5);
  });
});

describe("test 1 and 2: plan on a tiny kitchen, checkable by hand", () => {
  // Tea sells 10 a day, so expected = 10, prep = ceil(10 * 1.1) = 11.
  const recipes = parseRecipes("Tea, milk, 0.1\nTea, sugar, 0.01");
  const stock = parseStock("milk, litre, 0.5, 30, 60\nsugar, kg, 1, 30, 50");
  if (!recipes.ok || !stock.ok) throw new Error("fixture");

  it("prep list", () => {
    const plan = buildPlan(sales(steadySales()), recipes.data, stock.data, TODAY);
    expect(plan.planDate).toBe("2026-10-23");
    expect(plan.prep[0].expected).toBeCloseTo(10, 5);
    expect(plan.prep[0].prep).toBe(11);
  });
  it("buy list: milk needs 1.1, has 0.5, buy 0.6 = Rs 36; sugar is enough", () => {
    const plan = buildPlan(sales(steadySales()), recipes.data, stock.data, TODAY);
    const milk = plan.buy.find((b) => b.ingredient === "milk")!;
    expect(milk.need).toBeCloseTo(1.1, 5);
    expect(milk.toBuy).toBeCloseTo(0.6, 5);
    expect(milk.cost).toBeCloseTo(36, 5);
    expect(plan.buy.find((b) => b.ingredient === "sugar")!.toBuy).toBe(0);
  });
  it("waste risk: 5 L milk expiring in 2 days, 1 L/day used, 3 L unused = Rs 180, high", () => {
    const s = parseStock("milk, litre, 5, 2, 60");
    if (!s.ok) throw new Error("fixture");
    const plan = buildPlan(sales(steadySales()), recipes.data, s.data, TODAY);
    expect(plan.risks).toHaveLength(1);
    expect(plan.risks[0].unused).toBeCloseTo(3, 5);
    expect(plan.risks[0].value).toBeCloseTo(180, 5);
    expect(plan.risks[0].level).toBe("high");
  });
  it("no alert when the stock will be used", () => {
    const s = parseStock("milk, litre, 2, 2, 60");
    if (!s.ok) throw new Error("fixture");
    expect(buildPlan(sales(steadySales()), recipes.data, s.data, TODAY).risks).toHaveLength(0);
  });
  it("missing recipe and missing stock are named, not guessed", () => {
    const plan = buildPlan(
      sales(steadySales() + "\n2026-10-21, Samosa, 4"),
      recipes.data,
      parseStock("sugar, kg, 1, 30, 50").ok ? (parseStock("sugar, kg, 1, 30, 50") as { ok: true; data: never[] }).data : [],
      TODAY
    );
    expect(plan.warnings.join(" ")).toMatch(/"Samosa" has sales but no recipe/);
    expect(plan.warnings.join(" ")).toMatch(/"milk" is in a recipe but not in your stock list/);
    expect(plan.buy.find((b) => b.ingredient === "milk")!.cost).toBeNull();
  });
});

describe("sample data", () => {
  it("passes validation and produces all three outputs", () => {
    const s = parseSales(sampleSales(TODAY));
    const st = parseStock(SAMPLE_STOCK);
    const r = parseRecipes(SAMPLE_RECIPES);
    expect(s.ok && st.ok && r.ok).toBe(true);
    if (!s.ok || !st.ok || !r.ok) return;
    const plan = buildPlan(s.data, r.data, st.data, TODAY);
    expect(plan.prep).toHaveLength(5);
    expect(plan.buy.length).toBeGreaterThan(0);
    expect(plan.risks.map((x) => x.ingredient)).toEqual(expect.arrayContaining(["cream", "tomato"]));
  });
});

describe("AI note guard", () => {
  const facts = { risks: [{ ingredient: "cream", unused: 2.9, value: 645.3, daysToExpiry: 2 }], daysOfData: 14 };
  it("allows numbers that are in the plan, rounded", () => {
    expect(checkNote("Cream: about 2.9 kg, roughly ₹645, expires in 2 days. Based on 14 days.", facts).ok).toBe(true);
  });
  it("blocks a made-up number", () => {
    const r = checkNote("You will lose ₹9,999 of cream.", facts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/9999/);
  });
  it("blocks a note that is too long", () => {
    expect(checkNote("x".repeat(1000), facts).ok).toBe(false);
  });
});

describe("waste log", () => {
  it("totals cost by reason and flags unknown ingredients", () => {
    const st = parseStock("milk, litre, 5, 2, 60");
    if (!st.ok) throw new Error("fixture");
    const s = summarizeWaste(
      [
        { id: 1, date: "2026-10-21", ingredient: "milk", qty: 2, reason: "Spoiled / expired" },
        { id: 2, date: "2026-10-21", ingredient: "Milk", qty: 1, reason: "Over-prepared" },
        { id: 3, date: "2026-10-21", ingredient: "saffron", qty: 1, reason: "Other" },
      ],
      st.data
    );
    expect(s.total).toBe(180);
    expect(s.byReason[0]).toMatchObject({ reason: "Spoiled / expired", cost: 120 });
    expect(s.unknownCost).toBe(1);
  });
});
