'use strict';

// ── Login ─────────────────────────────────────────────────────
const CREDENTIALS = { username: 'jenda', password: '1234' };

function checkLogin() {
  return sessionStorage.getItem('tj_auth') === '1';
}

document.getElementById('login-btn').onclick = doLogin;
document.getElementById('login-pass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('login-user').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-pass').focus(); });

function doLogin() {
  const user = document.getElementById('login-user').value.trim();
  const pass = document.getElementById('login-pass').value;
  if (user === CREDENTIALS.username && pass === CREDENTIALS.password) {
    sessionStorage.setItem('tj_auth', '1');
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
const MISTAKE_TAGS = ['FOMO','Revenge trade','Přeskočil SL','Špatný vstup','Předčasný výstup','Overtrading','Bez plánu','Špatné RR','Přidával do ztráty','Špatný timeframe'];
const MONTHS = ['Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];
const MONTHS_EN = ['January','February','March','April','May','June','July','August','September','October','November','December'];

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
  const { data, error } = await sb.from('trades').select('key, trade_list');
  if (error) { console.error('Load error:', error); return; }
  trades = {};
  (data || []).forEach(row => {
    trades[row.key] = { tradeList: row.trade_list || [] };
  });
}

async function saveDayData(key, dayData) {
  trades[key] = dayData;
  const { error } = await sb.from('trades').upsert({ key, trade_list: dayData.tradeList }, { onConflict: 'key' });
  if (error) console.error('Save error:', error);
}

async function uploadScreenshot(file, dateKey, tf) {
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `${dateKey}/${tf}_${Date.now()}.${ext}`;
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
function dk(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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
  document.getElementById('cal-grid').innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--muted);font-size:13px">Loading…</div>';
  await loadData();
  render();
  requestAnimationFrame(setSquareCells);
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
    wr:      total>0 ? Math.round(wins/total*100)+'%' : '—',
    avgRR:   rrN>0   ? (rrSum/rrN).toFixed(2)+'R'     : '—',
    totalRR: rrN>0   ? (rrSum >= 0 ? '+' : '') + Math.round(rrSum*100)/100 + 'R' : '—',
  };
}

function renderSidebar() {
  const nextBtn = document.getElementById('next');
  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth();
  nextBtn.disabled = isCurrentMonth;

  const prefix = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}`;
  const s = computeStats(k => k.startsWith(prefix));
  let monthPnl = 0;
  Object.entries(trades).forEach(([k, _]) => {
    if (!k.startsWith(prefix)) return;
    normalizeDayData(k).tradeList.forEach(t => { monthPnl += t.pnl ?? 0; });
  });

  document.getElementById('sidebar').innerHTML = `
    <div class="sidebar-title">Statistics <span style="text-transform:none;font-weight:400;letter-spacing:0">for ${MONTHS_EN[viewMonth]}</span></div>
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
      <div class="stat-val ${monthPnl >= 0 ? 'green' : 'red'}">${monthPnl >= 0 ? '+' : ''}$${monthPnl.toLocaleString()}</div>
    </div>` : ''}
    <div style="margin-top:auto;padding-top:10px;">
      <button onclick="doLogout()" style="width:100%;padding:6px 0;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);cursor:pointer;font-family:'Plus Jakarta Sans',sans-serif;transition:all .15s" onmouseover="this.style.borderColor='var(--border2)';this.style.color='var(--text)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--muted)'">Odhlásit se</button>
    </div>
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
    const pnlTxt = totalPnl !== 0 && displayMode !== 'rr' ? `<div class="cell-rr" style="color:${totalPnl>0?'var(--win)':'var(--loss)'}">${totalPnl>0?'+':''}$${totalPnl}</div>` : '';
    const tradeCount = dayData.tradeList.filter(t => t.result).length;
    const countBadge = tradeCount > 1 ? `<div style="font-size:9px;color:var(--muted2);margin-top:1px">${tradeCount} trades</div>` : '';

    const cell = document.createElement('div');
    cell.className = cls;
    cell.innerHTML = `<div class="cell-num">${d}</div>${badge}${rrTxt}${pnlTxt}${countBadge}<div class="tf-dots">${dots}</div>`;
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
function openModal(key, date) {
  openKey = key;
  let dayData = normalizeDayData(key);
  if (dayData.tradeList.length === 0) dayData.tradeList.push({ result: null, rr: null, pnl: null, screenshots: {}, notes: {}, finalNotes: '' });

  let activeIdx = 0;

  document.getElementById('modal-date').textContent =
    `${MONTHS_EN[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;

  const body = document.getElementById('modal-body');

  function renderModal() {
    body.innerHTML = '';

    const tradesSection = document.createElement('div');
    tradesSection.style.cssText = 'display:flex;flex-direction:column;gap:5px;';

    const listLabel = document.createElement('div');
    listLabel.style.cssText = 'font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);';
    listLabel.textContent = dayData.tradeList.length > 1 ? 'Trades this day' : 'Trade';
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
        ? `<span class="trade-item-pnl" style="color:${tr.pnl>0?'var(--win)':'var(--loss)'}">${tr.pnl>0?'+':''}$${tr.pnl}</span>`
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
      edTitle.textContent = `Trade #${activeIdx + 1}`;
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
        <span class="rr-lbl">RR</span>
        <input class="rr-inp" id="rr-inp" type="number" step="0.1" min="0" placeholder="${selResult === 'loss' ? '1.0' : '0.0'}" value="${selResult === 'loss' ? (tr.rr ?? '') : (tr.rr || '')}"/>
        <span class="rr-lbl" style="margin-left:6px">$</span>
        <input class="rr-inp" id="pnl-inp" type="number" step="1" placeholder="0" value="${tr.pnl ?? ''}"/>
      </div>
    `;
    body.appendChild(resRow);

    function updateBtns() {
      resRow.querySelectorAll('.res-btn').forEach(b => {
        b.className = 'res-btn';
        if (b.dataset.r === selResult) b.classList.add(`sel-${selResult}`);
      });
      const rrInp = document.getElementById('rr-inp');
      if (rrInp) rrInp.placeholder = selResult === 'loss' ? '1.0' : '0.0';
    }
    updateBtns();
    resRow.querySelectorAll('.res-btn').forEach(b => {
      b.onclick = () => { selResult = b.dataset.r; updateBtns(); };
    });

    const tfSplit = document.createElement('div');
    tfSplit.className = 'tf-split';

    const tfSidebar = document.createElement('div');
    tfSidebar.className = 'tf-sidebar';
    tfSidebar.innerHTML = `<div class="tf-sidebar-title">Timeframes</div>`;

    const tfMain = document.createElement('div');
    tfMain.className = 'tf-main';

    function renderTFMain() {
      tfMain.innerHTML = '';
      const uploaded = TFS.filter(tf => tr.screenshots?.[tf]);
      if (uploaded.length === 0) {
        tfMain.innerHTML = `<div class="tf-main-empty"><div class="tf-main-empty-icon"><svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></div><div class="tf-main-empty-txt">Click a timeframe to add a screenshot</div></div>`;
        return;
      }
      const area = document.createElement('div');
      area.className = 'tf-cards-area';
      uploaded.forEach(tf => {
        const note = tr.notes?.[tf] || '';
        const card = document.createElement('div');
        card.className = 'tf-card';
        card.innerHTML = `
          <div class="tf-card-head">
            <div class="tf-label">${tf}</div>
            <button class="tf-del-btn" data-tf="${tf}">✕</button>
          </div>
          <div class="tf-img-wrap" id="wrap-${tf}">
            <img src="${tr.screenshots[tf]}" alt="${tf}"/>
          </div>
          <textarea class="tf-note" id="note-${tf}" placeholder="Notes for ${tf}...">${note}</textarea>
        `;
        area.appendChild(card);
        card.querySelector(`#wrap-${tf}`).onclick = () => openLightbox(tr.screenshots[tf], tf, tr);
        card.querySelector('.tf-del-btn').onclick = (e) => {
          e.stopPropagation();
          const url = tr.screenshots[tf];
          delete tr.screenshots[tf];
          deleteScreenshot(url);
          renderTFButtons();
          renderTFMain();
        };
      });
      tfMain.appendChild(area);
    }

    function renderTFButtons() {
      tfSidebar.innerHTML = `<div class="tf-sidebar-title">Timeframes</div>`;
      TFS.forEach(tf => {
        const hasImg = !!tr.screenshots?.[tf];
        const btn = document.createElement('button');
        btn.className = 'tf-btn' + (hasImg ? ' has-img' : '');
        btn.innerHTML = `<span>${tf}</span><span class="tf-dot-ind"></span>`;
        btn.onclick = () => {
          if (hasImg) { document.getElementById(`wrap-${tf}`)?.scrollIntoView({behavior:'smooth',block:'nearest'}); return; }
          const input = document.createElement('input');
          input.type = 'file'; input.accept = 'image/*';
          input.onchange = async () => {
            const file = input.files[0]; if (!file) return;
            btn.disabled = true;
            btn.querySelector('span').textContent = '↑';
            try {
              const url = await uploadScreenshot(file, key, tf);
              if (!tr.screenshots) tr.screenshots = {};
              tr.screenshots[tf] = url;
              renderTFButtons();
              renderTFMain();
            } catch(e) {
              console.error(e);
              showToast('Upload failed');
            }
            btn.disabled = false;
          };
          input.click();
        };
        tfSidebar.appendChild(btn);
      });
    }

    renderTFButtons();
    renderTFMain();
    tfSplit.appendChild(tfSidebar);
    tfSplit.appendChild(tfMain);
    body.appendChild(tfSplit);

    // Mistake tags
    const mistakeWrap = document.createElement('div');
    mistakeWrap.className = 'mistake-wrap';
    let selMistakes = Array.isArray(tr.mistakes) ? [...tr.mistakes] : [];
    function renderMistakeTags() {
      mistakeWrap.innerHTML = `<div class="final-notes-label">Chyby</div><div class="mistake-tags">${
        MISTAKE_TAGS.map(tag => `<button class="mistake-tag${selMistakes.includes(tag) ? ' active' : ''}" data-tag="${tag}">${tag}</button>`).join('')
      }</div>`;
      mistakeWrap.querySelectorAll('.mistake-tag').forEach(btn => {
        btn.onclick = () => {
          const tag = btn.dataset.tag;
          if (selMistakes.includes(tag)) selMistakes = selMistakes.filter(t => t !== tag);
          else selMistakes.push(tag);
          renderMistakeTags();
        };
      });
    }
    renderMistakeTags();
    body.appendChild(mistakeWrap);

    const finalNotesWrap = document.createElement('div');
    finalNotesWrap.className = 'final-notes-wrap';
    finalNotesWrap.innerHTML = `
      <div class="final-notes-label">Final Notes</div>
      <textarea class="final-notes-inp" id="final-notes" placeholder="Overall trade summary, mistakes, lessons learned...">${tr.finalNotes || ''}</textarea>
    `;
    body.appendChild(finalNotesWrap);

    const addBtn = document.createElement('button');
    addBtn.className = 'add-trade-btn';
    addBtn.textContent = '+ Add trade';
    addBtn.onclick = () => {
      dayData.tradeList.push({ result: null, rr: null, pnl: null, screenshots: {}, notes: {}, finalNotes: '' });
      activeIdx = dayData.tradeList.length - 1;
      renderModal();
    };
    body.appendChild(addBtn);

    const saveRow = document.createElement('div');
    saveRow.className = 'save-row';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.onclick = async () => {
      saveBtn.textContent = 'Saving…';
      saveBtn.disabled = true;
      const rrVal = document.getElementById('rr-inp')?.value;
      const notes = {};
      TFS.forEach(tf => {
        const v = document.getElementById(`note-${tf}`)?.value || '';
        if (v) notes[tf] = v;
      });
      const pnlVal = document.getElementById('pnl-inp')?.value;
      tr.result = selResult;
      tr.rr = rrVal ? parseFloat(rrVal) : (selResult === 'loss' ? 1 : null);
      tr.pnl = pnlVal ? parseFloat(pnlVal) : null;
      tr.notes = notes;
      tr.mistakes = selMistakes;
      tr.finalNotes = document.getElementById('final-notes')?.value || '';
      await saveDayData(key, dayData);
      closeModal();
      render();
      showToast('Saved ✓');
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
function openLightbox(src, tf, tr) {
  const note = tr?.notes?.[tf] || '';
  document.getElementById('lightbox-img').src = src;
  document.getElementById('lightbox-label').textContent = tf;
  const notesEl = document.getElementById('lightbox-notes');
  if (note) {
    notesEl.textContent = note;
    notesEl.classList.remove('empty');
  } else {
    notesEl.textContent = 'No notes for this timeframe.';
    notesEl.classList.add('empty');
  }
  document.getElementById('lightbox').classList.add('open');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}

document.getElementById('lightbox-close').onclick = closeLightbox;
document.getElementById('lightbox').onclick = (e) => {
  if (e.target === document.getElementById('lightbox')) closeLightbox();
};
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeLightbox(); closeModal(); closeTL(); } });

// ── Trades list ───────────────────────────────────────────────
function openTradesList(type, tab, crFrom, crTo) {
  const labels = { win: 'Wins', loss: 'Losses', be: 'Break Even' };
  const prefix = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}`;
  let titleSuffix = '';
  let filterFn;
  if (tab === 'total') {
    titleSuffix = ' — All Time'; filterFn = () => true;
  } else if (tab === 'custom' && crFrom && crTo) {
    const fmt = s => s.split('-').reverse().join('.');
    titleSuffix = ` — ${fmt(crFrom)}–${fmt(crTo)}`; filterFn = k => k >= crFrom && k <= crTo;
  } else {
    titleSuffix = ` — ${MONTHS_EN[viewMonth]}`; filterFn = k => k.startsWith(prefix);
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
    list.innerHTML = `<div class="tl-empty">No records</div>`;
  } else {
    list.innerHTML = items.map(([k]) => {
      const dd = normalizeDayData(k);
      const d = new Date(k);
      const dateStr = `${MONTHS_EN[d.getMonth()].slice(0,3)} ${d.getDate()}, ${d.getFullYear()}`;
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
        const date = new Date(key);
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

// ── Custom Range ──────────────────────────────────────────────
function openCustomRange() {
  const todayStr = dk(now);
  if (!document.getElementById('cr-from').value)
    document.getElementById('cr-from').value = customRangeFrom || todayStr.slice(0,7)+'-01';
  if (!document.getElementById('cr-to').value)
    document.getElementById('cr-to').value = customRangeTo || todayStr;
  document.getElementById('cr-from').max = todayStr;
  document.getElementById('cr-to').max   = todayStr;
  document.getElementById('cr-overlay').classList.add('open');
}

function closeCustomRange() {
  document.getElementById('cr-overlay').classList.remove('open');
}

document.getElementById('cr-x').onclick = closeCustomRange;
document.getElementById('cr-cancel').onclick = closeCustomRange;
document.getElementById('cr-overlay').onclick = e => {
  if (e.target === document.getElementById('cr-overlay')) closeCustomRange();
};
document.getElementById('cr-apply').onclick = () => {
  const from = document.getElementById('cr-from').value;
  const to   = document.getElementById('cr-to').value;
  if (!from || !to) { showToast('Fill in both dates'); return; }
  if (from > to) { showToast('"From" must be before "To"'); return; }
  customRangeFrom = from;
  customRangeTo   = to;
  statsPeriod = 'custom';
  closeCustomRange();
  if (activeView === 'stats') renderStats();
  else renderSidebar();
};

// ── Display mode ──────────────────────────────────────────────
document.getElementById('topbar-mode').querySelectorAll('.mode-btn').forEach(btn => {
  btn.onclick = () => {
    displayMode = btn.dataset.m;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.m === displayMode));
    render();
    if (activeView === 'stats') renderStats();
  };
});

// ── View switching ────────────────────────────────────────────
let activeView = 'calendar';
let chartInstances = {};

document.getElementById('tab-calendar').onclick = () => switchView('calendar');
document.getElementById('tab-stats').onclick    = () => switchView('stats');

function switchView(view) {
  activeView = view;
  document.getElementById('tab-calendar').classList.toggle('active', view === 'calendar');
  document.getElementById('tab-stats').classList.toggle('active', view === 'stats');
  document.getElementById('view-calendar').style.display = view === 'calendar' ? '' : 'none';
  document.getElementById('view-stats').style.display    = view === 'stats'    ? '' : 'none';
  if (view === 'stats') renderStats();
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
  const prefix = `${viewYear}-${String(viewMonth+1).padStart(2,'0')}`;
  let filterFn;
  if (statsPeriod === 'month')  filterFn = t => t.key.startsWith(prefix);
  else if (statsPeriod === 'custom' && customRangeFrom && customRangeTo)
    filterFn = t => t.key >= customRangeFrom && t.key <= customRangeTo;
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
  const wr     = total > 0 ? Math.round(wins / total * 100) : 0;

  let rrSum = 0, rrN = 0;
  all.forEach(t => {
    const v = t.result === 'loss' ? -(t.rr ?? 1) : (t.rr ?? 0);
    if (v !== 0) { rrSum += v; rrN++; }
  });

  const byMonth = {};
  all.forEach(t => {
    const m = t.key.slice(0, 7);
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
    return `${MONTHS_EN[parseInt(mo)-1].slice(0,3)} ${y}`;
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
  const pnlKpiVal   = (totalPnl >= 0 ? '+' : '') + '$' + totalPnl.toLocaleString();
  const streakVal   = calcStreak(all);

  const rrKpiHtml = showRR ? `
    <div class="stats-card">
      <div class="stats-card-title">Celkové RR</div>
      <div class="stats-kpi ${rrKpiClass}">${rrKpiVal}</div>
      <div class="stats-kpi-sub">součet všech obchodů</div>
    </div>` : '';

  const pnlKpiHtml = showPnl ? `
    <div class="stats-card">
      <div class="stats-card-title">Celkový P&amp;L</div>
      <div class="stats-kpi ${pnlKpiClass}">${pnlKpiVal}</div>
      <div class="stats-kpi-sub">součet v dolarech</div>
    </div>` : '';

  const rrChartHtml = showRRChart ? `
    <div class="stats-card">
      <div class="stats-card-title">RR po měsících</div>
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
      <button class="stats-period-btn${statsPeriod==='month'?' active':''}" data-p="month">${MONTHS_EN[viewMonth]}</button>
      <button class="stats-period-btn${statsPeriod==='total'?' active':''}" data-p="total">All Time</button>
      <button class="stats-period-btn${statsPeriod==='custom'?' active':''}" data-p="custom">Custom${crLbl ? ': '+crLbl : ''}</button>
    </div>
    <div class="stats-row cols-${kpiCols}">
      <div class="stats-card">
        <div class="stats-card-title">Win Rate</div>
        <div class="stats-kpi blue">${total > 0 ? wr + '%' : '—'}</div>
        <div class="stats-kpi-sub">${total} obchodů celkem</div>
      </div>
      ${rrKpiHtml}
      ${pnlKpiHtml}
      <div class="stats-card">
        <div class="stats-card-title">Série</div>
        <div class="stats-kpi dim" style="display:flex;align-items:center;gap:6px">
          <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="color:#2563eb;flex-shrink:0"><path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/></svg>
          ${streakVal}
        </div>
        <div class="stats-kpi-sub">aktuální série</div>
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

  // Mistake stats
  const mistakeCounts = {};
  all.forEach(t => {
    (t.mistakes || []).forEach(m => { mistakeCounts[m] = (mistakeCounts[m] || 0) + 1; });
  });
  const mistakeEntries = Object.entries(mistakeCounts).sort((a,b) => b[1]-a[1]);
  const mistakeHtml = mistakeEntries.length > 0 ? `
    <div class="stats-row cols-1">
      <div class="stats-card">
        <div class="stats-card-title">Nejčastější chyby</div>
        <div class="mistake-stats">${mistakeEntries.map(([tag, count]) => `
          <div class="mistake-stat-row">
            <div class="mistake-stat-label">${tag}</div>
            <div class="mistake-stat-bar-wrap"><div class="mistake-stat-bar" style="width:${Math.round(count/mistakeEntries[0][1]*100)}%"></div></div>
            <div class="mistake-stat-count">${count}×</div>
          </div>`).join('')}
        </div>
      </div>
    </div>` : '';

  el.innerHTML += mistakeHtml;

  el.querySelectorAll('.stats-period-btn').forEach(btn => {
    btn.onclick = () => {
      if (btn.dataset.p === 'custom') { openCustomRange(); return; }
      statsPeriod = btn.dataset.p;
      renderStats();
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
    chartInstances.donut = new Chart(document.getElementById('chart-donut'), {
      type: 'doughnut',
      data: {
        labels: ['Win', 'Loss', 'Break Even'],
        datasets: [{ data: [wins, losses, bes], backgroundColor: ['#60a5fa', '#1e3a8a', '#bfdbfe'], borderWidth: 2, borderColor: '#f0f1f3' }]
      },
      options: {
        maintainAspectRatio: false,
        cutout: '62%',
        layout: { padding: 8 },
        plugins: {
          legend: { display: false },
          tooltip: { ...tooltipDefaults, callbacks: { label: ctx => `${ctx.label}: ${ctx.raw} (${Math.round(ctx.raw/total*100)}%)` } }
        }
      }
    });
  }

  const monthPnlData = months.map(m => {
    let sum = 0;
    Object.entries(trades).forEach(([k, _]) => {
      if (!k.startsWith(m)) return;
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
          backgroundColor: monthPnlData.map(v => v >= 0 ? 'rgba(37,99,235,0.75)' : 'rgba(96,165,250,0.5)'),
          borderRadius: 4,
        }]
      },
      options: {
        maintainAspectRatio: false,
        scales: {
          x: { ticks: { font, color: '#6b7590' }, grid: { color: gridColor } },
          y: { ticks: { font, color: '#6b7590', callback: v => '$' + v.toLocaleString() }, grid: { color: gridColor } }
        },
        plugins: { legend: { display: false }, tooltip: { ...tooltipDefaults, callbacks: { label: ctx => (ctx.raw >= 0 ? '+' : '') + '$' + ctx.raw.toLocaleString() } } }
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
          backgroundColor: monthRR.map(v => v >= 0 ? 'rgba(37,99,235,0.75)' : 'rgba(96,165,250,0.5)'),
          borderRadius: 4,
        }]
      },
      options: {
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
  return count > 0 ? count + 'W' : '—';
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
