# Kitchen Planner

A prototype for independent restaurant owners (30-60 seats) who decide daily how much food to prepare and which ingredients to buy, without a data analyst.

**Live prototype:** https://radhahutkey-cpu.github.io/food-waste-/

## Problem

Owners guess tomorrow's demand. Over-preparing wastes food and money. Under-preparing loses sales. Ingredients expire before they are used. Small restaurants have few affordable tools that turn sales history into practical prep and purchase decisions.

## What the prototype does

1. **Prep suggestions.** Forecasts each dish's sales for a chosen day from recent sales on the same weekday (newer days count more), plus a safety buffer.
2. **Purchase recommendations.** Converts the prep plan into ingredient needs using each dish's recipe, subtracts stock on hand, and estimates the cost of what to buy.
3. **Waste-risk alerts.** Flags stock that likely won't be used before it expires, with the rupee value at risk.
4. **Waste log.** Records what gets thrown away and why (over-prepared, spoiled, plate waste, kitchen mistake, returned, other), with cost by reason.

Everything runs in the browser. Data stays on the user's device. Sample data is made up (a North Indian menu) so the tool works on first open.

## How it was built

- Plain HTML, CSS and JavaScript, no build step: `index.html`, `style.css`, `app.js`.
- Forecast: weighted average of past same-weekday sales, weights decay by 0.7 per week back.
- Waste risk: stock minus forecast usage until the expiry date; flagged if more than 20% would be left over.
- Market check: compared with PetPooja (POS with recipe-based stock deduction and wastage tracking) and Winnow/LeanPath (scale and camera waste logging for large kitchens). The prototype aims at prevention (what to prep and buy) rather than only recording waste afterwards, with no hardware.

## Status and next steps

- [x] Prep, purchase and waste-risk planner
- [x] Waste log with reason codes
- [ ] Interviews with 3-5 restaurant owners or kitchen managers in Bengaluru
- [ ] Compare predicted vs. actually wasted quantities
- [ ] Import POS sales exports (CSV)
- [ ] AI-written plain-language suggestions on top of the forecast

## Limits

The forecast is a simple statistical method. It does not know about events, weather or promotions, and it has only been tested on sample data.
