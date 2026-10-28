// 농축수산물 시세 대시보드 — fixtures/sample.json을 표로 보여주고 거르기

const DATA_URL = 'fixtures/sample.json';
const LIVE_URL = 'https://apis.data.go.kr/B552845/recent/price';
const KEY_STORAGE = 'priceBoard.serviceKey';
const KEY_ERROR = '인증키를 확인해 주세요';
const AI_URL = '/api/ai';
const CASTER_MAX = 5;

// 비교 기준: 버튼의 data-basis → 응답 필드와 열 제목
const BASES = {
  dd1: { field: 'dd1_bfr_prc', label: '1일 전' },
  ww1: { field: 'ww1_bfr_prc', label: '1주일 전' },
  mm1: { field: 'mm1_bfr_prc', label: '1개월 전' },
  yy1: { field: 'yy1_bfr_prc', label: '1년 전' },
};

const form = document.getElementById('search-form');
const itemInput = document.getElementById('item-input');
const categorySelect = document.getElementById('category-select');
const seSelect = document.getElementById('se-select');
const sortSelect = document.getElementById('sort-select');
const statusEl = document.getElementById('status');
const tbody = document.getElementById('price-body');
const liveForm = document.getElementById('live-form');
const keyInput = document.getElementById('key-input');
const liveButton = document.getElementById('live-button');
const basisButtons = document.querySelectorAll('.basis button');
const compareHeader = document.getElementById('compare-header');
const cardDate = document.getElementById('card-date');
const cardCount = document.getElementById('card-count');
const cardTopUp = document.getElementById('card-top-up');
const cardTopUpRate = document.getElementById('card-top-up-rate');
const cardTopDown = document.getElementById('card-top-down');
const cardTopDownRate = document.getElementById('card-top-down-rate');
const casterButton = document.getElementById('caster-button');
const casterText = document.getElementById('caster-text');
const casterMeta = document.getElementById('caster-meta');
const casterItems = document.getElementById('caster-items');

let rows = [];
let basis = 'ww1';
let source = '예제 데이터';

// "4800" 같은 글자를 숫자로. 비었거나 숫자가 아니면 null.
function toNumber(value) {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).replace(/,/g, '').trim());
  return String(value).trim() === '' || Number.isNaN(n) ? null : n;
}

function formatWon(n) {
  return n === null ? '-' : `${n.toLocaleString('ko-KR')}원`;
}

// "20261013" → "2026.10.13"
function formatYmd(ymd) {
  const s = String(ymd ?? '');
  return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}` : s || '-';
}

// (조사일 가격 - 비교 가격) ÷ 비교 가격 × 100
function priceChange(today, before) {
  if (today === null || before === null || before === 0) return null;
  return ((today - before) / before) * 100;
}

function toRow(item) {
  const before = {};
  for (const [key, { field }] of Object.entries(BASES)) before[key] = toNumber(item[field]);
  return {
    date: item.exmn_ymd,
    category: item.ctgry_nm ?? '',
    name: item.item_nm ?? '',
    variety: item.vrty_nm,
    se: item.se_nm,
    grade: item.grd_nm,
    unit: `${item.unit_sz ?? ''}${item.unit ?? ''}`,
    today: toNumber(item.exmn_dd_prc),
    before,
  };
}

// 지금 비교 기준으로 본 가격과 등락
function compared(r) {
  const before = r.before[basis];
  return { ...r, compare: before, change: priceChange(r.today, before) };
}

// 부류 선택칸을 받은 데이터의 부류로 채움 (고른 값은 남아 있으면 유지)
const CATEGORY_ORDER = ['채소류', '과일류', '수산물', '식량작물'];

function fillCategories() {
  const current = categorySelect.value;
  const found = [...new Set(rows.map((r) => r.category).filter(Boolean))];
  const rank = (c) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
  found.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'ko'));

  const options = [new Option('전체', ''), ...found.map((c) => new Option(c, c))];
  categorySelect.replaceChildren(...options);
  categorySelect.value = found.includes(current) ? current : '';
}

function showStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
}

function showError(message) {
  rows = [];
  tbody.replaceChildren();
  renderCards([]);
  showStatus(message, true);
}

// 응답의 item은 배열, 한 개면 객체, 없으면 빈 글자로 올 수 있음
function itemsOf(json) {
  const items = json?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

async function load() {
  showStatus('불러오는 중…');
  try {
    const res = await fetch(DATA_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    rows = itemsOf(await res.json()).map(toRow);
    source = '예제 데이터';
    fillCategories();
    render();
  } catch (err) {
    showError(`데이터를 불러오지 못했습니다 (${err.message})`);
  }
}

// 인증키는 이 브라우저(localStorage)에만 둠
function readSavedKey() {
  try {
    return localStorage.getItem(KEY_STORAGE) ?? '';
  } catch {
    return '';
  }
}

function saveKey(key) {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    // 저장이 막힌 브라우저에서는 이번 요청에만 사용
  }
}

// 오늘보다 7일 전, yyyyMMdd
function weekAgoYmd() {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

function liveUrl(key) {
  // 포털의 "인코딩" 키를 붙여 넣어도 두 번 인코딩되지 않게 풀어 둠
  let serviceKey = key;
  if (/%[0-9A-Fa-f]{2}/.test(key)) {
    try {
      serviceKey = decodeURIComponent(key);
    } catch {
      // 그대로 사용
    }
  }
  const params = new URLSearchParams({
    serviceKey,
    returnType: 'json',
    pageNo: '1',
    numOfRows: '1000',
    'cond[exmn_ymd::GTE]': weekAgoYmd(),
  });
  return `${LIVE_URL}?${params}`;
}

function isKeyError(res, json) {
  if (res.status === 401 || res.status === 403) return true;
  const errMsg = json?.OpenAPI_ServiceResponse?.cmmMsgHeader?.errMsg ?? '';
  return errMsg.includes('SERVICE_KEY');
}

async function loadLive() {
  const key = keyInput.value.trim();
  if (!key) {
    showError(KEY_ERROR);
    keyInput.focus();
    return;
  }
  saveKey(key);

  showStatus('실제 시세를 불러오는 중…');
  liveButton.disabled = true;
  try {
    const res = await fetch(liveUrl(key), { cache: 'no-store' });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // XML 등 JSON이 아닌 오류 응답
    }

    if (isKeyError(res, json) || (!json && text.includes('SERVICE_KEY'))) {
      showError(KEY_ERROR);
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (!json) throw new Error('응답 형식이 올바르지 않습니다');

    const header = json?.response?.header;
    if (header && !['0', '00'].includes(String(header.resultCode))) {
      throw new Error(header.resultMsg || `resultCode ${header.resultCode}`);
    }

    rows = itemsOf(json).map(toRow);
    source = '실제 시세';
    fillCategories();
    render();
  } catch (err) {
    showError(`실제 시세를 불러오지 못했습니다 (${err.message})`);
  } finally {
    liveButton.disabled = false;
  }
}

function filteredRows() {
  const category = categorySelect.value;
  const se = seSelect.value;
  const query = itemInput.value.trim();

  const list = rows.map(compared).filter((r) =>
    (!category || r.category === category) &&
    (!se || r.se === se) &&
    (!query || r.name.includes(query) || (r.variety ?? '').includes(query))
  );

  const byName = (a, b) => a.name.localeCompare(b.name, 'ko');
  // 등락 정렬에서 "비교 없음"은 항상 맨 뒤
  const byChange = (dir) => (a, b) => {
    if (a.change === null && b.change === null) return byName(a, b);
    if (a.change === null) return 1;
    if (b.change === null) return -1;
    return dir * (b.change - a.change) || byName(a, b);
  };

  const sorters = { rise: byChange(1), fall: byChange(-1), name: byName };
  return list.sort(sorters[sortSelect.value] ?? byName);
}

function cell(text, className) {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function changeCell(change) {
  if (change === null) return cell('비교 없음', 'num change-none');
  const rounded = Math.round(change * 10) / 10;
  if (rounded > 0) return cell(`▲ ${rounded.toFixed(1)}%`, 'num change-up');
  if (rounded < 0) return cell(`▼ ${Math.abs(rounded).toFixed(1)}%`, 'num change-down');
  return cell('0.0%', 'num change-none');
}

function formatRate(change) {
  const rounded = Math.round(change * 10) / 10;
  return `${Math.abs(rounded).toFixed(1)}%`;
}

function renderCards(list) {
  const dates = list.map((r) => r.date).filter(Boolean).sort();
  cardDate.textContent = dates.length ? formatYmd(dates[dates.length - 1]) : '-';
  cardCount.textContent = `${list.length}개`;

  const withChange = list.filter((r) => r.change !== null);
  const up = withChange.filter((r) => r.change > 0).sort((a, b) => b.change - a.change)[0];
  const down = withChange.filter((r) => r.change < 0).sort((a, b) => a.change - b.change)[0];

  cardTopUp.textContent = up ? up.name : '없음';
  cardTopUpRate.textContent = up ? `▲ ${formatRate(up.change)} 올랐어요` : '';
  cardTopDown.textContent = down ? down.name : '없음';
  cardTopDownRate.textContent = down ? `▼ ${formatRate(down.change)} 내렸어요` : '';
}

// 표에 보이는 품목 중 비교 기준보다 내린 식재료를 많이 내린 순으로 다섯 개까지.
// 같은 품목이 여러 행이면 가장 많이 내린 행 하나만.
function castedItems() {
  const best = new Map();
  for (const r of filteredRows()) {
    if (r.change === null || Math.round(r.change * 10) / 10 >= 0) continue;
    const prev = best.get(r.name);
    if (!prev || r.change < prev.change) best.set(r.name, r);
  }
  return [...best.values()]
    .sort((a, b) => a.change - b.change)
    .slice(0, CASTER_MAX)
    .map((r) => ({ name: r.name, drop: formatRate(r.change).replace('%', '') }));
}

function showCaster(text, kind = '') {
  casterText.textContent = text;
  casterText.classList.toggle('muted', kind === 'muted');
  casterText.classList.toggle('error', kind === 'error');
}

async function recommendMeal() {
  const items = castedItems();
  casterItems.replaceChildren();
  casterMeta.hidden = true;
  if (!items.length) {
    showCaster('내린 품목이 없습니다', 'muted');
    return;
  }

  showCaster('밥상을 차리는 중…', 'muted');
  casterButton.disabled = true;
  try {
    const res = await fetch(AI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ basis: BASES[basis].label, items }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.text) throw new Error(json?.error || `HTTP ${res.status}`);

    showCaster(json.text);
    casterItems.replaceChildren(...items.map((it) => {
      const li = document.createElement('li');
      li.textContent = `${it.name} ▼${it.drop}%`;
      return li;
    }));
    casterMeta.hidden = false;
  } catch (err) {
    showCaster(`추천을 받지 못했습니다 (${err.message})`, 'error');
  } finally {
    casterButton.disabled = false;
  }
}

function render() {
  const list = filteredRows();
  compareHeader.textContent = `${BASES[basis].label} 가격`;
  renderCards(list);

  const trs = list.map((r) => {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.append(r.name);
    if (r.variety) {
      const span = document.createElement('span');
      span.className = 'vrty';
      span.textContent = ` · ${r.variety}`;
      nameTd.append(span);
    }
    tr.append(
      cell(r.category),
      nameTd,
      cell(r.se),
      cell(r.grade),
      cell(r.unit),
      cell(formatWon(r.today), 'num'),
      cell(formatWon(r.compare), 'num'),
      changeCell(r.change),
    );
    return tr;
  });

  tbody.replaceChildren(...trs);
  if (!rows.length) {
    showStatus(`${source}: 받은 품목이 없습니다`);
  } else {
    showStatus(list.length
      ? `${source} · ${rows.length}개 중 ${list.length}개 품목`
      : '조건에 맞는 품목이 없습니다');
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  load();
});
liveForm.addEventListener('submit', (e) => {
  e.preventDefault();
  loadLive();
});
casterButton.addEventListener('click', recommendMeal);
itemInput.addEventListener('input', render);
categorySelect.addEventListener('change', render);
seSelect.addEventListener('change', render);
sortSelect.addEventListener('change', render);
basisButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    basis = btn.dataset.basis;
    basisButtons.forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    render();
  });
});

keyInput.value = readSavedKey();
load();
