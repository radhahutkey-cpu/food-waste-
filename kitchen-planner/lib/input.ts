// Reads the text the owner pastes or uploads and checks it.
// Plain code only: no AI here, so a number can never be invented or misread.

export type SalesRow = { date: string; dish: string; qty: number };
export type RecipeLine = { dish: string; ingredient: string; amount: number };
export type StockItem = {
  ingredient: string;
  unit: string;
  onHand: number;
  daysToExpiry: number;
  costPerUnit: number;
};

export type Parsed<T> = { ok: true; data: T } | { ok: false; errors: string[] };

const MAX_SHOWN = 5;
export const MIN_DAYS = 7;

export const SALES_HELP = "Each line: date, dish, quantity. Example: 2026-10-20, Dal Tadka, 18";
export const STOCK_HELP =
  "Each line: ingredient, unit, on hand, days until it expires, cost per unit. Example: paneer, kg, 6, 3, 380";
export const RECIPE_HELP =
  "Each line: dish, ingredient, amount per portion. Example: Dal Tadka, dal, 0.1";

export function normalizeName(s: string): string {
  return s.trim().replace(/\s+/g, " ").toLowerCase();
}

function toNumber(s: string): number {
  if (s.trim() === "") return NaN;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function validIso(y: number, m: number, d: number): string | null {
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

// Accepts 2026-10-20 and 20/10/2026 (or 20-10-2026, day first, as written in India).
export function parseDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return validIso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(t);
  if (m) return validIso(+m[3], +m[2], +m[1]);
  return null;
}

type Line = { n: number; cells: string[] };

function splitLines(text: string, headerWords: RegExp): Line[] {
  const lines = text
    .split(/\r?\n/)
    .map((raw, i) => ({ n: i + 1, raw }))
    .filter((l) => l.raw.trim() !== "")
    .map((l) => ({ n: l.n, cells: l.raw.split(/[\t,]/).map((c) => c.trim()) }));
  if (lines.length && headerWords.test(lines[0].cells[0])) lines.shift();
  return lines;
}

function limit(errors: string[]): string[] {
  if (errors.length <= MAX_SHOWN) return errors;
  const more = errors.length - MAX_SHOWN;
  return [...errors.slice(0, MAX_SHOWN), `...and ${more} more line${more === 1 ? "" : "s"} with problems.`];
}

function tooLong(n: number, got: number, need: number, help: string): string {
  return `Line ${n} has ${got} part${got === 1 ? "" : "s"} but needs ${need}, separated by commas. ${help}`;
}

// Turns saved rows back into the text boxes' format.
export function salesToText(rows: SalesRow[]): string {
  return rows.map((r) => `${r.date}, ${r.dish}, ${r.qty}`).join("\n");
}
export function recipesToText(lines: RecipeLine[]): string {
  return lines.map((l) => `${l.dish}, ${l.ingredient}, ${l.amount}`).join("\n");
}

export function parseSales(text: string): Parsed<SalesRow[]> {
  const lines = splitLines(text, /^(date|day)$/i);
  if (!lines.length) return { ok: false, errors: [`Paste your last 2 weeks of sales. ${SALES_HELP}`] };
  const errors: string[] = [];
  const rows: SalesRow[] = [];
  for (const { n, cells } of lines) {
    if (cells.length !== 3) {
      errors.push(tooLong(n, cells.length, 3, SALES_HELP));
      continue;
    }
    const date = parseDate(cells[0]);
    const qty = toNumber(cells[2]);
    if (!date) {
      errors.push(`Line ${n}: "${cells[0]}" isn't a date I can read. Write it as 2026-10-20 or 20/10/2026.`);
    } else if (!cells[1]) {
      errors.push(`Line ${n}: the dish name is missing.`);
    } else if (Number.isNaN(qty)) {
      errors.push(`Line ${n}: "${cells[2]}" isn't a number. Write the quantity as digits, like 12.`);
    } else if (qty < 0) {
      errors.push(`Line ${n}: the quantity can't be negative.`);
    } else {
      rows.push({ date, dish: cells[1], qty });
    }
  }
  if (errors.length) return { ok: false, errors: limit(errors) };
  const days = new Set(rows.map((r) => r.date)).size;
  if (days < MIN_DAYS) {
    return {
      ok: false,
      errors: [
        `I only see ${days} day${days === 1 ? "" : "s"} of sales. I need at least ${MIN_DAYS} different days to find a pattern. Add more days and try again.`,
      ],
    };
  }
  return { ok: true, data: rows };
}

export function parseStock(text: string): Parsed<StockItem[]> {
  const lines = splitLines(text, /^ingredient$/i);
  if (!lines.length) return { ok: false, errors: [`Paste what you have in stock. ${STOCK_HELP}`] };
  const errors: string[] = [];
  const items: StockItem[] = [];
  const seen = new Set<string>();
  for (const { n, cells } of lines) {
    if (cells.length !== 5) {
      errors.push(tooLong(n, cells.length, 5, STOCK_HELP));
      continue;
    }
    const [name, unit, onHand, days, cost] = cells;
    const nums = { "on hand": toNumber(onHand), "days until it expires": toNumber(days), "cost per unit": toNumber(cost) };
    const bad = Object.entries(nums).find(([, v]) => Number.isNaN(v));
    const raw: Record<string, string> = { "on hand": onHand, "days until it expires": days, "cost per unit": cost };
    if (!name || !unit) {
      errors.push(`Line ${n}: the ingredient name or unit is missing.`);
    } else if (bad) {
      errors.push(`Line ${n}: "${raw[bad[0]]}" isn't a number for ${bad[0]}. Write it as digits, like 6.`);
    } else if (Object.values(nums).some((v) => v < 0)) {
      errors.push(`Line ${n}: numbers can't be negative.`);
    } else if (seen.has(normalizeName(name))) {
      errors.push(`Line ${n}: "${name}" is listed twice. Combine them into one line.`);
    } else {
      seen.add(normalizeName(name));
      items.push({
        ingredient: name,
        unit,
        onHand: nums["on hand"],
        daysToExpiry: nums["days until it expires"],
        costPerUnit: nums["cost per unit"],
      });
    }
  }
  if (errors.length) return { ok: false, errors: limit(errors) };
  return { ok: true, data: items };
}

export function parseRecipes(text: string): Parsed<RecipeLine[]> {
  const lines = splitLines(text, /^(dish|item)$/i);
  if (!lines.length) return { ok: false, errors: [`Paste your recipes. ${RECIPE_HELP}`] };
  const errors: string[] = [];
  const out: RecipeLine[] = [];
  for (const { n, cells } of lines) {
    if (cells.length !== 3) {
      errors.push(tooLong(n, cells.length, 3, RECIPE_HELP));
      continue;
    }
    const amount = toNumber(cells[2]);
    if (!cells[0] || !cells[1]) {
      errors.push(`Line ${n}: the dish or ingredient name is missing.`);
    } else if (Number.isNaN(amount)) {
      errors.push(`Line ${n}: "${cells[2]}" isn't a number. Write the amount as digits, like 0.1.`);
    } else if (amount <= 0) {
      errors.push(`Line ${n}: the amount must be more than zero.`);
    } else {
      out.push({ dish: cells[0], ingredient: cells[1], amount });
    }
  }
  if (errors.length) return { ok: false, errors: limit(errors) };
  return { ok: true, data: out };
}
