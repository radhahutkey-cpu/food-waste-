# Kitchen Planner (Next.js)

Paste 2 weeks of sales, your stock and your recipes. Get tomorrow's prep list, buy list and waste-risk alerts, plus a waste log with reasons.

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # logic tests
```

## AI note (optional)

Claude writes a short plain-English note under the plan. The plan itself never depends on it.

1. Copy `.env.example` to `.env.local`.
2. Paste your key after `ANTHROPIC_API_KEY=`.
3. Restart `npm run dev`.

`.env.local` is git-ignored. Never commit a key. On Vercel, add `ANTHROPIC_API_KEY` under Project Settings, Environment Variables.

Without a key the app works fully and shows "Note unavailable".

## Where things are

- `lib/input.ts` reads and checks pasted text, with plain-language errors
- `lib/forecast.ts`, `lib/plan.ts` forecast, prep, buy list, waste risk, rupee estimates (plain code, no AI)
- `lib/waste.ts`, `lib/export.ts` waste log totals and CSV downloads
- `lib/guard.ts` blocks an AI note that quotes a number not in the plan
- `app/api/explain/route.ts` the only place the API key is used (server side)
- `app/page.tsx` the one screen

## Deploy on Vercel

Import the GitHub repo, set **Root Directory** to `kitchen-planner`, add the API key, deploy.
