// The ONLY place the Claude API key is used. It runs on the server, so the key never reaches the browser.
// Claude writes a short plain-English note about the finished plan. It never produces numbers:
// the guard blocks any note that quotes a number that is not in the plan.

import { checkNote } from "@/lib/guard";

const MAX_BODY_BYTES = 30_000;
const TIMEOUT_MS = 10_000;
const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-5-5";

const SYSTEM = `You explain a restaurant's prep plan to a busy, non-technical owner in Bengaluru.
Rules:
- Use only the numbers and names in the JSON you are given. Never add, change, round differently, or calculate a new number.
- At most 4 short sentences, plain words, no bullet points.
- Start with the single most important thing for tomorrow (the biggest waste risk, or the most urgent purchase).
- Suggest only ways to use ingredients the owner already listed (for example a special). Never say any food is safe or unsafe to eat.
- If there are no waste risks, say so briefly.`;

export async function POST(request: Request): Promise<Response> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ status: "unavailable", message: "No Claude API key is set on the server." });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return Response.json({ status: "unavailable", message: "The plan was too large to explain." }, { status: 413 });
  }
  let facts: unknown;
  try {
    facts = JSON.parse(raw);
  } catch {
    return Response.json({ status: "unavailable", message: "Could not read the plan." }, { status: 400 });
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 300,
        system: SYSTEM,
        messages: [{ role: "user", content: `Here is tomorrow's plan as JSON:\n${JSON.stringify(facts)}` }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return Response.json({ status: "unavailable", message: "Claude could not be reached right now." });
    }
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const note = (data.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(" ")
      .trim();
    if (!note) return Response.json({ status: "unavailable", message: "Claude sent back an empty note." });

    const verdict = checkNote(note, facts);
    if (!verdict.ok) return Response.json({ status: "blocked", reason: verdict.reason });
    return Response.json({ status: "ok", note });
  } catch {
    // timeout, offline, or anything unexpected: the plan on screen is unaffected
    return Response.json({ status: "unavailable", message: "Claude took too long or could not be reached." });
  }
}
