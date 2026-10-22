"use client";

import { Plan } from "@/lib/plan";
import { OTHER, dishSlots, segmentsFor } from "@/lib/demand";
import { Card, r1 } from "./ui";

// One colour per dish, used in both parts so the eye can follow a dish from "how much it sells"
// to "which ingredients it uses up". White text sits on every colour, so they are all fairly dark.
const COLORS = ["#0f6b62", "#9a5b00", "#6a4c93", "#b3261e", "#2a5db0", "#4d7a14", "#a8396b", "#5b6472"];

export function DemandChart({ plan }: { plan: Plan }) {
  const slots = dishSlots(plan.prep);
  const maxPrep = Math.max(1, ...plan.prep.map((p) => p.prep));
  const dishes = [...plan.prep].sort((a, b) => b.prep - a.prep);
  const hasOther = [...slots.values()].some((s) => s === OTHER);

  return (
    <Card title="Demand by dish, and the ingredients each dish needs">
      <div>
        <h3 className="mb-2 text-sm font-semibold">1. How much of each dish to prepare</h3>
        <ul className="flex flex-col gap-1.5">
          {dishes.map((p) => {
            const slot = slots.get(p.dish) ?? OTHER;
            return (
              <li key={p.dish} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-sm sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
                <span className="flex items-center gap-2 truncate">
                  <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-sm" style={{ background: COLORS[slot] }} />
                  <span className="truncate" title={p.dish}>{p.dish}</span>
                </span>
                <span className="h-3 rounded bg-zinc-100" role="img" aria-label={`${p.dish}: prepare ${p.prep} portions`}>
                  <span className="block h-3 rounded" style={{ width: `${(p.prep / maxPrep) * 100}%`, background: COLORS[slot] }} />
                </span>
                <span className="tabular-nums">
                  <b>{p.prep}</b> <span className="text-zinc-600">portions</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold">2. Which dishes use up each ingredient</h3>
        <p className="mb-2 text-xs text-zinc-600">
          Each bar is 100% of that ingredient for tomorrow&apos;s prep, split by dish. Colours match the dishes above. Amounts are in each ingredient&apos;s own unit, so bars are not compared with each other.
        </p>
        {plan.demand.length === 0 ? (
          <p className="text-sm text-zinc-600">No recipes matched your sales, so there is nothing to show yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {plan.demand.map((line) => {
              const segs = segmentsFor(line, slots);
              const label = `${line.ingredient}, ${r1(line.total)} ${line.unit}: ` + segs.map((s) => `${s.label} ${Math.round(s.share * 100)}%`).join(", ");
              return (
                <li key={line.ingredient} className="grid grid-cols-[minmax(0,6rem)_1fr_auto] items-center gap-2 text-sm sm:grid-cols-[minmax(0,8rem)_1fr_auto]">
                  <span className="truncate">{line.ingredient}</span>
                  <span className="flex h-6 overflow-hidden rounded" role="img" aria-label={label}>
                    {segs.map((s) => (
                      <span
                        key={s.slot}
                        title={`${s.label}: ${r1(s.amount)} ${line.unit} (${Math.round(s.share * 100)}%)`}
                        className="flex items-center justify-center overflow-hidden text-[11px] font-semibold text-white"
                        style={{ width: `${s.share * 100}%`, background: COLORS[s.slot] }}
                      >
                        {s.share >= 0.15 ? `${Math.round(s.share * 100)}%` : ""}
                      </span>
                    ))}
                  </span>
                  <span className="tabular-nums">
                    <b>{r1(line.total)}</b> <span className="text-zinc-600">{line.unit}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {hasOther && <p className="mt-2 text-xs text-zinc-600">Dishes beyond the top 7 are grouped as &quot;Other dishes&quot; (grey).</p>}
      </div>
    </Card>
  );
}
