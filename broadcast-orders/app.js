// 방송별 주문 건수 — data/orders.json을 표로 보여주고 월로 거르기
// 한 줄: { "date": "YYYY-MM-DD", "name": "방송 이름", "orders": 숫자 }

const DATA_URL = 'data/orders.json';

const monthSelect = document.getElementById('month-select');
const cardCount = document.getElementById('card-count');
const cardTotal = document.getElementById('card-total');
const statusEl = document.getElementById('status');
const tbody = document.getElementById('order-body');

let rows = [];

for (let m = 1; m <= 12; m++) monthSelect.append(new Option(`${m}월`, String(m)));

// "2026-10-05" → "2026.10.05 (월)"
function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const day = '일월화수목금토'[new Date(y, m - 1, d).getDay()];
  return `${iso.replaceAll('-', '.')} (${day})`;
}

function monthOf(iso) {
  return Number(iso.slice(5, 7));
}

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function render() {
  const month = Number(monthSelect.value);
  const list = rows
    .filter((r) => !month || monthOf(r.date) === month)
    .sort((a, b) => b.date.localeCompare(a.date));

  const total = list.reduce((sum, r) => sum + r.orders, 0);
  cardCount.textContent = `${list.length.toLocaleString('ko-KR')}건`;
  cardTotal.textContent = `${total.toLocaleString('ko-KR')}건`;

  tbody.replaceChildren(...list.map((r) => {
    const tr = document.createElement('tr');
    tr.append(
      cell(formatDate(r.date), 'date'),
      cell(r.name),
      cell(r.orders.toLocaleString('ko-KR'), 'num'),
    );
    return tr;
  }));
  statusEl.textContent = list.length ? '' : '이 달에는 방송이 없습니다';
}

async function load() {
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    rows = (Array.isArray(data) ? data : [])
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r?.date ?? '') && Number.isFinite(Number(r.orders)))
      .map((r) => ({ date: r.date, name: String(r.name ?? ''), orders: Number(r.orders) }));
    render();
  } catch (err) {
    statusEl.textContent = `데이터를 불러오지 못했습니다 (${err.message})`;
  }
}

monthSelect.addEventListener('change', render);

load();
