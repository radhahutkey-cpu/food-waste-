const form = document.getElementById('form');
const list = document.getElementById('list');
const total = document.getElementById('total');

let entries = [];
try { entries = JSON.parse(localStorage.getItem('entries')) || []; } catch (e) {}

function save() {
  try { localStorage.setItem('entries', JSON.stringify(entries)); } catch (e) {}
}

function render() {
  list.innerHTML = '';
  entries.forEach((entry, i) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${entry.item} - ${entry.qty} kg`;
    const del = document.createElement('button');
    del.textContent = 'x';
    del.onclick = () => { entries.splice(i, 1); save(); render(); };
    li.append(label, del);
    list.append(li);
  });
  const sum = entries.reduce((s, e) => s + e.qty, 0);
  total.textContent = `Total wasted: ${sum.toFixed(1)} kg`;
}

form.addEventListener('submit', (ev) => {
  ev.preventDefault();
  entries.push({
    item: document.getElementById('item').value.trim(),
    qty: parseFloat(document.getElementById('qty').value),
  });
  form.reset();
  save();
  render();
});

render();
