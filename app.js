const DAY = 24 * 60 * 60 * 1000;
const $ = (id) => document.getElementById(id);

const SAMPLE_MENU = [
  'Paneer Butter Masala | 260 | paneer:0.15, tomato:0.2, cream:0.05',
  'Dal Tadka | 180 | dal:0.1, tomato:0.05, onion:0.05',
  'Veg Biryani | 220 | rice:0.2, onion:0.08, paneer:0.05',
  'Butter Naan | 50 | flour:0.08',
  'Masala Dosa | 140 | rice:0.1, dal:0.04, onion:0.05',
].join('\n');

const SAMPLE_INVENTORY = [
  'paneer | kg | 6 | 3 | 380',
  'tomato | kg | 30 | 3 | 40',
  'cream | kg | 6 | 2 | 220',
  'dal | kg | 8 | 90 | 120',
  'onion | kg | 12 | 10 | 35',
  'rice | kg | 15 | 120 | 80',
  'flour | kg | 10 | 60 | 45',
].join('\n');

function sampleSales() {
  const base = { 'Paneer Butter Masala': 22, 'Dal Tadka': 18, 'Veg Biryani': 20, 'Butter Naan': 45, 'Masala Dosa': 15 };
  const weekend = [1.0, 0.8, 0.8, 0.85, 0.95, 1.35, 1.5]; // Sun..Sat
  const lines = [];
  const start = new Date();
  start.setDate(start.getDate() - 28);
  let seed = 7;
  const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < 28; i++) {
    const d = new Date(start.getTime() + i * DAY);
    for (const item in base) {
      const qty = Math.max(0, Math.round(base[item] * weekend[d.getDay()] * (0.85 + rand() * 0.3)));
      lines.push(`${fmtDate(d)}, ${item}, ${qty}`);
    }
  }
  return lines.join('\n');
}

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function lines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

// ---------- parsing ----------
function parseSales(text) {
  const sales = {}; // item -> { dateStr: qty }
  const dates = new Set();
  lines(text).forEach((line, i) => {
    const [date, item, qty] = line.split(',').map((s) => s.trim());
    if (!parseDate(date) || !item || isNaN(+qty)) throw new Error(`Sales line ${i + 1} should look like: 2026-10-20, Dal Tadka, 18`);
    (sales[item] ||= {})[date] = (sales[item][date] || 0) + +qty;
    dates.add(date);
  });
  if (!dates.size) throw new Error('Add some past sales first.');
  return { sales, dates: [...dates] };
}

function parseMenu(text) {
  return lines(text).map((line, i) => {
    const [name, price, ings] = line.split('|').map((s) => s.trim());
    if (!name || isNaN(+price) || !ings) throw new Error(`Menu line ${i + 1} should look like: Dal Tadka | 180 | dal:0.1, onion:0.05`);
    const recipe = ings.split(',').map((p) => {
      const [ing, amt] = p.split(':').map((s) => s.trim().toLowerCase());
      if (!ing || isNaN(+amt)) throw new Error(`Menu line ${i + 1}: write ingredients as name:amount`);
      return { ing, amt: +amt };
    });
    return { name, price: +price, recipe };
  });
}

function parseInventory(text) {
  const inv = {};
  lines(text).forEach((line, i) => {
    const [name, unit, onHand, days, cost] = line.split('|').map((s) => s.trim());
    if (!name || [onHand, days, cost].some((v) => v === undefined || isNaN(+v))) {
      throw new Error(`Inventory line ${i + 1} should look like: paneer | kg | 6 | 3 | 380`);
    }
    inv[name.toLowerCase()] = { name, unit, onHand: +onHand, days: +days, cost: +cost };
  });
  return inv;
}

// ---------- forecasting ----------
// Weighted average of past sales on the same weekday (newest counts most).
// Days with no row for an item count as zero sales.
function forecast(item, date, data) {
  const qtyOn = (ds) => (data.sales[item] && data.sales[item][ds]) || 0;
  const sorted = [...data.dates].sort().reverse();
  const same = sorted.filter((ds) => parseDate(ds).getDay() === date.getDay());
  const pool = same.length ? same : sorted;
  let num = 0, den = 0;
  pool.forEach((ds, i) => { const w = Math.pow(0.7, i); num += w * qtyOn(ds); den += w; });
  return den ? num / den : 0;
}

function round1(n) { return Math.round(n * 10) / 10; }

// ---------- planning ----------
function makePlan(data, menu, inv, date, bufferPct) {
  const prep = menu.map((m) => {
    const f = forecast(m.name, date, data);
    return { name: m.name, forecast: f, prep: Math.ceil(f * (1 + bufferPct / 100)) };
  });

  const need = {};
  menu.forEach((m, i) => m.recipe.forEach((r) => { need[r.ing] = (need[r.ing] || 0) + r.amt * prep[i].prep; }));

  const buy = Object.keys(need).map((ing) => {
    const stock = inv[ing];
    const have = stock ? stock.onHand : 0;
    return { ing, label: stock ? stock.name : ing, unit: stock ? stock.unit : '', need: need[ing], have, toBuy: Math.max(0, need[ing] - have), cost: stock ? stock.cost : 0, missing: !stock };
  });

  // Waste risk: stock that won't be used before it expires.
  const alerts = [];
  Object.keys(inv).forEach((key) => {
    const s = inv[key];
    const horizon = Math.min(Math.max(Math.floor(s.days), 1), 14);
    let used = 0;
    for (let d = 0; d < horizon; d++) {
      const day = new Date(date.getTime() + d * DAY);
      menu.forEach((m) => m.recipe.forEach((r) => {
        if (r.ing === key) used += r.amt * forecast(m.name, day, data);
      }));
    }
    const excess = s.onHand - used;
    if (s.onHand > 0 && excess / s.onHand > 0.2 && s.days <= 14) {
      alerts.push({ ...s, excess, value: excess * s.cost, level: s.days <= 2 ? 'high' : 'med' });
    }
  });
  alerts.sort((a, b) => b.value - a.value);
  return { prep, buy, alerts };
}

// ---------- rendering ----------
function table(headers, rows) {
  const t = document.createElement('table');
  const head = t.createTHead().insertRow();
  headers.forEach(([text, num]) => { const th = document.createElement('th'); th.textContent = text; if (num) th.className = 'num'; head.append(th); });
  const body = t.createTBody();
  rows.forEach((row) => {
    const tr = body.insertRow();
    row.forEach((cell, i) => { const td = tr.insertCell(); td.textContent = cell; if (headers[i][1]) td.className = 'num'; });
  });
  return t;
}

function show(el, node) { el.replaceChildren(node); }

function render(plan) {
  show($('prep'), table(
    [['Dish'], ['Expected sales', 1], ['Prep portions', 1]],
    plan.prep.map((p) => [p.name, round1(p.forecast), p.prep])
  ));

  const buyRows = plan.buy.map((b) => [
    b.label + (b.missing ? ' (not in inventory)' : ''),
    `${round1(b.need)} ${b.unit}`,
    `${round1(b.have)} ${b.unit}`,
    b.toBuy > 0 ? `${round1(b.toBuy)} ${b.unit}` : 'enough',
    b.toBuy > 0 ? `₹${Math.round(b.toBuy * b.cost)}` : '-',
  ]);
  show($('buy'), table([['Ingredient'], ['Needed', 1], ['In stock', 1], ['Buy', 1], ['Est. cost', 1]], buyRows));

  const box = document.createElement('div');
  if (!plan.alerts.length) {
    const p = document.createElement('p');
    p.className = 'ok';
    p.textContent = 'No ingredients look at risk of expiring unused.';
    box.append(p);
  }
  plan.alerts.forEach((a) => {
    const div = document.createElement('div');
    div.className = 'alert ' + a.level;
    const when = a.days <= 1 ? 'tomorrow or sooner' : `in ${a.days} days`;
    div.textContent = `${a.name}: about ${round1(a.excess)} ${a.unit} (≈₹${Math.round(a.value)}) likely unused before it expires ${when}. Use it in specials, prep it early, or buy less next time.`;
    box.append(div);
  });
  show($('alerts'), box);
}

// ---------- wiring ----------
const KEY = 'kitchen-planner-v1';

function load() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
  $('sales').value = (saved && saved.sales) || sampleSales();
  $('menu').value = (saved && saved.menu) || SAMPLE_MENU;
  $('inventory').value = (saved && saved.inventory) || SAMPLE_INVENTORY;
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ sales: $('sales').value, menu: $('menu').value, inventory: $('inventory').value })); } catch (e) {}
}

function run() {
  $('error').textContent = '';
  try {
    const data = parseSales($('sales').value);
    const menu = parseMenu($('menu').value);
    const inv = parseInventory($('inventory').value);
    if (!menu.length) throw new Error('Add at least one menu item.');
    const date = parseDate($('date').value);
    if (!date) throw new Error('Pick a date to plan for.');
    const buffer = Math.max(0, +$('buffer').value || 0);
    render(makePlan(data, menu, inv, date, buffer));
    $('results').hidden = false;
    save();
  } catch (e) {
    $('error').textContent = e.message;
    $('results').hidden = true;
  }
}

$('run').addEventListener('click', run);
$('reset').addEventListener('click', () => {
  try { localStorage.removeItem(KEY); } catch (e) {}
  load();
});

// ---------- waste log ----------
const WASTE_KEY = 'kitchen-planner-waste-v1';
let waste = [];
try { waste = JSON.parse(localStorage.getItem(WASTE_KEY)) || []; } catch (e) {}

function saveWaste() {
  try { localStorage.setItem(WASTE_KEY, JSON.stringify(waste)); } catch (e) {}
}

function currentInventory() {
  try { return parseInventory($('inventory').value); } catch (e) { return {}; }
}

function fillIngredients() {
  const select = $('w-ing');
  const keep = select.value;
  select.replaceChildren();
  Object.values(currentInventory()).forEach((s) => {
    const o = document.createElement('option');
    o.value = s.name.toLowerCase();
    o.textContent = `${s.name} (${s.unit})`;
    select.append(o);
  });
  if (keep) select.value = keep;
}

function renderWaste() {
  const inv = currentInventory();
  const costOf = (w) => w.qty * ((inv[w.ing] && inv[w.ing].cost) || 0);
  const summary = $('waste-summary');
  const list = $('waste-list');
  if (!waste.length) {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = 'Nothing logged yet.';
    summary.replaceChildren(p);
    list.replaceChildren();
    return;
  }

  const byReason = {};
  waste.forEach((w) => { byReason[w.reason] = (byReason[w.reason] || 0) + costOf(w); });
  const total = Object.values(byReason).reduce((a, b) => a + b, 0);
  const max = Math.max(...Object.values(byReason), 1);

  const box = document.createElement('div');
  const head = document.createElement('p');
  head.textContent = `Total wasted: ₹${Math.round(total)}`;
  head.style.fontWeight = '600';
  box.append(head);
  Object.entries(byReason).sort((a, b) => b[1] - a[1]).forEach(([reason, val]) => {
    const row = document.createElement('div');
    row.className = 'bar';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = reason;
    const fill = document.createElement('span');
    fill.className = 'fill';
    fill.style.width = Math.max(4, (val / max) * 160) + 'px';
    const amt = document.createElement('span');
    amt.textContent = `₹${Math.round(val)}`;
    row.append(label, fill, amt);
    box.append(row);
  });
  summary.replaceChildren(box);

  const rows = waste.map((w, i) => ({ w, i })).sort((a, b) => b.w.date.localeCompare(a.w.date) || b.i - a.i);
  const t = table(
    [['Date'], ['Item'], ['Amount', 1], ['Reason'], ['Cost', 1], ['']],
    rows.map(({ w }) => {
      const s = inv[w.ing];
      return [w.date, s ? s.name : w.ing, `${w.qty} ${s ? s.unit : ''}`, w.reason, `₹${Math.round(costOf(w))}`, ''];
    })
  );
  Array.from(t.tBodies[0].rows).forEach((tr, r) => {
    const del = document.createElement('button');
    del.className = 'link';
    del.textContent = 'remove';
    del.addEventListener('click', () => { waste.splice(rows[r].i, 1); saveWaste(); renderWaste(); });
    tr.cells[5].append(del);
  });
  list.replaceChildren(t);
}

$('waste-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  waste.push({ date: $('w-date').value, ing: $('w-ing').value, qty: +$('w-qty').value, reason: $('w-reason').value });
  $('w-qty').value = '';
  saveWaste();
  renderWaste();
});
$('clear-waste').addEventListener('click', () => {
  if (waste.length && confirm('Delete all waste log entries?')) { waste = []; saveWaste(); renderWaste(); }
});
$('inventory').addEventListener('change', () => { fillIngredients(); renderWaste(); });

load();
$('date').value = fmtDate(new Date(Date.now() + DAY));
$('w-date').value = fmtDate(new Date());
fillIngredients();
renderWaste();
