// ── Login ─────────────────────────────────────────────────────
// Přidat dalšího uživatele: { username: 'jmeno', password: 'heslo' }
const USERS = [
  { username: 'jenda', password: '1234' },
  { username: 'erik',  password: '1234' },
  { username: 'adam',  password: '1234' },
];

let currentUser = sessionStorage.getItem('tj_user') || '';

function checkLogin() {
  return sessionStorage.getItem('tj_auth') === '1' && !!currentUser;
}

document.getElementById('login-btn').onclick = doLogin;
document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('login-user').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-pass').focus(); });

function doLogin() {
  const user = document.getElementById('login-user').value.trim().toLowerCase();
  const pass = document.getElementById('login-pass').value;
  const found = USERS.find(u => u.username.toLowerCase() === user && u.password === pass);
  if (found) {
    currentUser = found.username;
    sessionStorage.setItem('tj_auth', '1');
    sessionStorage.setItem('tj_user', currentUser);
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('shell').style.display = '';
    initApp();
  } else {
    document.getElementById('login-err').textContent = 'Špatné přihlašovací údaje';
  }
}

if (checkLogin()) {
  document.getElementById('login-overlay').style.display = 'none';
  document.getElementById('shell').style.display = '';
}

// ── Supabase ──────────────────────────────────────────────────
const SUPABASE_URL = 'https://lvuzzqhwjzgjyddefixr.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx2dXp6cWh3anpnanlkZGVmaXhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NDM3MTEsImV4cCI6MjA5NjQxOTcxMX0.-Z7xBdeqhctm7GvMUNoRRmT6GsLqA_DO2-5CDWystSk';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ── Constants ─────────────────────────────────────────────────
const TFS = ['Daily','4H','1H','30M','15M','5M','3M','1M'];
const MONTHS = ['Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];
const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// ── Settings ──────────────────────────────────────────────────
const SETTINGS_KEY = 'tj_settings_v1';
const DEFAULT_SETTINGS = { currency: 'usd', theme: 'blue' };
let appSettings = { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')) };

function saveSettings() { localStorage.setItem(SETTINGS_KEY, JSON.stringify(appSettings)); }

// ── Exchange rates ────────────────────────────────────────────
let fxRates = { usd: 1, eur: 0.92, czk: 23.0 }; // fallback
async function fetchRates() {
  try {
    const r = await fetch('https://api.frankfurter.app/latest?base=USD&symbols=EUR,CZK');
    const d = await r.json();
    if (d.rates) { fxRates = { usd: 1, eur: d.rates.EUR, czk: d.rates.CZK }; }
  } catch(e) { /* use fallback */ }
}
fetchRates();

function currencySymbol() { return { usd: '$', eur: '€', czk: 'Kč' }[appSettings.currency] || '$'; }
function convertPnl(usdVal) {
  const rate = fxRates[appSettings.currency] || 1;
  return Math.round(usdVal * rate);
}
function fmtPnl(val) {
  const converted = convertPnl(val);
  const sym = currencySymbol();
  const abs = Math.abs(converted).toLocaleString();
  if (appSettings.currency === 'czk') return (val >= 0 ? '+' : '-') + abs + ' ' + sym;
  return (val >= 0 ? '+' : '-') + sym + abs;
}

const DONUT_COLORS = ['#60a5fa','#1e3a8a','#bfdbfe'];
const BAR_POS = 'rgba(37,99,235,0.75)';
const BAR_NEG = 'rgba(96,165,250,0.5)';
function themeColors() { return { donut: DONUT_COLORS, barPos: BAR_POS, barNeg: BAR_NEG }; }

// ── State ─────────────────────────────────────────────────────
let trades = {};
const now = new Date();
let viewYear = now.getFullYear();
let viewMonth = now.getMonth();
let openKey = null;
let sidebarTab = 'month';
let customRangeFrom = null;
let customRangeTo   = null;
let displayMode = 'both';

// ── Supabase data layer ───────────────────────────────────────
async function loadData() {
  const prefix = currentUser + '_';
  const migratedKey = 'tj_migrated_' + currentUser;

  // One-time migration: old keys had no user prefix — skip if already done
  if (!localStorage.getItem(migratedKey)) {
    const { data: oldData } = await sb.from('trades').select('key').like('key', '____-__-__');
    if (oldData && oldData.length > 0) {
      const { data: fullOld } = await sb.from('trades').select('key, trade_list').like('key', '____-__-__');
      const toInsert = (fullOld || []).map(r => ({ key: prefix + r.key, trade_list: r.trade_list }));
      const oldKeys  = (fullOld || []).map(r => r.key);
      await sb.from('trades').upsert(toInsert, { onConflict: 'key' });
      for (const k of oldKeys) await sb.from('trades').delete().eq('key', k);
    }
    localStorage.setItem(migratedKey, '1');
  }

  const pattern = prefix + '____-__-__';
  console.log('[loadData] querying pattern:', pattern);
  const { data, error } = await sb.from('trades').select('key, trade_list').like('key', pattern);
  console.log('[loadData] result:', data, 'error:', error);
  if (error) { console.error('Load error:', error); return; }
  trades = {};
  (data || []).forEach(row => {
    const raw = row.trade_list;
    if (Array.isArray(raw)) {
      trades[row.key] = { tradeList: raw };
    } else if (raw && typeof raw === 'object') {
      trades[row.key] = { tradeList: raw.tradeList || [], starred: raw.starred || false };
    }
  });
  console.log('[loadData] loaded keys:', Object.keys(trades));
}

async function saveDayData(key, dayData) {
  trades[key] = dayData;
  const payload = { tradeList: dayData.tradeList };
  if (dayData.starred) payload.starred = true;
  const { error } = await sb.from('trades').upsert({ key, trade_list: payload }, { onConflict: 'key' });
  if (error) console.error('Save error:', error);
}

async function uploadScreenshot(file, dateKey, tf) {
  const ext = (file.name || 'image').split('.').pop() || 'jpg';
  const rawDate = dkRaw(dateKey);
  const path = `${currentUser}/${rawDate}/${tf}_${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('screenshots').upload(path, file, { upsert: true, contentType: file.type });
  if (error) throw error;
  const { data } = sb.storage.from('screenshots').getPublicUrl(path);
  return data.publicUrl;
}

async function deleteScreenshot(url) {
  try {
    const path = url.split('/screenshots/')[1];
    if (path) await sb.storage.from('screenshots').remove([path]);
  } catch(e) { console.error('Delete screenshot error:', e); }
}

// ── Seed demo data ────────────────────────────────────────────
async function seedDemoData() {
  const results = ['win','win','win','win','win','win','win','loss','loss','loss','be'];
  const rrs = [1.5, 2.0, 2.5, 1.0, 3.0, 1.8, 2.2, null, null, null, null];
  const d = new Date(now);
  const rows = [];
  for (let i = 0; i < 60; i++) {
    while ([0,6].includes(d.getDay())) d.setDate(d.getDate() - 1);
    const key = dk(d);
    if (Math.random() < 0.65) {
      const idx = Math.floor(Math.random() * results.length);
      const res = results[idx];
      const rr  = rrs[idx] ? (rrs[idx] + (Math.random()*0.4-0.2)).toFixed(1)*1 : null;
      const pnl = res === 'win' ? Math.round(50 + Math.random()*200) : res === 'loss' ? -Math.round(50 + Math.random()*150) : 0;
      rows.push({ key, trade_list: [{ result: res, rr, pnl, screenshots: {}, notes: {}, finalNotes: '' }] });
    }
    d.setDate(d.getDate() - 1);
  }
  const { error } = await sb.from('trades').upsert(rows, { onConflict: 'key' });
  if (error) { console.error(error); showToast('Error loading demo'); return; }
  await loadData();
  render();
  showToast('Demo data loaded');
}

async function clearAllData() {
  if (!confirm('Clear all trade data?')) return;
  const { error } = await sb.from('trades').delete().neq('key', '');
  if (error) { console.error(error); showToast('Error clearing data'); return; }
  trades = {};
  render();
  showToast('Data cleared');
}

// ── Helpers ───────────────────────────────────────────────────
// Full key with user prefix: "jenda_2025-06-09"
function dk(d) {
  return `${currentUser}_${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
// Strip user prefix → "2025-06-09"
function dkRaw(key) {
  return key.includes('_') ? key.split('_').slice(1).join('_') : key;
}
// Month prefix with user: "jenda_2025-06"
function monthPrefix(y, m) {
  return `${currentUser}_${y}-${String(m+1).padStart(2,'0')}`;
}

// ── Init ──────────────────────────────────────────────────────
document.getElementById('prev').onclick = () => {
  viewMonth--; if(viewMonth<0){viewMonth=11;viewYear--;}
  render('left');
};
document.getElementById('next').onclick = () => {
  const nextM = viewMonth === 11 ? 0 : viewMonth + 1;
  const nextY = viewMonth === 11 ? viewYear + 1 : viewYear;
  if (nextY > now.getFullYear() || (nextY === now.getFullYear() && nextM > now.getMonth())) return;
  viewMonth = nextM; viewYear = nextY; render('right');
};
document.getElementById('modal-x').onclick = closeModal;
document.getElementById('overlay').onclick = e => { if(e.target===document.getElementById('overlay')) closeModal(); };

function setSquareCells() {
  const grid = document.getElementById('cal-grid');
  if (!grid) return;
  const gridW = grid.getBoundingClientRect().width;
  if (!gridW) return;
  const colW = (gridW - 4 * 3) / 5;
  grid.style.gridAutoRows = Math.round(colW) + 'px';
}
window.addEventListener('resize', () => requestAnimationFrame(setSquareCells));

async function initApp() {
  document.getElementById('cal-grid').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted);font-size:13px">Načítám…</div>';
  await loadData();
  render();
  requestAnimationFrame(setSquareCells);
  setTimeout(initAnimControls, 50);
  initUserBtn();
}

if (checkLogin()) initApp();

// ── Render ────────────────────────────────────────────────────
function render(dir) {
  document.getElementById('month-label').textContent = `${MONTHS[viewMonth]} ${viewYear}`;
  renderSidebar();
  renderDayNames();
  renderGrid(dir);
  requestAnimationFrame(setSquareCells);
}

function renderDayNames() {
  const weekdays = ['Po','Út','St','Čt','Pá'];
  document.getElementById('day-names').innerHTML = weekdays.map(d => `<div class="day-name">${d}</div>`).join('');
}

function computeStats(filterFn) {
  let wins=0, losses=0, bes=0, rrSum=0, rrN=0;
  Object.entries(trades).forEach(([k, raw]) => {
    if (!filterFn(k)) return;
    const dayData = normalizeDayData(k);
    (dayData.tradeList || []).forEach(t => {
      if (t.result==='win')  wins++;
      if (t.result==='loss') losses++;
      if (t.result==='be')   bes++;
      const r = t.result === 'loss' ? -(t.rr ?? 1) : parseFloat(t.rr);
      if (!isNaN(r) && r !== 0) { rrSum+=r; rrN++; }
    });
  });
  const total = wins+losses+bes;
  return {
    wins, losses, bes, total,
    wr:      total>0 ? Math.round((wins+bes)/total*100)+'%' : '—',
    avgRR:   rrN>0   ? (rrSum/rrN).toFixed(2)+'R'     : '—',
    totalRR: rrN>0   ? (rrSum >= 0 ? '+' : '') + Math.round(rrSum*100)/100 + 'R' : '—',
  };
}

function renderSidebar() {
  const nextBtn = document.getElementById('next');
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();
  nextBtn.disabled = isCurrentMonth;

  const prefix = monthPrefix(viewYear, viewMonth);
  const s = computeStats(k => k.startsWith(prefix));
  let monthPnl = 0;
  Object.entries(trades).forEach(([k, _]) => {
    if (!k.startsWith(prefix)) return;
    normalizeDayData(k).tradeList.forEach(t => { monthPnl += t.pnl ?? 0; });
  });

  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-title">Statistiky <span style="text-transform:none;font-weight:400;letter-spacing:0">${MONTHS[viewMonth]}</span></div>
    <div class="stat-block">
      <div class="stat-label">Win Rate</div>
      <div class="stat-val blue">${s.wr}</div>
    </div>
    <div class="sep"></div>
    <div class="stat-block clickable" id="sb-win">
      <div class="stat-label">Wins</div>
      <div class="stat-val green">${s.wins}</div>
    </div>
    <div class="stat-block clickable" id="sb-loss">
      <div class="stat-label">Losses</div>
      <div class="stat-val red">${s.losses}</div>
    </div>
    <div class="stat-block clickable" id="sb-be">
      <div class="stat-label">Break Even</div>
      <div class="stat-val dim">${s.bes}</div>
    </div>
    <div class="sep"></div>
    <div class="stat-block">
      <div class="stat-label">Total Trades</div>
      <div class="stat-val dim">${s.total}</div>
    </div>
    ${displayMode !== 'pnl' ? `
    <div class="stat-block">
      <div class="stat-label">Total RR</div>
      <div class="stat-val blue">${s.totalRR}</div>
    </div>` : ''}
    ${displayMode !== 'rr' ? `
    <div class="stat-block">
      <div class="stat-label">P&L</div>
      <div class="stat-val ${monthPnl >= 0 ? 'green' : 'red'}">${fmtPnl(monthPnl)}</div>
    </div>` : ''}
  `;
  document.getElementById('sb-win')?.addEventListener('click',  () => openTradesList('win',  'month', null, null));
  document.getElementById('sb-loss')?.addEventListener('click', () => openTradesList('loss', 'month', null, null));
  document.getElementById('sb-be')?.addEventListener('click',   () => openTradesList('be',   'month', null, null));

  document.querySelectorAll('.stat-val').forEach(el => {
    el.style.animation = 'none';
    void el.offsetWidth;
    el.style.animation = 'stat-fade .3s ease both';
  });
}

function renderGrid(dir) {
  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';
  if (dir) {
    grid.classList.remove('anim-left', 'anim-right');
    void grid.offsetWidth;
    grid.classList.add(dir === 'right' ? 'anim-right' : 'anim-left');
  }
  const todayKey = dk(now);
  const first = new Date(viewYear, viewMonth, 1);
  const daysInMonth = new Date(viewYear, viewMonth+1, 0).getDate();

  const firstDow = (first.getDay() + 6) % 7;
  const offset = firstDow >= 5 ? 0 : firstDow;

  const slots = [];
  for (let i = 0; i < offset; i++) slots.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(viewYear, viewMonth, d);
    const dow = (date.getDay() + 6) % 7;
    if (dow < 5) slots.push(d);
  }
  const totalSlots = Math.max(25, Math.ceil(slots.length / 5) * 5);
  while (slots.length < totalSlots) slots.push(null);

  slots.forEach(d => {
    if (d === null) {
      const el = document.createElement('div');
      el.className = 'cell empty';
      grid.appendChild(el);
      return;
    }
    const date = new Date(viewYear, viewMonth, d);
    const key  = dk(date);
    const dayData = normalizeDayData(key);
    const summary = computeDaySummary(dayData);
    const isFuture = date > now && key !== todayKey;
    const isToday  = key === todayKey;

    let cls = 'cell';
    if (!isFuture) cls += ' clickable';
    if (isToday)   cls += ' today';
    if (summary.result === 'win')  cls += ' win';
    if (summary.result === 'loss') cls += ' loss';
    if (summary.result === 'be')   cls += ' be';
    if (isFuture)  cls += ' other-month';

    const allScreenshots = {};
    (dayData.tradeList || []).forEach(tr => Object.assign(allScreenshots, tr.screenshots || {}));
    const dots  = TFS.map(tf => `<div class="tf-dot${allScreenshots[tf] ? ' on' : ''}"></div>`).join('');
    const badge = summary.result ? `<div class="cell-badge ${summary.result}">${summary.result==='be'?'BE':summary.result.toUpperCase()}</div>` : '';
    const rrTxt = summary.rr != null && displayMode !== 'pnl' ? `<div class="cell-rr">${summary.rr > 0 ? '+' : ''}${summary.rr}R</div>` : '';
    const totalPnl = (dayData.tradeList || []).reduce((s, t) => s + (t.pnl ?? 0), 0);
    const pnlTxt = totalPnl !== 0 && displayMode !== 'rr' ? `<div class="cell-rr" style="color:${totalPnl>0?'var(--win)':'var(--loss)'}">${fmtPnl(totalPnl)}</div>` : '';
    const tradeCount = dayData.tradeList.filter(t => t.result).length;
    const countBadge = tradeCount > 1 ? `<div style="font-size:9px;color:var(--muted2);margin-top:1px">${tradeCount} trades</div>` : '';

    const starMark = dayData.starred ? '<div class="cell-star">★</div>' : '';
    const cell = document.createElement('div');
    cell.className = cls;
    cell.innerHTML = `<div class="cell-num">${d}</div>${starMark}${badge}${rrTxt}${pnlTxt}${countBadge}<div class="tf-dots">${dots}</div>`;
    if (!isFuture) cell.onclick = () => openModal(key, date);
    grid.appendChild(cell);
  });
}

// ── Data helpers ──────────────────────────────────────────────
function normalizeDayData(key) {
  const raw = trades[key];
  if (!raw) return { tradeList: [] };
  if (Array.isArray(raw.tradeList)) return raw;
  return {
    tradeList: [{
      result: raw.result || null,
      rr: raw.rr || null,
      pnl: raw.pnl ?? null,
      screenshots: raw.screenshots || {},
      notes: raw.notes || {},
      finalNotes: raw.finalNotes || ''
    }]
  };
}

function computeDaySummary(dayData) {
  const list = dayData.tradeList || [];
  if (list.length === 0) return { result: null, rr: null };
  const results = list.map(t => t.result).filter(Boolean);
  if (results.length === 0) return { result: null, rr: null };
  let result;
  if (results.includes('loss')) result = 'loss';
  else if (results.every(r => r === 'win')) result = 'win';
  else if (results.every(r => r === 'be')) result = 'be';
  else result = 'win';
  const rrVals = list.map(t => {
    if (t.result === 'loss') return -(t.rr ?? 1);
    return t.rr ?? 0;
  });
  const totalRR = rrVals.reduce((a,b) => a+b, 0);
  return { result, rr: totalRR !== 0 ? Math.round(totalRR * 100) / 100 : null };
}

// ── Modal ─────────────────────────────────────────────────────
function openModal(key, date, opts = {}) {
  const { title: _title = null, initialData = null, saveFunc = null, afterSave = null, hideAddTrade = false } = opts;
  openKey = key;
  let dayData = initialData || normalizeDayData(key);
  if (dayData.tradeList.length === 0) dayData.tradeList.push({ result: null, rr: null, pnl: null, screenshots: {}, notes: {}, finalNotes: '' });

  let activeIdx = 0;

  document.getElementById('modal-date').textContent = _title || `${date.getDate()}. ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;

  // Star button — only for calendar days (not BT)
  const starBtn = document.getElementById('modal-star');
  if (starBtn) {
    if (date) {
      starBtn.style.display = '';
      const updateStar = () => {
        starBtn.textContent = dayData.starred ? '★' : '☆';
        starBtn.classList.toggle('active', !!dayData.starred);
      };
      updateStar();
      starBtn.onclick = () => {
        dayData.starred = !dayData.starred;
        updateStar();
        (saveFunc ? saveFunc(dayData) : saveDayData(key, dayData)).then(() => render());
      };
    } else {
      starBtn.style.display = 'none';
    }
  }

  const body = document.getElementById('modal-body');
  let autoSaveTimer = null;
  let _autoSaveListener = null;

  function renderModal() {
    if (_autoSaveListener) { body.removeEventListener('input', _autoSaveListener); _autoSaveListener = null; }
    body.innerHTML = '';

    const tradesSection = document.createElement('div');
    tradesSection.style.cssText = 'display:flex;flex-direction:column;gap:5px;';

    const listLabel = document.createElement('div');
    listLabel.style.cssText = 'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);';
    listLabel.textContent = dayData.tradeList.length > 1 ? 'Obchody' : 'Obchod';
    tradesSection.appendChild(listLabel);

    const tradesList = document.createElement('div');
    tradesList.className = 'trades-list';

    dayData.tradeList.forEach((tr, i) => {
      const item = document.createElement('div');
      item.className = 'trade-item' + (i === activeIdx ? ' active' : '');
      const badgeCls = tr.result || 'none';
      const badgeTxt = tr.result ? (tr.result === 'be' ? 'BE' : tr.result.toUpperCase()) : '—';
      const rrDisplay = tr.result === 'loss'
        ? `-${tr.rr ?? 1}R`
        : (tr.rr ? `+${tr.rr}R` : '');
      const pnlDisplay = tr.pnl != null && tr.pnl !== 0
        ? `<span class="trade-item-pnl" style="color:${tr.pnl>0?'var(--win)':'var(--loss)'}">${fmtPnl(tr.pnl)}</span>`
        : '';
      item.innerHTML = `
        <span class="trade-item-num">#${i+1}</span>
        <span class="trade-item-badge ${badgeCls}">${badgeTxt}</span>
        ${displayMode !== 'pnl' ? `<span class="trade-item-rr">${rrDisplay}</span>` : ''}
        ${displayMode !== 'rr' ? pnlDisplay : ''}
        ${dayData.tradeList.length > 1 ? `<button class="trade-item-del" data-i="${i}">✕</button>` : ''}
      `;
      item.addEventListener('click', (e) => {
        if (e.target.classList.contains('trade-item-del')) return;
        activeIdx = i;
        renderModal();
      });
      const delBtn = item.querySelector('.trade-item-del');
      if (delBtn) {
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          dayData.tradeList.splice(i, 1);
          if (activeIdx >= dayData.tradeList.length) activeIdx = dayData.tradeList.length - 1;
          saveDayData(key, dayData);
          renderModal();
          render();
        });
      }
      tradesList.appendChild(item);
    });

    tradesSection.appendChild(tradesList);
    body.appendChild(tradesSection);

    const tr = dayData.tradeList[activeIdx];

    if (dayData.tradeList.length > 1) {
      const edTitle = document.createElement('div');
      edTitle.className = 'trade-editor-title';
      edTitle.textContent = `Obchod #${activeIdx + 1}`;
      body.appendChild(edTitle);
    }

    const resRow = document.createElement('div');
    resRow.className = 'res-row';
    let selResult = tr.result || null;

    resRow.innerHTML = `
      <div class="res-btns">
        <button class="res-btn" data-r="win">Win</button>
        <button class="res-btn" data-r="loss">Loss</button>
        <button class="res-btn" data-r="be">Break Even</button>
      </div>
      <div class="rr-block">
        <span class="rr-lbl">$</span>
        <input class="rr-inp" id="pnl-inp" type="number" step="1" placeholder="0" value="${tr.pnl != null ? Math.abs(tr.pnl) : ''}" style="width:100px"/>
        <span class="rr-lbl" style="margin-left:6px">RR</span>
        <input class="rr-inp" id="rr-inp" type="number" step="0.1" min="0" placeholder="${selResult === 'loss' ? '1.0' : '0.0'}" value="${selResult === 'loss' ? (tr.rr ?? '') : (tr.rr || '')}"/>
      </div>
    `;
    body.appendChild(resRow);

    function updateBtns() {
      resRow.querySelectorAll('.res-btn').forEach(b => {
        b.className = 'res-btn';
        if (b.dataset.r === selResult) b.classList.add(`sel-${selResult}`);
      });
      const rrInp = document.getElementById('rr-inp');
      const pnlInp = document.getElementById('pnl-inp');
      const isBe = selResult === 'be';
      if (rrInp) { rrInp.placeholder = selResult === 'loss' ? '1.0' : '0.0'; rrInp.disabled = isBe; rrInp.style.opacity = isBe ? '.35' : ''; if (isBe) rrInp.value = ''; }
      if (pnlInp) { pnlInp.disabled = isBe; pnlInp.style.opacity = isBe ? '.35' : ''; if (isBe) pnlInp.value = ''; }
    }
    updateBtns();
    resRow.querySelectorAll('.res-btn').forEach(b => {
      b.onclick = () => { selResult = selResult === b.dataset.r ? null : b.dataset.r; updateBtns(); };
    });

    const tfSplit = document.createElement('div');
    tfSplit.className = 'tf-split';

    const tfSidebar = document.createElement('div');
    tfSidebar.className = 'tf-sidebar';
    tfSidebar.innerHTML = `<div class="tf-sidebar-title">Timeframy</div>`;

    const tfMain = document.createElement('div');
    tfMain.className = 'tf-main';

    // Normalize screenshots to always be arrays
    // Each screenshot stored as {url, instrument} or legacy string
    function tfItems(tf) {
      const s = tr.screenshots?.[tf];
      if (!s) return [];
      const arr = Array.isArray(s) ? s : [s];
      return arr.map(item => typeof item === 'string' ? { url: item, instrument: null } : item);
    }
    function tfUrls(tf) { return tfItems(tf).map(x => x.url); }
    function tfHasAny(tf) { return tfItems(tf).length > 0; }

    function renderTFMain() {
      tfMain.innerHTML = '';
      const uploaded = TFS.filter(tf => tfHasAny(tf));
      if (uploaded.length === 0) {
        tfMain.innerHTML = `<div class="tf-main-empty"><div class="tf-main-empty-icon"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div><div class="tf-main-empty-txt">Klikni na timeframe nebo vlož Ctrl+V</div></div>`;
        return;
      }
      const area = document.createElement('div');
      area.className = 'tf-cards-area';
      uploaded.forEach(tf => {
        const note = tr.notes?.[tf] || '';
        const urls = tfUrls(tf);

        const items2 = tfItems(tf);
        items2.forEach((item, i) => {
          const { url, instrument } = item;
          const noteKey = i === 0 ? tf : `${tf}_${i}`;
          const mentorKey = noteKey + '_m';
          const cardNote = tr.notes?.[noteKey] || '';
          const mentorNote = tr.notes?.[mentorKey] || '';
          const card = document.createElement('div');
          card.className = 'tf-card';
          const tfLabel = items2.length > 1 ? `${tf} <span style="opacity:.5;font-weight:400">#${i+1}</span>` : tf;
          const instBadge = instrument ? `<span class="tf-inst-badge tf-inst-badge-${instrument.toLowerCase()}">${instrument}</span>` : '';
          card.innerHTML = `
            <div class="tf-card-head">
              <div class="tf-label">${tfLabel}${instBadge}</div>
              <button class="tf-img-del">✕</button>
            </div>
            <div class="tf-img-wrap" id="wrap-${tf}-${i}">
              <img src="${url}" alt="${tf}"/>
            </div>
            <div class="tf-notes-row">
              <div class="tf-note-block">
                <div class="tf-note-lbl">Já</div>
                <textarea class="tf-note" id="note-${noteKey}" placeholder="Moje poznámky...">${cardNote}</textarea>
              </div>
              <div class="tf-note-block">
                <div class="tf-note-lbl">Mentor</div>
                <textarea class="tf-note" id="note-${mentorKey}" placeholder="Poznámky mentora...">${mentorNote}</textarea>
              </div>
            </div>
          `;
          area.appendChild(card);

          card.querySelector('.tf-img-wrap').onclick = () => {
            // Build all slides from current trade
            const slides = [];
            TFS.forEach(t => {
              tfItems(t).forEach((it, ii) => {
                const nk = ii === 0 ? t : `${t}_${ii}`;
                const lbl = tfItems(t).length > 1 ? `${t} #${ii+1}` : t;
                slides.push({ src: it.url, label: lbl, note: tr.notes?.[nk] || '', mentorNote: tr.notes?.[nk + '_m'] || '' });
              });
            });
            openLightbox(url, slides);
          };

          card.querySelector('.tf-img-del').onclick = (e) => {
            e.stopPropagation();
            const items3 = tfItems(tf);
            deleteScreenshot(items3[i].url);
            items3.splice(i, 1);
            if (items3.length > 0) tr.screenshots[tf] = items3;
            else delete tr.screenshots[tf];
            renderTFButtons(); renderTFMain();
            scheduleAutoSave();
          };
        });
      });
      tfMain.appendChild(area);
    }

    let selectedTF = null;
    let selectedInstrument = null;

    async function uploadImageBlob(blob, tf) {
      const file = new File([blob], `paste_${Date.now()}.png`, { type: blob.type || 'image/png' });
      const btn = tfSidebar.querySelector(`[data-tf="${tf}"]`);
      if (btn) { btn.disabled = true; btn.querySelector('span').textContent = '↑'; }
      try {
        const url = await uploadScreenshot(file, key, tf);
        if (!tr.screenshots) tr.screenshots = {};
        const existing = tfItems(tf);
        tr.screenshots[tf] = [...existing, { url, instrument: selectedInstrument }];
        renderTFButtons();
        renderTFMain();
        scheduleAutoSave();
        showToast(`Screenshot nahrán → ${tf}`);
      } catch(e) {
        console.error(e);
        showToast('Nahrávání selhalo');
      }
      if (btn) { btn.disabled = false; }
    }

    function renderTFButtons() {
      tfSidebar.innerHTML = '';
      // Instrument selector first
      const instWrap = document.createElement('div');
      instWrap.className = 'tf-inst-wrap';
      instWrap.innerHTML = `<div class="tf-sidebar-title">Index</div>`;
      ['NQ','ES'].forEach(inst => {
        const ib = document.createElement('button');
        ib.className = 'tf-inst-btn' + (selectedInstrument === inst ? ' active' : '');
        ib.textContent = inst;
        ib.onclick = () => {
          selectedInstrument = selectedInstrument === inst ? null : inst;
          renderTFButtons();
        };
        instWrap.appendChild(ib);
      });
      tfSidebar.appendChild(instWrap);

      // TF buttons below
      const tfTitle = document.createElement('div');
      tfTitle.className = 'tf-sidebar-title';
      tfTitle.style.marginTop = '10px';
      tfTitle.textContent = 'Timeframy';
      tfSidebar.appendChild(tfTitle);
      TFS.forEach(tf => {
        const hasImg = tfHasAny(tf);
        const btn = document.createElement('button');
        btn.dataset.tf = tf;
        const isSel = selectedTF === tf && !hasImg;
        btn.className = 'tf-btn' + (hasImg ? ' has-img' : '') + (isSel ? ' tf-btn-sel' : '');
        btn.innerHTML = `<span>${tf}</span><span class="tf-dot-ind"></span>`;
        let clickTimer = null;
        btn.onclick = () => {
          if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; return; }
          clickTimer = setTimeout(() => {
            clickTimer = null;
            const wasSelected = selectedTF === tf;
            selectedTF = wasSelected ? null : tf;
            tfSidebar.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('tf-btn-sel'));
            if (!wasSelected) btn.classList.add('tf-btn-sel');
            if (!wasSelected && hasImg) document.getElementById(`imgs-${tf}`)?.scrollIntoView({behavior:'smooth',block:'nearest'});
          }, 220);
        };
        btn.ondblclick = () => {
          if (clickTimer) { clearTimeout(clickTimer); clickTimer = null; }
          if (!selectedInstrument) { showToast('Nejprve vyberte index (NQ / ES)'); return; }
          selectedTF = tf;
          renderTFButtons();
          const input = document.createElement('input');
          input.type = 'file'; input.accept = 'image/*';
          input.onchange = async () => {
            const file = input.files[0]; if (!file) return;
            btn.disabled = true;
            try {
              const url = await uploadScreenshot(file, key, tf);
              if (!tr.screenshots) tr.screenshots = {};
              tr.screenshots[tf] = [...tfItems(tf), { url, instrument: selectedInstrument }];
              selectedTF = null;
              renderTFButtons(); renderTFMain();
              scheduleAutoSave();
            } catch(e) { console.error(e); showToast('Nahrávání selhalo'); }
            btn.disabled = false;
          };
          input.click();
        };
        tfSidebar.appendChild(btn);
      });

    }

    function onModalPaste(e) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (!item.type.startsWith('image/')) continue;
        const blob = item.getAsFile();
        if (!blob) continue;
        let target = selectedTF;
        if (!target) target = TFS.find(tf => !tfHasAny(tf));
        if (!target) target = selectedTF || TFS[0]; // allow adding more to existing
        if (!selectedInstrument) { showToast('Nejprve vyberte index (NQ / ES)'); return; }
        e.preventDefault();
        uploadImageBlob(blob, target);
        return;
      }
    }

    if (!document._tjPasteAttached) {
      document._tjPasteAttached = true;
      document.addEventListener('paste', e => {
        if (!document.getElementById('overlay').classList.contains('open')) return;
        document._tjPasteHandler?.(e);
      });
    }
    document._tjPasteHandler = onModalPaste;

    renderTFButtons();
    renderTFMain();
    tfSplit.appendChild(tfSidebar);
    tfSplit.appendChild(tfMain);
    body.appendChild(tfSplit);

    const finalNotesWrap = document.createElement('div');
    finalNotesWrap.className = 'final-notes-wrap';
    finalNotesWrap.innerHTML = `
      <div class="final-notes-label">Závěrečné poznámky</div>
      <textarea class="final-notes-inp" id="final-notes" placeholder="Celkové shrnutí obchodu, chyby, poučení...">${tr.finalNotes || ''}</textarea>
    `;
    body.appendChild(finalNotesWrap);


    const addBtn = document.createElement('button');
    addBtn.className = 'add-trade-btn';
    addBtn.textContent = '+ Přidat obchod';
    addBtn.onclick = () => {
      dayData.tradeList.push({ result: null, rr: null, pnl: null, screenshots: {}, notes: {}, finalNotes: '' });
      activeIdx = dayData.tradeList.length - 1;
      renderModal();
    };
    if (!hideAddTrade) body.appendChild(addBtn);

    const saveRow = document.createElement('div');
    saveRow.className = 'save-row';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-btn';
    saveBtn.textContent = 'Uložit';
    function collectAndSave() {
      const rrVal = document.getElementById('rr-inp')?.value;
      const notes = {};
      TFS.forEach(tf => {
        const urls2 = tfUrls(tf);
        const count = Math.max(1, urls2.length);
        for (let i = 0; i < count; i++) {
          const noteKey = i === 0 ? tf : `${tf}_${i}`;
          const mentorKey = noteKey + '_m';
          const v = document.getElementById(`note-${noteKey}`)?.value || '';
          const vm = document.getElementById(`note-${mentorKey}`)?.value || '';
          if (v) notes[noteKey] = v;
          if (vm) notes[mentorKey] = vm;
        }
      });
      const pnlVal = document.getElementById('pnl-inp')?.value;
      tr.result = selResult;
      tr.rr = rrVal ? parseFloat(rrVal) : (selResult === 'loss' ? 1 : null);
      const rawPnl = pnlVal ? parseFloat(pnlVal) : null;
      tr.pnl = rawPnl != null ? (selResult === 'loss' ? -Math.abs(rawPnl) : Math.abs(rawPnl)) : null;
      tr.notes = notes;
      tr.finalNotes = document.getElementById('final-notes')?.value || '';
      return saveFunc ? saveFunc(dayData) : saveDayData(key, dayData);
    }

    function scheduleAutoSave() {
      clearTimeout(autoSaveTimer);
      autoSaveTimer = setTimeout(async () => {
        await collectAndSave();
        (afterSave || render)();
      }, 1500);
    }
    _autoSaveListener = scheduleAutoSave;
    body.addEventListener('input', scheduleAutoSave);

    saveBtn.onclick = async () => {
      clearTimeout(autoSaveTimer);
      saveBtn.textContent = 'Saving…';
      saveBtn.disabled = true;
      await collectAndSave();
      closeModal();
      (afterSave || render)();
      showToast('Uloženo ✓');
    };
    saveRow.appendChild(saveBtn);
    body.appendChild(saveRow);
  }

  renderModal();
  document.getElementById('overlay').classList.add('open');
}

function closeModal() {
  document.getElementById('overlay').classList.remove('open');
  openKey = null;
}

// ── Lightbox ──────────────────────────────────────────────────
let _lbSlides = []; // [{src, label, note}]
let _lbIdx = 0;

function openLightbox(src, slides) {
  _lbSlides = slides;
  _lbIdx = slides.findIndex(s => s.src === src);
  if (_lbIdx < 0) _lbIdx = 0;
  _lbShow();
  document.getElementById('lightbox').classList.add('open');
}

function _lbShow() {
  const s = _lbSlides[_lbIdx];
  document.getElementById('lightbox-img').src = s.src;
  document.getElementById('lightbox-label').textContent = s.label;
  const notesEl = document.getElementById('lightbox-notes');
  const hasAny = s.note || s.mentorNote;
  if (hasAny) {
    notesEl.classList.remove('empty');
    notesEl.innerHTML =
      (s.note ? '<div class="lb-note-block"><div class="lb-note-lbl">Já</div><div class="lb-note-txt">' + s.note + '</div></div>' : '') +
      (s.mentorNote ? '<div class="lb-note-block"><div class="lb-note-lbl">Mentor</div><div class="lb-note-txt">' + s.mentorNote + '</div></div>' : '');
  } else {
    notesEl.classList.add('empty');
    notesEl.textContent = 'Žádné poznámky.';
  }
  const total = _lbSlides.length;
  const prevBtn = document.getElementById('lb-prev');
  const nextBtn = document.getElementById('lb-next');
  prevBtn.style.display = total > 1 ? '' : 'none';
  nextBtn.style.display = total > 1 ? '' : 'none';
  prevBtn.disabled = _lbIdx === 0;
  nextBtn.disabled = _lbIdx === total - 1;
  document.getElementById('lb-counter').textContent = total > 1 ? ((_lbIdx + 1) + ' / ' + total) : '';
}



function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}

document.getElementById('lightbox-close').onclick = closeLightbox;
document.getElementById('lb-prev').onclick = (e) => { e.stopPropagation(); if (_lbIdx > 0) { _lbIdx--; _lbShow(); } };
document.getElementById('lb-next').onclick = (e) => { e.stopPropagation(); if (_lbIdx < _lbSlides.length - 1) { _lbIdx++; _lbShow(); } };
document.getElementById('lightbox').onclick = (e) => {
  if (e.target === document.getElementById('lightbox')) closeLightbox();
};
document.addEventListener('keydown', e => {
  if (document.getElementById('lightbox').classList.contains('open')) {
    if (e.key === 'ArrowRight') { if (_lbIdx < _lbSlides.length - 1) { _lbIdx++; _lbShow(); } return; }
    if (e.key === 'ArrowLeft') { if (_lbIdx > 0) { _lbIdx--; _lbShow(); } return; }
  }
  if (e.key === 'Escape') { closeLightbox(); closeModal(); closeTL(); }
});

// ── Trades list ───────────────────────────────────────────────
function openTradesList(type, tab, crFrom, crTo) {
  const labels = { win: 'Wins', loss: 'Losses', be: 'Break Even' };
  const prefix = monthPrefix(viewYear, viewMonth);
  let titleSuffix = '';
  let filterFn;
  if (tab === 'total') {
    titleSuffix = ' — All Time'; filterFn = () => true;
  } else if (tab === 'custom' && crFrom && crTo) {
    const fmt = s => s.split('-').reverse().join('.');
    titleSuffix = ` — ${fmt(dkRaw(crFrom))}–${fmt(dkRaw(crTo))}`; filterFn = k => dkRaw(k) >= dkRaw(crFrom) && dkRaw(k) <= dkRaw(crTo);
  } else {
    titleSuffix = ` — ${MONTHS[viewMonth]}`; filterFn = k => k.startsWith(prefix);
  }
  document.getElementById('tl-title').textContent = labels[type] + titleSuffix;

  const items = Object.entries(trades)
    .filter(([k]) => {
      if (!filterFn(k)) return false;
      const dd = normalizeDayData(k);
      return (dd.tradeList || []).some(t => t.result === type);
    })
    .sort(([a],[b]) => b.localeCompare(a));

  const list = document.getElementById('tl-list');
  if (items.length === 0) {
    list.innerHTML = `<div class="tl-empty">Žádné záznamy</div>`;
  } else {
    list.innerHTML = items.map(([k]) => {
      const dd = normalizeDayData(k);
      const d = new Date(dkRaw(k));
      const dateStr = `${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
      const matching = (dd.tradeList || []).filter(t => t.result === type);
      const rrSum = matching.reduce((s, t) => {
        const v = t.result === 'loss' ? -(t.rr ?? 1) : (t.rr ?? 0);
        return s + v;
      }, 0);
      const rrStr = matching.length ? `${rrSum >= 0 ? '+' : ''}${Math.round(rrSum*100)/100}R` : '';
      const countStr = matching.length > 1 ? ` ×${matching.length}` : '';
      return `<div class="tl-item" data-key="${k}">
        <div class="tl-dot ${type}"></div>
        <div class="tl-date">${dateStr}${countStr}</div>
        ${rrStr ? `<div class="tl-rr">${rrStr}</div>` : ''}
      </div>`;
    }).join('');
    list.querySelectorAll('.tl-item').forEach(el => {
      el.onclick = () => {
        const key = el.dataset.key;
        const date = new Date(dkRaw(key));
        closeTL();
        openModal(key, date);
      };
    });
  }
  document.getElementById('tl-overlay').classList.add('open');
}

function closeTL() {
  document.getElementById('tl-overlay').classList.remove('open');
}

document.getElementById('tl-x').onclick = closeTL;
document.getElementById('tl-overlay').onclick = e => {
  if (e.target === document.getElementById('tl-overlay')) closeTL();
};

// ── Custom Range Calendar ─────────────────────────────────────
let crPickYear = now.getFullYear(), crPickMonth = now.getMonth();
let crPickFrom = null, crPickTo = null, crPickStep = 0; // 0=idle,1=picking start,2=picking end

function openCustomRange() {
  crPickYear = now.getFullYear(); crPickMonth = now.getMonth();
  crPickFrom = customRangeFrom || null;
  crPickTo   = customRangeTo   || null;
  crPickStep = crPickFrom ? 0 : 1;
  renderCrCal();
  document.getElementById('cr-overlay').classList.add('open');
}

function closeCustomRange() {
  document.getElementById('cr-overlay').classList.remove('open');
}

function renderCrCal() {
  const todayStr = dk(now);
  document.getElementById('cr-cal-label').textContent = `${MONTHS[crPickMonth]} ${crPickYear}`;
  document.getElementById('cr-prev').disabled = crPickYear === 2020 && crPickMonth === 0;
  document.getElementById('cr-next').disabled = crPickYear === now.getFullYear() && crPickMonth === now.getMonth();

  // day names
  const dnEl = document.querySelector('.cr-day-names');
  dnEl.innerHTML = ['Po','Út','St','Čt','Pá','So','Ne'].map(d=>`<div class="cr-day-name">${d}</div>`).join('');

  const grid = document.getElementById('cr-grid');
  grid.innerHTML = '';
  const first = new Date(crPickYear, crPickMonth, 1);
  const daysInMonth = new Date(crPickYear, crPickMonth+1, 0).getDate();
  const startDow = (first.getDay() + 6) % 7; // Mon=0
  for (let i = 0; i < startDow; i++) {
    const el = document.createElement('div'); el.className='cr-day cr-day-empty'; grid.appendChild(el);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${crPickYear}-${String(crPickMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isFuture = key > todayStr;
    const el = document.createElement('div');
    let cls = 'cr-day';
    if (isFuture) cls += ' cr-day-future';
    if (key === todayStr) cls += ' cr-day-today';
    if (crPickFrom && crPickTo) {
      if (key === crPickFrom) cls += ' cr-day-start';
      else if (key === crPickTo) cls += ' cr-day-end';
      else if (key > crPickFrom && key < crPickTo) cls += ' cr-day-in-range';
    } else if (crPickFrom && key === crPickFrom) cls += ' cr-day-start cr-day-end';
    el.className = cls;
    el.textContent = d;
    if (!isFuture) el.onclick = () => onCrDayClick(key);
    grid.appendChild(el);
  }

  // sel bar
  const bar = document.getElementById('cr-sel-bar');
  const applyBtn = document.getElementById('cr-apply');
  const fmt = s => { const[y,m,d]=s.split('-'); return `${d}.${m}.${y}`; };
  if (crPickFrom && crPickTo) {
    bar.textContent = `${fmt(crPickFrom)} — ${fmt(crPickTo)}`;
    bar.className = 'cr-sel-bar has-range';
    applyBtn.disabled = false;
  } else if (crPickFrom) {
    bar.textContent = `Od: ${fmt(crPickFrom)} → vyberte konec`;
    bar.className = 'cr-sel-bar';
    applyBtn.disabled = true;
  } else {
    bar.textContent = 'Klikněte na začáteční datum';
    bar.className = 'cr-sel-bar';
    applyBtn.disabled = true;
  }
}

function onCrDayClick(key) {
  if (!crPickFrom || (crPickFrom && crPickTo)) {
    crPickFrom = key; crPickTo = null;
  } else {
    if (key < crPickFrom) { crPickTo = crPickFrom; crPickFrom = key; }
    else crPickTo = key;
  }
  renderCrCal();
}

document.getElementById('cr-prev').onclick = () => {
  crPickMonth--; if (crPickMonth < 0) { crPickMonth=11; crPickYear--; } renderCrCal();
};
document.getElementById('cr-next').onclick = () => {
  crPickMonth++; if (crPickMonth > 11) { crPickMonth=0; crPickYear++; } renderCrCal();
};
document.getElementById('cr-x').onclick = closeCustomRange;
document.getElementById('cr-cancel').onclick = closeCustomRange;
document.getElementById('cr-overlay').onclick = e => {
  if (e.target === document.getElementById('cr-overlay')) closeCustomRange();
};
document.getElementById('cr-apply').onclick = () => {
  if (!crPickFrom || !crPickTo) return;
  customRangeFrom = crPickFrom;
  customRangeTo   = crPickTo;
  statsPeriod = 'custom';
  closeCustomRange();
  if (activeView === 'stats') renderStats();
  else renderSidebar();
};

// ── Display mode (now in settings) ───────────────────────────
function fadeAndRender(cb) {
  const targets = [
    document.getElementById('cal-grid'),
    document.getElementById('sidebar'),
    document.getElementById('stats-inner'),
  ].filter(Boolean);
  targets.forEach(el => el.classList.add('fade-out'));
  setTimeout(() => {
    cb();
    targets.forEach(el => {
      el.classList.remove('fade-out');
      el.classList.add('fade-in');
      setTimeout(() => el.classList.remove('fade-in'), 200);
    });
  }, 150);
}

function applyDisplayMode() {
  fadeAndRender(() => {
    render();
    if (activeView === 'stats') renderStats();
  });
}

// ── View switching ────────────────────────────────────────────
let activeView = 'calendar';
let chartInstances = {};

document.getElementById('tab-calendar').onclick = () => switchView('calendar');
document.getElementById('tab-stats').onclick    = () => switchView('stats');
document.getElementById('tab-saved').onclick    = () => switchView('saved');

function switchView(view) {
  if (view === activeView) return;
  const views = { calendar: 'view-calendar', stats: 'view-stats', saved: 'view-saved' };
  const outEl = document.getElementById(views[activeView]);
  const inEl  = document.getElementById(views[view]);
  activeView = view;
  document.getElementById('tab-calendar').classList.toggle('active', view === 'calendar');
  document.getElementById('tab-stats').classList.toggle('active', view === 'stats');
  document.getElementById('tab-saved').classList.toggle('active', view === 'saved');
  document.getElementById('sidebar').style.display = view === 'saved' ? 'none' : '';
  if (view === 'stats') renderStats();
  if (view === 'saved') renderSaved();
  if (outEl) { outEl.style.opacity = '0'; setTimeout(() => { outEl.style.display = 'none'; }, 200); }
  inEl.style.opacity = '0';
  inEl.style.display = '';
  requestAnimationFrame(() => requestAnimationFrame(() => { inEl.style.opacity = '1'; }));
}

// ── Statistics ────────────────────────────────────────────────
let statsPeriod = 'total';

function getAllTrades() {
  const list = [];
  Object.entries(trades).forEach(([k, _]) => {
    const dd = normalizeDayData(k);
    (dd.tradeList || []).forEach(t => {
      if (t.result) list.push({ key: k, ...t });
    });
  });
  return list.sort((a, b) => a.key.localeCompare(b.key));
}

function renderStats() {
  const prefix = monthPrefix(viewYear, viewMonth);
  const nowPrefix = monthPrefix(now.getFullYear(), now.getMonth());
  let filterFn;
  if (statsPeriod === 'month')  filterFn = t => t.key.startsWith(nowPrefix);
  else if (statsPeriod === 'custom' && customRangeFrom && customRangeTo)
    filterFn = t => dkRaw(t.key) >= customRangeFrom && dkRaw(t.key) <= customRangeTo;
  else filterFn = () => true;

  const all = getAllTrades().filter(filterFn);
  const totalPnl = all.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const hasPnl = all.some(t => t.pnl != null && t.pnl !== 0);

  const crLbl = statsPeriod === 'custom' && customRangeFrom && customRangeTo
    ? (() => { const fmt = s => s.split('-').reverse().join('.'); return `${fmt(customRangeFrom)} – ${fmt(customRangeTo)}`; })()
    : '';
  const wins   = all.filter(t => t.result === 'win').length;
  const losses = all.filter(t => t.result === 'loss').length;
  const bes    = all.filter(t => t.result === 'be').length;
  const total  = all.length;
  const wr     = total > 0 ? Math.round((wins + bes) / total * 100) : 0;

  let rrSum = 0, rrN = 0;
  all.forEach(t => {
    const v = t.result === 'loss' ? -(t.rr ?? 1) : (t.rr ?? 0);
    if (v !== 0) { rrSum += v; rrN++; }
  });

  const byMonth = {};
  all.forEach(t => {
    const m = dkRaw(t.key).slice(0, 7);
    if (!byMonth[m]) byMonth[m] = { wins: 0, losses: 0, bes: 0, rr: 0 };
    if (t.result === 'win')  byMonth[m].wins++;
    if (t.result === 'loss') byMonth[m].losses++;
    if (t.result === 'be')   byMonth[m].bes++;
    const v = t.result === 'loss' ? -(t.rr ?? 1) : (t.rr ?? 0);
    byMonth[m].rr += v;
  });
  const months = Object.keys(byMonth).sort();
  const monthLabels = months.map(m => {
    const [y, mo] = m.split('-');
    return `${MONTHS[parseInt(mo)-1].slice(0,3)} ${y}`;
  });
  const monthRR = months.map(m => Math.round(byMonth[m].rr * 100) / 100);

  const showRR  = displayMode !== 'pnl';
  const showPnl = displayMode !== 'rr' && hasPnl;
  const showRRChart  = months.length > 1 && showRR;
  const showPnlChart = months.length > 1 && showPnl;

  const kpiCols = 2 + (showRR ? 1 : 0) + (showPnl ? 1 : 0);
  let chartCols = 1;
  if (showRRChart)  chartCols++;
  if (showPnlChart) chartCols++;
  if (chartCols > 3) chartCols = 3;

  const rrKpiClass  = rrSum >= 0 ? 'green' : 'red';
  const pnlKpiClass = totalPnl >= 0 ? 'green' : 'red';
  const rrKpiVal    = rrN > 0 ? (rrSum >= 0 ? '+' : '') + Math.round(rrSum*100)/100 + 'R' : '—';
  const pnlKpiVal   = fmtPnl(totalPnl);
  const streakVal   = calcStreak(all);

  const rrKpiHtml = showRR ? `
    <div class="stats-card">
      <div class="stats-card-title">Total R</div>
      <div class="stats-kpi ${rrKpiClass}">${rrKpiVal}</div>
      <div class="stats-kpi-sub">součet RR</div>
    </div>` : '';

  const pnlKpiHtml = showPnl ? `
    <div class="stats-card">
      <div class="stats-card-title">Total P&amp;L</div>
      <div class="stats-kpi ${pnlKpiClass}">${pnlKpiVal}</div>
      <div class="stats-kpi-sub">součet v dolarech</div>
    </div>` : '';

  const rrChartHtml = showRRChart ? `
    <div class="stats-card">
      <div class="stats-card-title">R po měsících</div>
      <div class="chart-wrap-bar"><canvas id="chart-rr"></canvas></div>
    </div>` : '';

  const pnlChartHtml = showPnlChart ? `
    <div class="stats-card">
      <div class="stats-card-title">P&amp;L po měsících</div>
      <div class="chart-wrap-bar"><canvas id="chart-pnl"></canvas></div>
    </div>` : '';

  const el = document.getElementById('stats-inner');
  el.innerHTML = `
    <div class="stats-period-bar">
      <button class="stats-period-btn${statsPeriod==='month'?' active':''}" data-p="month">${MONTHS[now.getMonth()]}</button>
      <button class="stats-period-btn${statsPeriod==='total'?' active':''}" data-p="total">Celkem</button>
      <button class="stats-period-btn${statsPeriod==='custom'?' active':''}" data-p="custom">Vlastní${crLbl ? ': '+crLbl : ''}</button>
    </div>
    <div class="stats-row cols-${kpiCols}">
      <div class="stats-card">
        <div class="stats-card-title">Win Rate</div>
        <div class="stats-kpi blue">${total > 0 ? wr + '%' : '—'}</div>
        <div class="stats-kpi-sub">${total} obchodů</div>
      </div>
      ${rrKpiHtml}
      ${pnlKpiHtml}
      <div class="stats-card">
        <div class="stats-card-title">Win Streak</div>
        <div class="stats-kpi blue">${streakVal}</div>
        <div class="stats-kpi-sub">aktuální streak</div>
      </div>
    </div>
    <div class="stats-row cols-${chartCols}">
      <div class="stats-card">
        <div class="stats-card-title">Výsledky obchodů</div>
        <div class="chart-wrap" style="display:flex;justify-content:center"><div style="width:300px;height:240px;position:relative"><canvas id="chart-donut"></canvas></div></div>
        <div class="chart-legend">
          <div class="chart-legend-item"><div class="chart-legend-dot" style="background:#60a5fa"></div>Win</div>
          <div class="chart-legend-item"><div class="chart-legend-dot" style="background:#1e3a8a"></div>Loss</div>
          <div class="chart-legend-item"><div class="chart-legend-dot" style="background:#bfdbfe"></div>Break Even</div>
        </div>
      </div>
      ${rrChartHtml}
      ${pnlChartHtml}
    </div>
  `;

  el.querySelectorAll('.stats-period-btn').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.p === 'custom') { openCustomRange(); return; }
      statsPeriod = btn.dataset.p;
      const inner = document.getElementById('stats-inner');
      inner.style.opacity = '0';
      setTimeout(() => {
        renderStats();
        requestAnimationFrame(() => requestAnimationFrame(() => { inner.style.opacity = '1'; }));
      }, 200);
    };
  });

  Object.values(chartInstances).forEach(c => c.destroy());
  chartInstances = {};

  const gridColor = 'rgba(0,0,0,0.06)';
  const font = { family: "'Plus Jakarta Sans', sans-serif", size: 11 };
  const tooltipDefaults = {
    backgroundColor: '#0f1117',
    titleColor: '#fff',
    bodyColor: 'rgba(255,255,255,0.75)',
    padding: 10,
    cornerRadius: 6,
    titleFont: { family: "'Plus Jakarta Sans', sans-serif", size: 12, weight: '600' },
    bodyFont: { family: "'Plus Jakarta Sans', sans-serif", size: 11 },
    displayColors: false,
    position: 'nearest',
    yAlign: 'bottom',
    xAlign: 'center',
  };

  if (total > 0) {
    const donutLabelPlugin = {
      id: 'donutLabels',
      afterDatasetDraw(chart) {
        const { ctx, data } = chart;
        const ds = chart.getDatasetMeta(0);
        ds.data.forEach((arc, i) => {
          const val = data.datasets[0].data[i];
          if (!val) return;
          const pct = Math.round(val / total * 100);
          const angle = (arc.startAngle + arc.endAngle) / 2;
          const r = (arc.innerRadius + arc.outerRadius) / 2;
          const x = arc.x + Math.cos(angle) * r;
          const y = arc.y + Math.sin(angle) * r;
          ctx.save();
          ctx.font = `600 11px 'Plus Jakarta Sans', sans-serif`;
          ctx.fillStyle = i === 2 ? '#374151' : '#fff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(pct + '%', x, y);
          ctx.restore();
        });
      }
    };
    chartInstances.donut = new Chart(document.getElementById('chart-donut'), {
      type: 'doughnut',
      data: {
        labels: ['Win', 'Loss', 'Break Even'],
        datasets: [{ data: [wins, losses, bes], backgroundColor: themeColors().donut, borderWidth: 2, borderColor: getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#f0f1f3' }]
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        cutout: '62%',
        layout: { padding: 8 },
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltipDefaults, callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} (${Math.round(ctx.raw/total*100)}%)` } }
        }
      },
      plugins: [donutLabelPlugin]
    });
  }

  const monthPnlData = months.map(m => {
    let sum = 0;
    Object.entries(trades).forEach(([k, _]) => {
      if (!dkRaw(k).startsWith(m)) return;
      normalizeDayData(k).tradeList.forEach(t => { sum += t.pnl ?? 0; });
    });
    return Math.round(sum);
  });

  if (months.length > 1 && displayMode !== 'rr' && hasPnl && document.getElementById('chart-pnl')) {
    chartInstances.pnl = new Chart(document.getElementById('chart-pnl'), {
      type: 'bar',
      data: {
        labels: monthLabels,
        datasets: [{
          label: 'P&L',
          data: monthPnlData,
          backgroundColor: monthPnlData.map(v => v >= 0 ? themeColors().barPos : themeColors().barNeg),
          borderRadius: 4,
        }]
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { font, color: '#6b7590' }, grid: { color: gridColor } },
          y: { ticks: { font, color: '#6b7590', callback: v => fmtPnl(v) }, grid: { color: gridColor } }
        },
        plugins: { legend: { display: false }, tooltip: { ...tooltipDefaults, callbacks: { label: ctx => fmtPnl(ctx.raw) } } }
      }
    });
  }

  if (months.length > 1 && displayMode !== 'pnl' && document.getElementById('chart-rr')) {
    chartInstances.rr = new Chart(document.getElementById('chart-rr'), {
      type: 'bar',
      data: {
        labels: monthLabels,
        datasets: [{
          label: 'RR',
          data: monthRR,
          backgroundColor: monthRR.map(v => v >= 0 ? themeColors().barPos : themeColors().barNeg),
          borderRadius: 4,
        }]
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { font, color: '#6b7590' }, grid: { color: gridColor } },
          y: { ticks: { font, color: '#6b7590', callback: v => v + 'R' }, grid: { color: gridColor } }
        },
        plugins: { legend: { display: false }, tooltip: { ...tooltipDefaults, callbacks: { label: ctx => `${ctx.raw}R` } } }
      }
    });
  }
}

function calcStreak(all) {
  if (all.length === 0) return '—';
  let count = 0;
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i].result === 'win') count++;
    else break;
  }
  return count > 0 ? `${count}<span style="font-size:.6em;font-weight:500;opacity:.7;margin-left:1px">w</span>` : '—';
}

function doLogout() {
  sessionStorage.removeItem('tj_auth');
  location.reload();
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

// ── Settings panel ────────────────────────────────────────────
function openSettings() {
  document.getElementById('settings-overlay').classList.add('open');
  updateSettingsUI();
}
function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}
function updateSettingsUI() {
  document.querySelectorAll('#mode-opts .settings-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.val === displayMode);
  });
  document.querySelectorAll('#currency-opts .settings-opt').forEach(b => {
    b.classList.toggle('active', b.dataset.val === appSettings.currency);
  });
}

document.getElementById('settings-btn').onclick = e => {
  e.stopPropagation();
  document.getElementById('settings-overlay').classList.contains('open') ? closeSettings() : openSettings();
};
document.getElementById('settings-x').onclick = closeSettings;
document.getElementById('settings-overlay').onclick = e => {
  if (e.target === document.getElementById('settings-overlay')) closeSettings();
};
document.querySelectorAll('#mode-opts .settings-opt').forEach(b => {
  b.onclick = () => {
    displayMode = b.dataset.val;
    updateSettingsUI();
    applyDisplayMode();
  };
});
document.querySelectorAll('#currency-opts .settings-opt').forEach(b => {
  b.onclick = () => {
    appSettings.currency = b.dataset.val;
    saveSettings();
    updateSettingsUI();
    fadeAndRender(() => {
      render();
      if (activeView === 'stats') renderStats();
    });
  };
});

// ── User button ───────────────────────────────────────────────
function initUserBtn() {
  const btn      = document.getElementById('user-btn');
  const dropdown = document.getElementById('user-dd-logout') ? document.getElementById('user-btn').parentElement.querySelector('.user-dropdown') : null;
  if (!btn) return;

  const initials = currentUser ? currentUser.slice(0,1).toUpperCase() : '?';
  btn.textContent = initials;

  const dd = document.getElementById('user-dropdown');
  document.getElementById('user-dd-avatar').textContent = initials;
  document.getElementById('user-dd-name').textContent = currentUser;

  // Session start time
  const sessionStart = sessionStorage.getItem('tj_session_start') || Date.now();
  sessionStorage.setItem('tj_session_start', sessionStart);
  const sinceDate = new Date(parseInt(sessionStart));
  document.getElementById('user-dd-since').textContent =
    sinceDate.toLocaleTimeString('cs-CZ', { hour:'2-digit', minute:'2-digit' });

  function updateUserStats() {
    const all = getAllTrades();
    const total = all.length;
    const wins  = all.filter(t => t.result === 'win').length;
    const bes   = all.filter(t => t.result === 'be').length;
    const wr    = total > 0 ? Math.round((wins + bes) / total * 100) + '%' : '—';
    document.getElementById('user-dd-trades').textContent = total || '—';
    document.getElementById('user-dd-wr').textContent = wr;
  }

  btn.onclick = (e) => {
    e.stopPropagation();
    updateUserStats();
    dd.classList.toggle('open');
  };

  document.addEventListener('click', (e) => {
    if (!dd.contains(e.target) && e.target !== btn) dd.classList.remove('open');
  });

  function doLogout() {
    sessionStorage.removeItem('tj_auth');
    sessionStorage.removeItem('tj_user');
    sessionStorage.removeItem('tj_session_start');
    location.reload();
  }
  document.getElementById('user-dd-logout').onclick = doLogout;
}

// ── Calendar border animation controls ───────────────────────
const ANIM_COLORS = [
  { name:'Modrá',   main:'#2563eb', hi:'#93c5fd' },
  { name:'Fialová', main:'#7c3aed', hi:'#c4b5fd' },
  { name:'Zelená',  main:'#16a34a', hi:'#86efac' },
  { name:'Růžová',  main:'#db2777', hi:'#f9a8d4' },
  { name:'Zlatá',   main:'#d97706', hi:'#fde68a' },
  { name:'Bílá',    main:'#e2e8f0', hi:'#ffffff' },
];
const ANIM_KEY = 'tj_anim_v1';
let animSettings = { speed: 10, colorIdx: 0, sparks: 2, on: true,
  ...JSON.parse(localStorage.getItem(ANIM_KEY) || '{}') };

function saveAnimSettings() { localStorage.setItem(ANIM_KEY, JSON.stringify(animSettings)); }

function buildSparkGrad(colorIdx, sparks) {
  const { main, hi } = ANIM_COLORS[colorIdx] || ANIM_COLORS[0];
  const gap = 100 / sparks;
  const w = Math.min(9, gap * 0.28);
  const stops = [];
  for (let i = 0; i < sparks; i++) {
    const c = gap * i + gap / 2;
    stops.push(
      `transparent ${Math.max(0, c - w - 2).toFixed(1)}%`,
      `${main} ${(c - w * 0.4).toFixed(1)}%`,
      `${hi} ${c.toFixed(1)}%`,
      `${main} ${(c + w * 0.4).toFixed(1)}%`,
      `transparent ${Math.min(100, c + w + 2).toFixed(1)}%`
    );
  }
  return `conic-gradient(from var(--angle), transparent 0%, ${stops.join(', ')}, transparent 100%)`;
}

function applyAnimSettings() {
  let st = document.getElementById('cal-anim-style');
  if (!st) { st = document.createElement('style'); st.id = 'cal-anim-style'; document.head.appendChild(st); }
  if (!animSettings.on) {
    st.textContent = '.cal-inner::before { display:none !important; }';
    return;
  }
  const grad = buildSparkGrad(animSettings.colorIdx, animSettings.sparks);
  st.textContent = `.cal-inner::before { background: ${grad} !important; animation-duration: ${animSettings.speed}s !important; }`;
}

function initAnimControls() {
  // Speed slider
  const slider = document.getElementById('anim-speed');
  const valEl  = document.getElementById('anim-speed-val');
  if (!slider) return;
  slider.value = animSettings.speed;
  valEl.textContent = animSettings.speed + 's';
  slider.oninput = () => {
    animSettings.speed = +slider.value;
    valEl.textContent = animSettings.speed + 's';
    saveAnimSettings(); applyAnimSettings();
  };

  // Colors
  const colWrap = document.getElementById('anim-colors');
  ANIM_COLORS.forEach((c, i) => {
    const sw = document.createElement('div');
    sw.className = 'anim-color-swatch' + (i === animSettings.colorIdx ? ' active' : '');
    sw.style.background = `linear-gradient(135deg, ${c.main}, ${c.hi})`;
    sw.title = c.name;
    sw.onclick = () => {
      animSettings.colorIdx = i;
      colWrap.querySelectorAll('.anim-color-swatch').forEach((s,j) => s.classList.toggle('active', j===i));
      saveAnimSettings(); applyAnimSettings();
    };
    colWrap.appendChild(sw);
  });

  // Spark counts
  const cntWrap = document.getElementById('anim-counts');
  [1,2,3,4].forEach(n => {
    const btn = document.createElement('button');
    btn.className = 'anim-count-btn' + (n === animSettings.sparks ? ' active' : '');
    btn.textContent = n;
    btn.onclick = () => {
      animSettings.sparks = n;
      cntWrap.querySelectorAll('.anim-count-btn').forEach(b => b.classList.toggle('active', +b.textContent===n));
      saveAnimSettings(); applyAnimSettings();
    };
    cntWrap.appendChild(btn);
  });

  // On/off
  const onoff = document.getElementById('anim-onoff');
  onoff.textContent = animSettings.on ? 'Zap' : 'Vyp';
  onoff.classList.toggle('active', animSettings.on);
  onoff.onclick = () => {
    animSettings.on = !animSettings.on;
    onoff.textContent = animSettings.on ? 'Zap' : 'Vyp';
    onoff.classList.toggle('active', animSettings.on);
    saveAnimSettings(); applyAnimSettings();
  };

  // Toggle panel
  document.getElementById('anim-ctrl-toggle').onclick = () => {
    document.getElementById('anim-ctrl-panel').classList.toggle('open');
  };

  applyAnimSettings();
}


// ── Backtest ──────────────────────────────────────────────────
const BT_PER_PAGE = 25;
let btCurrentPage = 1;
let btPageCache = {};

function btKey(page) { return currentUser + '_bt_' + page; }

async function loadBTPage(page) {
  if (btPageCache[page]) return btPageCache[page];
  const k = btKey(page);
  const { data } = await sb.from('trades').select('trade_list').eq('key', k).maybeSingle();
  const raw = data?.trade_list;
  const parsed = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : { tradeList: [] };
  if (!parsed.tradeList) parsed.tradeList = [];
  btPageCache[page] = parsed;
  return parsed;
}

async function saveBTPage(page, data) {
  const k = btKey(page);
  btPageCache[page] = data;
  await sb.from('trades').upsert({ key: k, trade_list: data }, { onConflict: 'key' });
}

async function renderBT() {
  const page = btCurrentPage;
  document.getElementById('bt-page-label').textContent = 'Stránka ' + page;
  document.getElementById('bt-prev').disabled = page <= 1;
  const data = await loadBTPage(page);
  const trades = data.tradeList;
  const grid = document.getElementById('bt-grid');
  grid.innerHTML = '';

  for (let i = 0; i < BT_PER_PAGE; i++) {
    const cell = document.createElement('div');
    const tr = trades[i];
    const isNext = i === trades.length && trades.length < BT_PER_PAGE;
    const isFilled = !!tr;
    const isLocked = !isFilled && !isNext;

    cell.className = 'bt-cell' +
      (isFilled ? ' bt-cell-' + (tr.result || 'empty') : '') +
      (isNext ? ' bt-cell-next' : '') +
      (isLocked ? ' bt-cell-locked' : '');

    cell.dataset.idx = i;

    if (isFilled) {
      const num = document.createElement('div');
      num.className = 'bt-cell-num';
      num.textContent = '#' + (i + 1);
      cell.appendChild(num);

      if (tr.result) {
        const badge = document.createElement('div');
        badge.className = 'bt-cell-badge';
        badge.textContent = tr.result === 'be' ? 'BE' : tr.result.toUpperCase();
        cell.appendChild(badge);
      }

      if (tr.rr || tr.pnl) {
        const rr = document.createElement('div');
        rr.className = 'bt-cell-rr';
        if (tr.rr) {
          const sign = tr.result === 'loss' ? '-' : '+';
          rr.textContent = sign + tr.rr + 'R';
        }
        cell.appendChild(rr);
      }
    } else if (isNext) {
      const plus = document.createElement('div');
      plus.className = 'bt-cell-plus';
      plus.textContent = '+';
      cell.appendChild(plus);
    } else {
      const numGhost = document.createElement('div');
      numGhost.className = 'bt-cell-num-ghost';
      numGhost.textContent = '#' + (i + 1);
      cell.appendChild(numGhost);
    }

    if (!isLocked) {
      cell.onclick = () => openBTTrade(page, i, data);
    }

    grid.appendChild(cell);
  }
}

function openBTTrade(page, idx, data) {
  if (!data.tradeList[idx]) {
    data.tradeList[idx] = { result: null, rr: null, pnl: null, screenshots: {}, notes: {}, finalNotes: '' };
  }
  const singleItemData = { tradeList: [data.tradeList[idx]] };

  openModal(btKey(page), null, {
    title: 'Obchod #' + (idx + 1) + ' — stránka ' + page,
    initialData: singleItemData,
    saveFunc: async (d) => {
      data.tradeList[idx] = d.tradeList[0];
      await saveBTPage(page, data);
    },
    afterSave: renderBT,
    hideAddTrade: true,
  });
}

document.getElementById('bt-prev').onclick = async () => {
  if (btCurrentPage > 1) { btCurrentPage--; await renderBT(); }
};
document.getElementById('bt-next').onclick = async () => {
  btCurrentPage++;
  if (!btPageCache[btCurrentPage]) btPageCache[btCurrentPage] = { tradeList: [] };
  await renderBT();
};

function renderSaved() {
  const container = document.getElementById('saved-inner');
  container.innerHTML = '';

  const starredEntries = Object.entries(trades)
    .filter(([, d]) => d.starred)
    .sort(([a], [b]) => b.localeCompare(a));

  if (starredEntries.length === 0) {
    container.innerHTML = '<div class="saved-empty">Žádné uložené dny. Hvězdičkou označ den v detailu záznamu.</div>';
    return;
  }

  starredEntries.forEach(([key, dayData]) => {
    const rawDate = dkRaw(key);
    const [y, m, d] = rawDate.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const summary = computeDaySummary(dayData);
    const totalPnl = (dayData.tradeList || []).reduce((s, t) => s + (t.pnl ?? 0), 0);

    const card = document.createElement('div');
    card.className = 'saved-card';

    const badgeHtml = summary.result
      ? `<div class="cell-badge ${summary.result}">${summary.result === 'be' ? 'BE' : summary.result.toUpperCase()}</div>`
      : '';
    const rrHtml = summary.rr != null && displayMode !== 'pnl'
      ? `<span class="saved-rr">${summary.rr > 0 ? '+' : ''}${summary.rr}R</span>` : '';
    const pnlHtml = totalPnl !== 0 && displayMode !== 'rr'
      ? `<span class="saved-pnl" style="color:${totalPnl > 0 ? 'var(--win)' : 'var(--loss)'}">${fmtPnl(totalPnl)}</span>` : '';

    card.innerHTML = `
      <div class="saved-card-head">
        <span class="saved-star">★</span>
        <span class="saved-date">${d}. ${MONTHS[m - 1]} ${y}</span>
        ${badgeHtml}
        <span class="saved-meta">${rrHtml}${pnlHtml}</span>
      </div>
    `;
    card.onclick = () => openModal(key, date);
    container.appendChild(card);
  });
}
