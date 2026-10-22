// Safety check on the AI note. The AI must not change or invent numbers.
// We collect every number in the real plan, then block any note that quotes a number not in that set.

export type GuardResult = { ok: true } | { ok: false; reason: string };

export const MAX_NOTE_CHARS = 900;

function collectNumbers(value: unknown, out: number[]): void {
  if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectNumbers(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectNumbers(v, out));
  else if (typeof value === "string") {
    // dates like 2026-10-22 inside the facts count as allowed numbers too
    for (const m of value.match(/\d+(?:\.\d+)?/g) ?? []) out.push(Number(m));
  }
}

function matches(x: number, allowed: number[]): boolean {
  return allowed.some(
    (a) => Math.abs(x - a) <= 0.051 || Math.round(a) === x || Math.round(a * 10) / 10 === x
  );
}

export function checkNote(note: string, facts: unknown): GuardResult {
  if (note.length > MAX_NOTE_CHARS) return { ok: false, reason: "the note was too long" };
  const allowed: number[] = [];
  collectNumbers(facts, allowed);
  // "1,044" is one number
  const cleaned = note.replace(/(?<=\d),(?=\d{3})/g, "");
  for (const m of cleaned.match(/\d+(?:\.\d+)?/g) ?? []) {
    if (!matches(Number(m), allowed)) {
      return { ok: false, reason: `it quoted the number ${m}, which is not in your plan` };
    }
  }
  return { ok: true };
}
