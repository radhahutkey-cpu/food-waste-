// Turns sales + recipes + stock into a prep list, buy list and waste-risk alerts.
// Plain arithmetic, no AI. Every number the owner sees comes from here.

import { RecipeLine, SalesRow, StockItem, normalizeName } from "./input";
import { addDays, forecastDish, groupSales, toIso } from "./forecast";

export const BUFFER = 0.1; // prep 10% above the forecast
export const RISK_SHARE = 0.2; // alert if more than 20% of stock would be left over
export const MAX_HORIZON_DAYS = 14;

export type PrepLine = { dish: string; expected: number; prep: number; hasRecipe: boolean };
export type BuyLine = {
  ingredient: string;
  unit: string;
  need: number;
  onHand: number;
  toBuy: number;
  cost: number | null; // null when the ingredient isn't in the stock list
  inStockList: boolean;
};
// How much of one ingredient the planned dishes need, and which dishes it goes to.
export type DemandLine = {
  ingredient: string;
  unit: string;
  total: number;
  parts: { dish: string; amount: number }[];
};
export type RiskLine = {
  ingredient: string;
  unit: string;
  onHand: number;
  daysToExpiry: number;
  unused: number;
  value: number;
  level: "high" | "medium";
};
export type Plan = {
  planDate: string;
  daysOfData: number;
  dishCount: number;
  ingredientCount: number;
  prep: PrepLine[];
  buy: BuyLine[];
  demand: DemandLine[];
  risks: RiskLine[];
  warnings: string[];
  totalBuyCost: number;
  totalRiskValue: number;
};

export function buildPlan(
  sales: SalesRow[],
  recipeLines: RecipeLine[],
  stock: StockItem[],
  today: Date = new Date()
): Plan {
  const planDate = addDays(today, 1);
  const { dishes, dates } = groupSales(sales);
  const warnings: string[] = [];

  // dish key -> its ingredients
  const recipes = new Map<string, { ingredient: string; amount: number }[]>();
  for (const l of recipeLines) {
    const key = normalizeName(l.dish);
    const list = recipes.get(key) ?? [];
    list.push({ ingredient: l.ingredient, amount: l.amount });
    recipes.set(key, list);
  }
  const stockByKey = new Map(stock.map((s) => [normalizeName(s.ingredient), s]));

  const prep: PrepLine[] = [];
  for (const [key, h] of dishes) {
    const expected = forecastDish(h.byDate, dates, planDate);
    const hasRecipe = recipes.has(key);
    if (!hasRecipe) {
      warnings.push(`"${h.name}" has sales but no recipe, so it isn't in the buy list or the waste check.`);
    }
    prep.push({ dish: h.name, expected, prep: Math.ceil(expected * (1 + BUFFER)), hasRecipe });
  }
  for (const key of recipes.keys()) {
    if (!dishes.has(key)) {
      warnings.push(`"${key}" has a recipe but no sales, so it is ignored.`);
    }
  }

  // Buy list: ingredients needed for the prep quantities.
  const need = new Map<string, { name: string; amount: number; parts: { dish: string; amount: number }[] }>();
  for (const p of prep) {
    const items = recipes.get(normalizeName(p.dish));
    if (!items) continue;
    for (const it of items) {
      const k = normalizeName(it.ingredient);
      const cur = need.get(k) ?? { name: it.ingredient, amount: 0, parts: [] };
      const amount = it.amount * p.prep;
      cur.amount += amount;
      const part = cur.parts.find((x) => x.dish === p.dish);
      if (part) part.amount += amount;
      else cur.parts.push({ dish: p.dish, amount });
      need.set(k, cur);
    }
  }
  const demand: DemandLine[] = [...need.entries()]
    .map(([k, n]) => ({
      ingredient: stockByKey.get(k)?.ingredient ?? n.name,
      unit: stockByKey.get(k)?.unit ?? "",
      total: n.amount,
      parts: n.parts,
    }))
    .sort((a, b) => b.total - a.total);
  const buy: BuyLine[] = [];
  for (const [k, n] of need) {
    const s = stockByKey.get(k);
    const onHand = s ? s.onHand : 0;
    const toBuy = Math.max(0, n.amount - onHand);
    if (!s) {
      warnings.push(`"${n.name}" is in a recipe but not in your stock list. I assumed you have none, and its cost is unknown.`);
    }
    buy.push({
      ingredient: s ? s.ingredient : n.name,
      unit: s ? s.unit : "",
      need: n.amount,
      onHand,
      toBuy,
      cost: s ? toBuy * s.costPerUnit : null,
      inStockList: !!s,
    });
  }

  // Waste risk: stock that will probably not be used before it expires.
  const risks: RiskLine[] = [];
  for (const s of stock) {
    if (s.onHand <= 0 || s.daysToExpiry > MAX_HORIZON_DAYS) continue;
    const key = normalizeName(s.ingredient);
    const horizon = Math.max(1, Math.floor(s.daysToExpiry));
    let used = 0;
    for (let d = 0; d < horizon; d++) {
      const day = addDays(planDate, d);
      for (const [dishKey, items] of recipes) {
        const h = dishes.get(dishKey);
        if (!h) continue;
        const f = forecastDish(h.byDate, dates, day);
        for (const it of items) if (normalizeName(it.ingredient) === key) used += it.amount * f;
      }
    }
    const unused = s.onHand - used;
    if (unused > 0 && unused / s.onHand > RISK_SHARE) {
      risks.push({
        ingredient: s.ingredient,
        unit: s.unit,
        onHand: s.onHand,
        daysToExpiry: s.daysToExpiry,
        unused,
        value: unused * s.costPerUnit,
        level: s.daysToExpiry <= 2 ? "high" : "medium",
      });
    }
  }
  risks.sort((a, b) => b.value - a.value);

  return {
    planDate: toIso(planDate),
    daysOfData: dates.length,
    dishCount: dishes.size,
    ingredientCount: stock.length,
    prep,
    buy,
    demand,
    risks,
    warnings,
    totalBuyCost: buy.reduce((t, b) => t + (b.cost ?? 0), 0),
    totalRiskValue: risks.reduce((t, r) => t + r.value, 0),
  };
}
