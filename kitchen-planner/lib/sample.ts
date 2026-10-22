// Made-up sample data so the screen shows something useful on first open.
// Sales are generated for the last 14 days, so the sample always has fresh dates.

import { toIso, addDays } from "./forecast";

const BASE: Record<string, number> = {
  "Paneer Butter Masala": 22,
  "Dal Tadka": 18,
  "Veg Biryani": 20,
  "Butter Naan": 45,
  "Masala Dosa": 15,
};
// Sunday..Saturday: busier at weekends
const WEEKDAY = [1.0, 0.8, 0.8, 0.85, 0.95, 1.35, 1.5];

export function sampleSales(today: Date = new Date()): string {
  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  const lines: string[] = [];
  for (let i = 14; i >= 1; i--) {
    const d = addDays(today, -i);
    for (const [dish, base] of Object.entries(BASE)) {
      const qty = Math.max(0, Math.round(base * WEEKDAY[d.getDay()] * (0.85 + rand() * 0.3)));
      lines.push(`${toIso(d)}, ${dish}, ${qty}`);
    }
  }
  return lines.join("\n");
}

// ingredient, unit, on hand, days until it expires, cost per unit (Rs)
export const SAMPLE_STOCK = [
  "paneer, kg, 6, 3, 380",
  "tomato, kg, 30, 3, 40",
  "cream, kg, 6, 2, 220",
  "dal, kg, 8, 90, 120",
  "onion, kg, 12, 10, 35",
  "rice, kg, 15, 120, 80",
  "flour, kg, 10, 60, 45",
].join("\n");

// dish, ingredient, amount per portion
export const SAMPLE_RECIPES = [
  "Paneer Butter Masala, paneer, 0.15",
  "Paneer Butter Masala, tomato, 0.2",
  "Paneer Butter Masala, cream, 0.05",
  "Dal Tadka, dal, 0.1",
  "Dal Tadka, tomato, 0.05",
  "Dal Tadka, onion, 0.05",
  "Veg Biryani, rice, 0.2",
  "Veg Biryani, onion, 0.08",
  "Veg Biryani, paneer, 0.05",
  "Butter Naan, flour, 0.08",
  "Masala Dosa, rice, 0.1",
  "Masala Dosa, dal, 0.04",
  "Masala Dosa, onion, 0.05",
].join("\n");
