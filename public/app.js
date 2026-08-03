// ===========================================================================
// Shared helpers
// ===========================================================================
const monthNames = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const dowNames = ["Su","Mo","Tu","We","Th","Fr","Sa"];

function pad2(n){ return String(n).padStart(2,'0'); }
function daysInMonth(y,m){ return new Date(y, m, 0).getDate(); }
function num(v){ const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function fmtMoney(n){ return '₹' + Math.round(n).toLocaleString('en-IN'); }
function safeDiv(a,b){ return b ? (a/b) : null; }
function fmtRatio(n){ return (n===null || !isFinite(n)) ? '—' : n.toFixed(2); }

async function api(path, opts){
  const merged = Object.assign({}, opts);
  merged.headers = Object.assign({}, (opts && opts.headers) || {}, authHeaders());
  const res = await fetch(path, merged);
  if(!res.ok) throw new Error('API error ' + res.status);
  return res.json();
}

// ===========================================================================
// Owner auth — a single shared password gate. Workers (no password) can only
// add/edit today's date; the owner unlocks past dates plus the Amount/Report
// tabs by entering the password once (kept for the browser tab's session).
// ===========================================================================
const AUTH = { password: sessionStorage.getItem('ownerPassword') || null };
function isUnlocked(){ return !!AUTH.password; }
function authHeaders(){ return AUTH.password ? { 'X-Owner-Password': AUTH.password } : {}; }
function isTodayCell(y, m, d){
  const now = new Date();
  return now.getFullYear()===y && (now.getMonth()+1)===m && now.getDate()===d;
}

async function verifyOwnerPassword(pw){
  const res = await fetch('/api/owner-unlock', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: pw }) });
  return res.ok;
}
function refreshOwnerUI(){
  const btn = document.getElementById('ownerLockBtn');
  if(!btn) return;
  if(isUnlocked()){ btn.textContent = '🔓 Owner (unlocked) — tap to lock'; btn.classList.add('unlocked'); }
  else { btn.textContent = '🔒 Owner Login'; btn.classList.remove('unlocked'); }
}
function openOwnerModal(){
  document.getElementById('ownerModalBackdrop').classList.add('show');
  document.getElementById('ownerModalError').textContent = '';
  const input = document.getElementById('ownerPasswordInput');
  input.value = '';
  input.focus();
}
function closeOwnerModal(){ document.getElementById('ownerModalBackdrop').classList.remove('show'); }
async function submitOwnerPassword(){
  const pw = document.getElementById('ownerPasswordInput').value;
  const ok = await verifyOwnerPassword(pw);
  if(!ok){ document.getElementById('ownerModalError').textContent = 'Wrong password.'; return; }
  AUTH.password = pw;
  sessionStorage.setItem('ownerPassword', pw);
  closeOwnerModal();
  location.reload(); // simplest way to make every already-built view pick up the unlocked state
}
function lockOwner(){
  AUTH.password = null;
  sessionStorage.removeItem('ownerPassword');
  location.reload();
}

const ownerLockBtn = document.getElementById('ownerLockBtn');
if(ownerLockBtn) ownerLockBtn.addEventListener('click', () => {
  if(isUnlocked()){ if(confirm('Lock owner access again?')) lockOwner(); return; }
  openOwnerModal();
});
const ownerModalCancel = document.getElementById('ownerModalCancel');
if(ownerModalCancel) ownerModalCancel.addEventListener('click', closeOwnerModal);
const ownerModalSubmit = document.getElementById('ownerModalSubmit');
if(ownerModalSubmit) ownerModalSubmit.addEventListener('click', submitOwnerPassword);
const ownerPasswordInput = document.getElementById('ownerPasswordInput');
if(ownerPasswordInput) ownerPasswordInput.addEventListener('keydown', (e) => { if(e.key==='Enter') submitOwnerPassword(); });
refreshOwnerUI();

function showToast(msg){
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = msg;
  toast.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(()=>toast.classList.remove('show'), 1400);
}

function setSyncing(isSyncing, failed){
  const dot = document.getElementById('syncDot');
  const txt = document.getElementById('syncText');
  if(failed){ dot.classList.remove('busy'); txt.textContent = 'Save failed — check connection'; return; }
  if(isSyncing){ dot.classList.add('busy'); txt.textContent = 'Saving to server…'; }
  else{ dot.classList.remove('busy'); txt.textContent = 'Synced to server'; }
}

// Entries formula set (shared by Food Truck + JP Nagar + used again for Report)
function computeEntryDay(map, day){
  const d = map[day] || {};
  const cb=num(d.cb), pb=num(d.pb), rice=num(d.rice), cp=num(d.cp), pp=num(d.pp),
        cw=num(d.cw), pw=num(d.pw), s1=num(d.s1), s2=num(d.s2), online=num(d.online), cash=num(d.cash);
  const chickenPlateDiff = cp - cb - cw;
  const paneerPlateDiff = pp - pb - pw;
  let totalSale;
  if(day === 1){ totalSale = s1 + s2; }
  else { const prev = map[day-1] || {}; totalSale = s1 + s2 - num(prev.s2); }
  const difference = totalSale - online - cash;
  const riceDiff = cp + pp - cb - pb - rice - cw - pw;
  const riceSale = cb + pb + rice;
  return {chickenPlateDiff, paneerPlateDiff, totalSale, difference, riceDiff, riceSale, online, cash};
}
function hasAnyEntry(map, day){
  const d = map[day];
  if(!d) return false;
  return ['cb','pb','rice','kabab','parcel','water','cp','pp','cw','pw','s1','s2','online','cash']
    .some(f => d[f] !== undefined && d[f] !== '' && d[f] !== null && num(d[f]) !== 0);
}
function entryDayStatus(map, day){
  if(!hasAnyEntry(map, day)) return 'empty';
  const c = computeEntryDay(map, day);
  if(c.difference > 0 || c.riceDiff > 30) return 'bad';
  if(c.difference < -500) return 'warn';
  return 'good';
}

// ===========================================================================
// Generic Entry View (Food Truck / JP Nagar / Items Used)
// ===========================================================================
const ENTRY_FIELD_META = {
  cb:{label:'Chicken Biryani', unit:'plates'}, pb:{label:'Paneer Biryani', unit:'plates'},
  rice:{label:'Rice', unit:'plates'}, kabab:{label:'Kabab', unit:'pcs'},
  parcel:{label:'Parcel', unit:'orders'}, water:{label:'Water Bottle', unit:'pcs'},
  cp:{label:'Chicken Plates', unit:'plates'}, pp:{label:'Paneer Plates', unit:'plates'},
  cw:{label:'Chicken Wastage', unit:'plates'}, pw:{label:'Paneer Wastage', unit:'plates'},
  s1:{label:'7pm – 12am Sale', unit:'₹'}, s2:{label:'12am – 1am Sale', unit:'₹'},
  online:{label:'Online', unit:'₹'}, cash:{label:'Cash', unit:'₹'},
};
const ENTRY_SECTIONS = [
  {title:'Todays Sales', fields:['cb','pb','rice','kabab','parcel','water']},
  {title:'Plates & wastage', fields:['cp','pp','cw','pw']},
  {title:'Sale by time slot', fields:['s1','s2']},
  {title:'Money collected', fields:['online','cash']},
];

const ITEMS_FIELD_META = {
  chicken_plates:{label:'Chicken Plates Made', unit:'plates'},
  veg_plates:{label:'Veg Plates Made', unit:'plates'},
  chicken:{label:'Chicken Used', unit:'kg'},
  rice:{label:'Rice Used', unit:'kg'},
};
const ITEMS_SECTIONS = [
  {title:'Kitchen usage (combined, both outlets)', fields:['chicken_plates','veg_plates','chicken','rice']},
];

function computeItemsDay(map, day){
  const d = map[day] || {};
  const chicken_plates = num(d.chicken_plates), veg_plates = num(d.veg_plates), chicken = num(d.chicken), rice = num(d.rice);
  const chickenRatio = safeDiv(chicken_plates, chicken);
  const riceRatio = safeDiv(chicken_plates + veg_plates, rice);
  return {chickenRatio, riceRatio};
}
function hasAnyItems(map, day){
  const d = map[day];
  if(!d) return false;
  return ['chicken_plates','veg_plates','chicken','rice'].some(f => num(d[f]) !== 0);
}
function itemsDayStatus(map, day){ return hasAnyItems(map, day) ? 'good' : 'empty'; }

function initEntryView(containerId, cfg){
  const container = document.getElementById(containerId);
  container.innerHTML = `
    <div class="sidebar">
      <div class="card cal-card">
        <div class="cal-nav">
          <button data-act="prevMonth">‹</button>
          <div class="cal-title" id="${containerId}-calTitle"></div>
          <button data-act="nextMonth">›</button>
        </div>
        <div class="cal-grid" id="${containerId}-calGrid"></div>
      </div>
      <div class="card month-stats" id="${containerId}-monthStats"></div>
    </div>
    <div class="main">
      <div class="card day-header">
        <div class="day-nav">
          <button data-act="prevDay">‹</button>
          <div>
            <div class="day-title" id="${containerId}-dayTitle"></div>
            <div class="day-sub" id="${containerId}-daySub"></div>
          </div>
          <button data-act="nextDay">›</button>
        </div>
        <button class="today-btn" data-act="today">Jump to today</button>
        ${cfg.kind === 'items' ? `<button class="today-btn" data-act="sendReportMail" id="${containerId}-sendMailBtn">✉️ Send Report Mail</button>` : ''}
      </div>
      <div class="card form-card" id="${containerId}-form"></div>
      <div class="mail-status" id="${containerId}-mailStatus" style="display:none;font-size:12px;color:var(--steel);margin:-4px 0 10px;"></div>
      <div class="card results-card">
        <div class="results-title">Worked out automatically</div>
        <div class="stat-grid" id="${containerId}-stats"></div>
      </div>
      <details class="info-line">
        <summary>How the automatic numbers are calculated</summary>
        ${cfg.infoText}
      </details>
    </div>
  `;

  const state = { outlet: cfg.activeOutlet, year: 0, month: 0, day: 0, map: {} };
  const now = new Date();
  state.year = now.getFullYear(); state.month = now.getMonth()+1; state.day = now.getDate();

  const fieldMeta = cfg.kind === 'items' ? ITEMS_FIELD_META : ENTRY_FIELD_META;
  const sections = cfg.kind === 'items' ? ITEMS_SECTIONS : ENTRY_SECTIONS;
  const computeFn = cfg.kind === 'items' ? computeItemsDay : computeEntryDay;
  const hasAnyFn = cfg.kind === 'items' ? hasAnyItems : hasAnyEntry;
  const statusFn = cfg.kind === 'items' ? itemsDayStatus : entryDayStatus;

  function apiBase(){
    if(cfg.kind === 'items') return `/api/items-used/${state.year}/${state.month}`;
    return `/api/entries/${state.outlet}/${state.year}/${state.month}`;
  }
  function apiDay(day){
    if(cfg.kind === 'items') return `/api/items-used/${state.year}/${state.month}/${day}`;
    return `/api/entries/${state.outlet}/${state.year}/${state.month}/${day}`;
  }

  let saveTimer = null;
  function scheduleSave(day, field, value){
    if(!state.map[day]) state.map[day] = {};
    state.map[day][field] = value;
    renderStats(); renderMonthStats(); updateCalTile(day);
    if(cfg.kind !== 'items' && field === 's2') updateCalTile(day+1);

    setSyncing(true);
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try{
        await api(apiDay(day), { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(state.map[day]) });
        setSyncing(false);
        showToast('Saved to server ✓');
      }catch(e){ setSyncing(false, true); }
    }, 500);
  }

  async function loadMonth(){
    try{ state.map = await api(apiBase()); }
    catch(e){ state.map = {}; }
    renderCalendar(); renderMonthStats(); renderDayForm();
  }

  function renderDayForm(){
    const d = new Date(state.year, state.month-1, state.day);
    const weekday = d.toLocaleDateString('en-IN', {weekday:'long'});
    document.getElementById(`${containerId}-dayTitle`).textContent = `${weekday}, ${state.day} ${monthNames[state.month-1]} ${state.year}`;
    document.getElementById(`${containerId}-daySub`).textContent = cfg.subtitle(state);

    const formEl = document.getElementById(`${containerId}-form`);
    formEl.innerHTML = sections.map(sec => `
      <div class="section">
        <div class="section-title">${sec.title}</div>
        <div class="field-grid">
          ${sec.fields.map(key => {
            const meta = fieldMeta[key];
            const val = (state.map[state.day] && state.map[state.day][key] !== undefined) ? state.map[state.day][key] : '';
            return `<div class="field">
              <label>${meta.label}</label>
              <div class="field-input-wrap">
                <input type="number" inputmode="decimal" step="any" placeholder="0" value="${val}"
                  data-key="${key}" />
                <span class="unit">${meta.unit}</span>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
    `).join('');
    formEl.querySelectorAll('input[data-key]').forEach(inp => {
      inp.addEventListener('input', () => scheduleSave(state.day, inp.dataset.key, inp.value));
    });
    renderStats();
  }

  function statCard(label, value, cls, note){
    return `<div class="stat-card ${cls||''}"><div class="s-label">${label}</div><div class="s-value">${value}</div>${note?`<div class="s-note">${note}</div>`:''}</div>`;
  }

  function renderStats(){
    const grid = document.getElementById(`${containerId}-stats`);
    if(!hasAnyFn(state.map, state.day)){
      grid.innerHTML = `<div class="stat-card"><div class="s-label">No entries yet</div><div class="s-value" style="font-size:14px;color:var(--steel);">Fill the form above to see totals</div></div>`;
      return;
    }
    grid.innerHTML = cfg.renderStats(computeFn(state.map, state.day));
  }

  function renderCalendar(){
    document.getElementById(`${containerId}-calTitle`).textContent = `${monthNames[state.month-1]} ${state.year}`;
    const grid = document.getElementById(`${containerId}-calGrid`);
    const nDays = daysInMonth(state.year, state.month);
    const firstDow = new Date(state.year, state.month-1, 1).getDay();
    const now = new Date();
    const isCurMonth = now.getFullYear()===state.year && (now.getMonth()+1)===state.month;
    let html = dowNames.map(d => `<div class="cal-dow">${d}</div>`).join('');
    for(let i=0;i<firstDow;i++) html += `<div class="cal-day empty"></div>`;
    for(let day=1; day<=nDays; day++){
      const status = statusFn(state.map, day);
      const classes = ['cal-day'];
      if(status !== 'empty') classes.push('filled', 'status-'+status);
      if(day === state.day) classes.push('selected');
      if(isCurMonth && day === now.getDate()) classes.push('today');
      if(!isUnlocked() && !isTodayCell(state.year, state.month, day)) classes.push('locked');
      html += `<div class="${classes.join(' ')}" data-day="${day}">${day}</div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.cal-day[data-day]').forEach(el => {
      el.addEventListener('click', () => {
        const day = parseInt(el.dataset.day,10);
        if(!isUnlocked() && !isTodayCell(state.year, state.month, day)){
          showToast('🔒 Owner password needed to view other dates');
          return;
        }
        state.day = day; renderCalendar(); renderDayForm();
      });
    });
  }

  function updateCalTile(day){
    const nDays = daysInMonth(state.year, state.month);
    if(day < 1 || day > nDays) return;
    const grid = document.getElementById(`${containerId}-calGrid`);
    const el = grid.querySelector(`.cal-day[data-day="${day}"]`);
    if(!el) return;
    const status = statusFn(state.map, day);
    el.className = 'cal-day' + (status!=='empty' ? ' filled status-'+status : '') + (day===state.day ? ' selected' : '');
    const now = new Date();
    if(now.getFullYear()===state.year && (now.getMonth()+1)===state.month && day===now.getDate()) el.classList.add('today');
  }

  function renderMonthStats(){
    document.getElementById(`${containerId}-monthStats`).innerHTML = cfg.renderMonthStats(state, computeFn, hasAnyFn);
  }

  async function changeMonth(delta){
    if(!isUnlocked()){ showToast('🔒 Owner password needed to view other dates'); return; }
    state.month += delta;
    if(state.month < 1){ state.month = 12; state.year--; }
    if(state.month > 12){ state.month = 1; state.year++; }
    const nDays = daysInMonth(state.year, state.month);
    if(state.day > nDays) state.day = nDays;
    await loadMonth();
  }
  async function changeDay(delta){
    if(!isUnlocked()){ showToast('🔒 Owner password needed to view other dates'); return; }
    const nDays = daysInMonth(state.year, state.month);
    let d = state.day + delta;
    if(d < 1){ await changeMonth(-1); state.day = daysInMonth(state.year, state.month); renderCalendar(); renderDayForm(); return; }
    if(d > nDays){ await changeMonth(1); state.day = 1; renderCalendar(); renderDayForm(); return; }
    state.day = d;
    renderCalendar(); renderDayForm();
  }
  async function goToday(){
    const now = new Date();
    state.year = now.getFullYear(); state.month = now.getMonth()+1; state.day = now.getDate();
    await loadMonth();
  }

  async function sendReportMail(){
    const btn = document.getElementById(`${containerId}-sendMailBtn`);
    const statusEl = document.getElementById(`${containerId}-mailStatus`);
    const pad2 = n => String(n).padStart(2,'0');
    const dateStr = `${state.year}-${pad2(state.month)}-${pad2(state.day)}`;
    if(!confirm(`Send the daily report email for ${dateStr}?`)) return;
    btn.disabled = true; btn.textContent = 'Sending…';
    statusEl.style.display = 'block'; statusEl.textContent = 'Sending report email…';
    try{
      const res = await api(`/api/send-report-email/${dateStr}`, { method:'POST' });
      statusEl.textContent = `Report email sent for ${dateStr} ✓`;
      showToast('Report email sent ✓');
    }catch(e){
      statusEl.textContent = `Failed to send report email: ${e.message}`;
      showToast('Failed to send report email');
    }finally{
      btn.disabled = false; btn.textContent = '✉️ Send Report Mail';
    }
  }

  container.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if(act==='prevMonth') changeMonth(-1);
      if(act==='nextMonth') changeMonth(1);
      if(act==='prevDay') changeDay(-1);
      if(act==='nextDay') changeDay(1);
      if(act==='today') goToday();
      if(act==='sendReportMail') sendReportMail();
    });
  });

  loadMonth();
  return state;
}

// ---- Config: Food Truck / JP Nagar ----
function entryRenderStats(c){
  const diffCls = c.difference > 0 ? 'bad' : (c.difference < -500 ? 'warn' : 'good');
  const diffNote = c.difference > 0 ? 'Under-collected — recheck cash/online' : (c.difference < -500 ? 'Collected well over sale — recheck' : 'Within range');
  const riceCls = c.riceDiff > 30 ? 'bad' : '';
  const riceNote = c.riceDiff > 30 ? 'High — check rice usage' : '';
  return [
    `<div class="stat-card ${c.chickenPlateDiff<0?'warn':''}"><div class="s-label">Chicken Plate Diff</div><div class="s-value">${c.chickenPlateDiff}</div></div>`,
    `<div class="stat-card ${c.paneerPlateDiff<0?'warn':''}"><div class="s-label">Paneer Plate Diff</div><div class="s-value">${c.paneerPlateDiff}</div></div>`,
    `<div class="stat-card"><div class="s-label">Total Sale</div><div class="s-value">${fmtMoney(c.totalSale)}</div></div>`,
    `<div class="stat-card ${diffCls}"><div class="s-label">Difference</div><div class="s-value">${fmtMoney(c.difference)}</div><div class="s-note">${diffNote}</div></div>`,
    `<div class="stat-card ${riceCls}"><div class="s-label">Rice Diff</div><div class="s-value">${c.riceDiff}</div><div class="s-note">${riceNote}</div></div>`,
    `<div class="stat-card"><div class="s-label">Rice Sale</div><div class="s-value">${c.riceSale} plates</div></div>`,
  ].join('');
}
function entryRenderMonthStats(state, computeFn){
  const nDays = daysInMonth(state.year, state.month);
  let totalSale=0, difference=0, alerts=0, filledDays=0;
  for(let day=1; day<=nDays; day++){
    if(!hasAnyEntry(state.map, day)) continue;
    filledDays++;
    const c = computeFn(state.map, day);
    totalSale += c.totalSale; difference += c.difference;
    if(c.difference>0 || c.riceDiff>30) alerts++;
  }
  return `
    <div class="stat-row"><span class="lbl">Days logged</span><span class="val">${filledDays}/${nDays}</span></div>
    <div class="stat-row"><span class="lbl">Total sale</span><span class="val">${fmtMoney(totalSale)}</span></div>
    <div class="stat-row"><span class="lbl">Net difference</span><span class="val">${fmtMoney(difference)}</span></div>
    <div class="alert-pill ${alerts===0?'ok':''}">${alerts===0 ? '✓ No alerts this month' : '⚠ '+alerts+' day(s) need a look'}</div>
  `;
}

initEntryView('app-truck', {
  kind:'entries', activeOutlet:'truck',
  subtitle: () => 'Food Truck',
  renderStats: entryRenderStats,
  renderMonthStats: entryRenderMonthStats,
  infoText: `Chicken/Paneer Plate Diff = plates made − biryani sold − wastage. Total Sale: on the 1st of the month
    it's the 7pm–12am slot plus the 12am–1am slot; every other day, yesterday's 12am–1am slot is subtracted first
    so that hour is never counted twice. Difference = Total Sale − Online − Cash. Rice Diff = (Chicken + Paneer
    Plates) − (Chicken + Paneer Biryani) − Rice − wastage. Rice Sale = Chicken Biryani + Paneer Biryani + Rice.`,
});

initEntryView('app-jp', {
  kind:'entries', activeOutlet:'jp',
  subtitle: () => 'JP Nagar Outlet',
  renderStats: entryRenderStats,
  renderMonthStats: entryRenderMonthStats,
  infoText: `Chicken/Paneer Plate Diff = plates made − biryani sold − wastage. Total Sale: on the 1st of the month
    it's the 7pm–12am slot plus the 12am–1am slot; every other day, yesterday's 12am–1am slot is subtracted first
    so that hour is never counted twice. Difference = Total Sale − Online − Cash. Rice Diff = (Chicken + Paneer
    Plates) − (Chicken + Paneer Biryani) − Rice − wastage. Rice Sale = Chicken Biryani + Paneer Biryani + Rice.`,
});

initEntryView('app-items', {
  kind:'items',
  subtitle: () => 'Combined kitchen usage — both outlets',
  renderStats: (c) => [
    `<div class="stat-card"><div class="s-label">Chicken Ready Ratio</div><div class="s-value">${fmtRatio(c.chickenRatio)}</div><div class="s-note">Chicken Plates ÷ Chicken (kg)</div></div>`,
    `<div class="stat-card"><div class="s-label">Rice Ready Ratio</div><div class="s-value">${fmtRatio(c.riceRatio)}</div><div class="s-note">(Chicken + Veg Plates) ÷ Rice (kg)</div></div>`,
  ].join(''),
  renderMonthStats: (state) => {
    const nDays = daysInMonth(state.year, state.month);
    let filledDays=0;
    for(let day=1; day<=nDays; day++) if(hasAnyItems(state.map, day)) filledDays++;
    return `<div class="stat-row"><span class="lbl">Days logged</span><span class="val">${filledDays}/${nDays}</span></div>
      <div class="stat-row"><span class="lbl">Feeds into</span><span class="val" style="font-family:'Inter',sans-serif;font-weight:500;font-size:12px;">Report tab ratios</span></div>`;
  },
  infoText: `This is combined kitchen usage for both outlets together — how many plates were made and how much
    raw chicken and rice went into them. Chicken Ready Ratio = Chicken Plates ÷ Chicken used. Rice Ready Ratio =
    (Chicken + Veg Plates) ÷ Rice used. These two numbers feed into the Report tab, alongside the Food Truck and
    JP Nagar entries, to work out sale and wastage ratios across the whole business.`,
});

// ===========================================================================
// Owner views: Amount & Report — per-day, same calendar+day pattern as the
// entry views, but read-only (values are computed from Truck + JP Nagar +
// Items Used, never typed in directly here).
// ===========================================================================

function computeAmountDay(data, day){
  const jp = data.jp[day], truck = data.truck[day];
  const jpOnline = num(jp && jp.online), jpCash = num(jp && jp.cash);
  const truckOnline = num(truck && truck.online), truckCash = num(truck && truck.cash);
  if(jpOnline===0 && jpCash===0 && truckOnline===0 && truckCash===0) return null;
  const jpTotal = jpOnline + jpCash, truckTotal = truckOnline + truckCash;
  return { jpOnline, jpCash, truckOnline, truckCash, jpTotal, truckTotal, combinedTotal: jpTotal + truckTotal };
}

function computeReportDay(data, day){
  const jpMap = data.jp, truckMap = data.truck, itemsMap = data.itemsUsed;
  const hasJp = hasAnyEntry(jpMap, day), hasTruck = hasAnyEntry(truckMap, day), hasItems = hasAnyItems(itemsMap, day);
  if(!hasJp && !hasTruck && !hasItems) return null;

  const jc = computeEntryDay(jpMap, day), tc = computeEntryDay(truckMap, day);
  const totalSale = jc.totalSale + tc.totalSale;
  const totalDiff = jc.difference + tc.difference;
  const chickenPlateDiffAll = jc.chickenPlateDiff + tc.chickenPlateDiff;
  const ricePlateDiffAll = jc.riceDiff + tc.riceDiff;

  const items = itemsMap[day] || {};
  const chickenUsed = num(items.chicken), riceUsed = num(items.rice);
  const chickenPlatesMade = num(items.chicken_plates), vegPlatesMade = num(items.veg_plates);
  const jd = jpMap[day] || {}, td = truckMap[day] || {};
  const chickenSold = num(jd.cb) + num(td.cb);
  const chickenSoldWaste = (num(jd.cb)+num(jd.cw)) + (num(td.cb)+num(td.cw));
  const riceSoldTotal = jc.riceSale + tc.riceSale;
  // Rice (Sale + wastage) ratio — the source sheet never filled this formula in.
  // Built the same way as "Chicken (Sale + wastage) ratio" (L column): the sale
  // quantity for that ingredient, plus its wastage, both outlets, over usage.
  // Rice's "sale" is RICE SALE (cb+pb+rice) and rice has no wastage column of its
  // own, so both outlets' Chicken + Paneer wastage is added (rice sits inside
  // both biryanis, so wastage of either wastes rice too).
  const riceSoldWaste = (jc.riceSale + num(jd.cw) + num(jd.pw)) + (tc.riceSale + num(td.cw) + num(td.pw));

  return {
    jpSale: jc.totalSale, truckSale: tc.totalSale, totalSale,
    jpDiff: jc.difference, truckDiff: tc.difference, totalDiff,
    chickenPlateDiffAll, ricePlateDiffAll,
    chickenReadyRatio: safeDiv(chickenPlatesMade, chickenUsed),
    chickenSaleRatio: safeDiv(chickenSold, chickenUsed),
    chickenSaleWasteRatio: safeDiv(chickenSoldWaste, chickenUsed),
    riceReadyRatio: safeDiv(chickenPlatesMade + vegPlatesMade, riceUsed),
    riceSaleRatio: safeDiv(riceSoldTotal, riceUsed),
    riceSaleWasteRatio: safeDiv(riceSoldWaste, riceUsed),
  };
}

function initOwnerDayView(containerId, cfg){
  const container = document.getElementById(containerId);

  if(!isUnlocked()){
    container.innerHTML = `
      <div class="card plain owner-lockscreen" style="grid-column:1/-1;">
        <div class="lock-icon">🔒</div>
        <div class="lock-title">${cfg.lockLabel} is owner-only</div>
        <div class="lock-sub">Enter the owner password to view ${cfg.lockLabel.toLowerCase()} for any date.</div>
        <button class="today-btn" id="${containerId}-unlockBtn">Enter password</button>
      </div>
    `;
    document.getElementById(`${containerId}-unlockBtn`).addEventListener('click', openOwnerModal);
    return;
  }

  container.innerHTML = `
    <div class="sidebar">
      <div class="card cal-card">
        <div class="cal-nav">
          <button data-act="prevMonth">‹</button>
          <div class="cal-title" id="${containerId}-calTitle"></div>
          <button data-act="nextMonth">›</button>
        </div>
        <div class="cal-grid" id="${containerId}-calGrid"></div>
      </div>
      <div class="card month-stats" id="${containerId}-monthStats"></div>
    </div>
    <div class="main">
      <div class="card day-header">
        <div class="day-nav">
          <button data-act="prevDay">‹</button>
          <div>
            <div class="day-title" id="${containerId}-dayTitle"></div>
            <div class="day-sub">${cfg.subtitle}</div>
          </div>
          <button data-act="nextDay">›</button>
        </div>
        <button class="today-btn" data-act="today">Jump to today</button>
        <button class="today-btn" data-act="refresh">⟳ Refresh</button>
      </div>
      <div class="card results-card">
        <div class="results-title">${cfg.resultsTitle}</div>
        <div class="stat-grid" id="${containerId}-stats"></div>
      </div>
      <details class="info-line">
        <summary>How these numbers are calculated</summary>
        ${cfg.infoText}
      </details>
    </div>
  `;

  const state = { year:0, month:0, day:0, data:{truck:{}, jp:{}, itemsUsed:{}} };
  const now = new Date();
  state.year = now.getFullYear(); state.month = now.getMonth()+1; state.day = now.getDate();

  async function loadMonth(){
    try{ state.data = await api(`/api/owner-view/${state.year}/${state.month}`); }
    catch(e){ state.data = {truck:{}, jp:{}, itemsUsed:{}}; }
    renderCalendar(); renderMonthStats(); renderDay();
  }

  function renderDay(){
    const d = new Date(state.year, state.month-1, state.day);
    const weekday = d.toLocaleDateString('en-IN', {weekday:'long'});
    document.getElementById(`${containerId}-dayTitle`).textContent = `${weekday}, ${state.day} ${monthNames[state.month-1]} ${state.year}`;
    const result = cfg.computeDay(state.data, state.day);
    const grid = document.getElementById(`${containerId}-stats`);
    if(!result){
      grid.innerHTML = `<div class="stat-card"><div class="s-label">No entries yet</div><div class="s-value" style="font-size:14px;color:var(--steel);">Nothing logged for Food Truck or JP Nagar on this day</div></div>`;
      return;
    }
    grid.innerHTML = cfg.renderDayCards(result);
  }

  function renderCalendar(){
    document.getElementById(`${containerId}-calTitle`).textContent = `${monthNames[state.month-1]} ${state.year}`;
    const grid = document.getElementById(`${containerId}-calGrid`);
    const nDays = daysInMonth(state.year, state.month);
    const firstDow = new Date(state.year, state.month-1, 1).getDay();
    const now = new Date();
    const isCurMonth = now.getFullYear()===state.year && (now.getMonth()+1)===state.month;
    let html = dowNames.map(d => `<div class="cal-dow">${d}</div>`).join('');
    for(let i=0;i<firstDow;i++) html += `<div class="cal-day empty"></div>`;
    for(let day=1; day<=nDays; day++){
      const status = cfg.dayStatus(state.data, day);
      const classes = ['cal-day'];
      if(status !== 'empty') classes.push('filled', 'status-'+status);
      if(day === state.day) classes.push('selected');
      if(isCurMonth && day === now.getDate()) classes.push('today');
      html += `<div class="${classes.join(' ')}" data-day="${day}">${day}</div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.cal-day[data-day]').forEach(el => {
      el.addEventListener('click', () => { state.day = parseInt(el.dataset.day,10); renderCalendar(); renderDay(); });
    });
  }

  function renderMonthStats(){
    document.getElementById(`${containerId}-monthStats`).innerHTML = cfg.renderMonthSummary(state.data, state.year, state.month);
  }

  async function changeMonth(delta){
    state.month += delta;
    if(state.month < 1){ state.month = 12; state.year--; }
    if(state.month > 12){ state.month = 1; state.year++; }
    const nDays = daysInMonth(state.year, state.month);
    if(state.day > nDays) state.day = nDays;
    await loadMonth();
  }
  async function changeDay(delta){
    const nDays = daysInMonth(state.year, state.month);
    let d = state.day + delta;
    if(d < 1){ await changeMonth(-1); state.day = daysInMonth(state.year, state.month); renderCalendar(); renderDay(); return; }
    if(d > nDays){ await changeMonth(1); state.day = 1; renderCalendar(); renderDay(); return; }
    state.day = d; renderCalendar(); renderDay();
  }
  async function goToday(){
    const now = new Date();
    state.year = now.getFullYear(); state.month = now.getMonth()+1; state.day = now.getDate();
    await loadMonth();
  }

  container.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if(act==='prevMonth') changeMonth(-1);
      if(act==='nextMonth') changeMonth(1);
      if(act==='prevDay') changeDay(-1);
      if(act==='nextDay') changeDay(1);
      if(act==='today') goToday();
      if(act==='refresh') loadMonth();
    });
  });

  loadMonth();
}

// ---- Amount tab ----
initOwnerDayView('app-amount', {
  lockLabel: 'Amount',
  subtitle: 'Combined collections — Food Truck + JP Nagar',
  resultsTitle: "This day's collections",
  computeDay: computeAmountDay,
  dayStatus: (data, day) => computeAmountDay(data, day) ? 'good' : 'empty',
  renderDayCards: (r) => [
    ['JP Nagar Online', r.jpOnline], ['JP Nagar Cash', r.jpCash], ['JP Nagar Total', r.jpTotal],
    ['Truck Online', r.truckOnline], ['Truck Cash', r.truckCash], ['Truck Total', r.truckTotal],
    ['Combined Total', r.combinedTotal],
  ].map(([label,val]) => `<div class="stat-card"><div class="s-label">${label}</div><div class="s-value">${fmtMoney(val)}</div></div>`).join(''),
  renderMonthSummary: (data, year, month) => {
    const nDays = daysInMonth(year, month);
    let jpOnline=0, jpCash=0, truckOnline=0, truckCash=0, filledDays=0;
    for(let day=1; day<=nDays; day++){
      const r = computeAmountDay(data, day);
      if(!r) continue;
      filledDays++; jpOnline+=r.jpOnline; jpCash+=r.jpCash; truckOnline+=r.truckOnline; truckCash+=r.truckCash;
    }
    const grand = jpOnline+jpCash+truckOnline+truckCash;
    return `
      <div class="stat-row"><span class="lbl">Days logged</span><span class="val">${filledDays}/${nDays}</span></div>
      <div class="stat-row"><span class="lbl">JP Online</span><span class="val">${fmtMoney(jpOnline)}</span></div>
      <div class="stat-row"><span class="lbl">JP Cash</span><span class="val">${fmtMoney(jpCash)}</span></div>
      <div class="stat-row"><span class="lbl">Truck Online</span><span class="val">${fmtMoney(truckOnline)}</span></div>
      <div class="stat-row"><span class="lbl">Truck Cash</span><span class="val">${fmtMoney(truckCash)}</span></div>
      <div class="alert-pill ok">Month total: ${fmtMoney(grand)}</div>
    `;
  },
  infoText: `JP Nagar Total = JP Nagar Online + JP Nagar Cash. Truck Total = Truck Online + Truck Cash. Combined
    Total = both outlets added together. These are the same Online/Cash figures entered on the Food Truck and
    JP Nagar tabs — this view just lines the two outlets up side by side for the same day.`,
});

// ---- Report tab ----
initOwnerDayView('app-report', {
  lockLabel: 'Report',
  subtitle: 'Combined performance — Food Truck + JP Nagar',
  resultsTitle: "This day's combined report",
  computeDay: computeReportDay,
  dayStatus: (data, day) => {
    const r = computeReportDay(data, day);
    if(!r) return 'empty';
    if(r.totalDiff > 0 || r.ricePlateDiffAll > 30) return 'bad';
    if(r.totalDiff < -500) return 'warn';
    return 'good';
  },
  renderDayCards: (r) => {
    const diffCls = r.totalDiff > 0 ? 'bad' : (r.totalDiff < -500 ? 'warn' : 'good');
    const diffNote = r.totalDiff > 0 ? 'Under-collected — recheck cash/online' : (r.totalDiff < -500 ? 'Collected well over sale — recheck' : 'Within range');
    const riceCls = r.ricePlateDiffAll > 30 ? 'bad' : '';
    const riceNote = r.ricePlateDiffAll > 30 ? 'High — check rice usage' : '';
    const cards = [
      ['JP Nagar Sale', fmtMoney(r.jpSale)], ['Truck Sale', fmtMoney(r.truckSale)], ['Total Sale', fmtMoney(r.totalSale)],
      ['JP Nagar Difference', fmtMoney(r.jpDiff)], ['Truck Difference', fmtMoney(r.truckDiff)],
    ].map(([l,v]) => `<div class="stat-card"><div class="s-label">${l}</div><div class="s-value">${v}</div></div>`).join('');
    const diffCard = `<div class="stat-card ${diffCls}"><div class="s-label">Total Difference</div><div class="s-value">${fmtMoney(r.totalDiff)}</div><div class="s-note">${diffNote}</div></div>`;
    const plateCards = [
      ['Chicken Plate Diff', r.chickenPlateDiffAll],
    ].map(([l,v]) => `<div class="stat-card"><div class="s-label">${l}</div><div class="s-value">${v}</div></div>`).join('');
    const riceDiffCard = `<div class="stat-card ${riceCls}"><div class="s-label">Rice Plate Diff</div><div class="s-value">${r.ricePlateDiffAll}</div><div class="s-note">${riceNote}</div></div>`;
    const ratioCards = [
      ['Chicken Ready Ratio', fmtRatio(r.chickenReadyRatio)], ['Chicken Sale Ratio', fmtRatio(r.chickenSaleRatio)],
      ['Chicken Sale+Waste Ratio', fmtRatio(r.chickenSaleWasteRatio)], ['Rice Ready Ratio', fmtRatio(r.riceReadyRatio)],
      ['Rice Sale Ratio', fmtRatio(r.riceSaleRatio)], ['Rice Sale+Waste Ratio', fmtRatio(r.riceSaleWasteRatio)],
    ].map(([l,v]) => `<div class="stat-card"><div class="s-label">${l}</div><div class="s-value">${v}</div></div>`).join('');
    return cards + diffCard + plateCards + riceDiffCard + ratioCards;
  },
  renderMonthSummary: (data, year, month) => {
    const nDays = daysInMonth(year, month);
    let totalSale=0, totalDiff=0, alerts=0, filledDays=0;
    for(let day=1; day<=nDays; day++){
      const r = computeReportDay(data, day);
      if(!r) continue;
      filledDays++; totalSale += r.totalSale; totalDiff += r.totalDiff;
      if(r.totalDiff > 0 || r.ricePlateDiffAll > 30) alerts++;
    }
    return `
      <div class="stat-row"><span class="lbl">Days logged</span><span class="val">${filledDays}/${nDays}</span></div>
      <div class="stat-row"><span class="lbl">Total sale</span><span class="val">${fmtMoney(totalSale)}</span></div>
      <div class="stat-row"><span class="lbl">Net difference</span><span class="val">${fmtMoney(totalDiff)}</span></div>
      <div class="alert-pill ${alerts===0?'ok':''}">${alerts===0 ? '✓ No alerts this month' : '⚠ '+alerts+' day(s) need a look'}</div>
    `;
  },
  infoText: `Total Sale / Total Difference / Chicken Plate Diff / Rice Plate Diff = Food Truck + JP Nagar added
    together for this day. Chicken Sale Ratio = (Chicken Biryani sold, both outlets) ÷ Chicken used. Chicken
    Sale+Waste Ratio = (Chicken sold + Chicken wastage, both outlets) ÷ Chicken used. Rice Sale Ratio = (Rice
    Sale, both outlets) ÷ Rice used. Rice Sale+Waste Ratio = (Rice Sale + Chicken/Paneer wastage, both outlets)
    ÷ Rice used — built the same way as the Chicken Sale+Waste ratio, since rice sits inside both the chicken
    and paneer biryani.`,
});


// ===========================================================================
// Top-level nav switching
// ===========================================================================
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b===btn));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
  });
});


// ===========================================================================
// Payment tab — employees + ad-hoc salary payments (owner-only, like Amount/Report)
// ===========================================================================
function monthlyDueArray(fixedSalary, asOfDate){
  const curMonth = asOfDate.getMonth(); // 0-11; months before this one are due
  const arr = [];
  for(let m=0;m<12;m++) arr.push(m < curMonth ? fixedSalary : 0);
  return arr;
}
function remainingArray(dueArr, totalPaid){
  let cum = 0;
  return dueArr.map(due => { cum += due; return Math.min(due, Math.max(0, cum - totalPaid)); });
}
function paymentTotalForEmp(payments, empId){
  return payments.filter(p => p.emp_id === empId).reduce((s,p) => s + num(p.amount), 0);
}
function empSalaryStatus(emp, payments, asOfDate){
  const dueArr = monthlyDueArray(num(emp.salary), asOfDate);
  const totalDue = dueArr.reduce((a,b)=>a+b, 0);
  const totalPaid = paymentTotalForEmp(payments, emp.id);
  const remArr = remainingArray(dueArr, totalPaid);
  const remaining = Math.max(0, totalDue - totalPaid);
  const overpaid = Math.max(0, totalPaid - totalDue);
  const projectedNextDue = Math.max(0, num(emp.salary) - overpaid);
  return { dueArr, remArr, totalDue, totalPaid, remaining, overpaid, projectedNextDue };
}

function initPaymentView(containerId){
  const container = document.getElementById(containerId);

  if(!isUnlocked()){
    container.innerHTML = `
      <div class="card plain owner-lockscreen" style="grid-column:1/-1;">
        <div class="lock-icon">🔒</div>
        <div class="lock-title">Payment is owner-only</div>
        <div class="lock-sub">Enter the owner password to log salary payments and see who's owed what.</div>
        <button class="today-btn" id="${containerId}-unlockBtn">Enter password</button>
      </div>
    `;
    document.getElementById(`${containerId}-unlockBtn`).addEventListener('click', openOwnerModal);
    return;
  }

  const state = { sub:'status', employees:[], payments:[], asOfDate:new Date(), historyEmpId:null, openMonth:new Set() };

  function isoToday(d){ const dt=d||new Date(); return `${dt.getFullYear()}-${pad2(dt.getMonth()+1)}-${pad2(dt.getDate())}`; }
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  async function loadAll(){
    try{ state.employees = await api('/api/employees'); }catch(e){ state.employees = []; }
    try{ state.payments = await api('/api/payments'); }catch(e){ state.payments = []; }
    render();
  }

  function shell(){
    return `
      <div class="pay-tabs">
        <button data-sub="status" class="${state.sub==='status'?'active':''}">📊 Status</button>
        <button data-sub="add" class="${state.sub==='add'?'active':''}">➕ Add Payment</button>
        <button data-sub="history" class="${state.sub==='history'?'active':''}">📜 History</button>
        <button data-sub="employees" class="${state.sub==='employees'?'active':''}">👥 Employees</button>
      </div>
      <div id="${containerId}-subbody"></div>
    `;
  }

  function render(){
    container.innerHTML = shell();
    const body = document.getElementById(`${containerId}-subbody`);
    if(state.sub==='status') body.innerHTML = renderStatus();
    else if(state.sub==='add') body.innerHTML = renderAdd();
    else if(state.sub==='history') body.innerHTML = renderHistory();
    else body.innerHTML = renderEmployees();
    attach();
  }

  function renderStatus(){
    if(state.employees.length===0){
      return `<div class="card plain owner-lockscreen"><div class="lock-title">No employees yet</div><div class="lock-sub">Add someone in the Employees tab first.</div></div>`;
    }
    const cards = state.employees.map(emp=>{
      const s = empSalaryStatus(emp, state.payments, state.asOfDate);
      let cls, label;
      if(s.remaining===0 && s.overpaid===0){ cls='good'; label='Settled'; }
      else if(s.overpaid>0){ cls='warn'; label='Advance ' + fmtMoney(s.overpaid); }
      else { cls='bad'; label='Due ' + fmtMoney(s.remaining); }
      const open = state.openMonth.has(emp.id);
      const monthTable = `
        <table class="pay-month-grid">
          <tr>${monthNames.map(m=>`<th>${m.slice(0,3)}</th>`).join('')}</tr>
          <tr>${s.dueArr.map(d=>`<td class="due">${d?Math.round(d).toLocaleString('en-IN'):'–'}</td>`).join('')}</tr>
          <tr>${s.remArr.map((r,i)=> s.dueArr[i]===0 ? '<td>–</td>' : `<td class="${r===0?'ok':'pending'}">${Math.round(r).toLocaleString('en-IN')}</td>`).join('')}</tr>
        </table>`;
      return `<div class="card emp-card">
        <div class="emp-card-top">
          <div><div class="emp-name">${escapeHtml(emp.name)}</div><div class="emp-sub">${fmtMoney(emp.salary)}/month</div></div>
        </div>
        <div class="stat-grid" style="margin-top:10px;">
          <div class="stat-card"><div class="s-label">Total paid</div><div class="s-value">${fmtMoney(s.totalPaid)}</div></div>
          <div class="stat-card"><div class="s-label">Total due so far</div><div class="s-value">${fmtMoney(s.totalDue)}</div></div>
          <div class="stat-card ${cls}"><div class="s-label">Status</div><div class="s-value">${label}</div></div>
        </div>
        <span class="pay-detail-toggle" data-toggle="${emp.id}">${open?'Hide month-by-month ▲':'Show month-by-month ▼'}</span>
        ${open?monthTable:''}
      </div>`;
    }).join('');
    return `
      <div class="pay-asof">
        <span>📅 As of</span>
        <input type="date" id="${containerId}-asof" value="${isoToday(state.asOfDate)}">
        <span class="pay-asof-note">Months before this one count as due — change the date to preview next month.</span>
      </div>
      ${cards}
    `;
  }

  function renderAdd(){
    if(state.employees.length===0){
      return `<div class="card plain owner-lockscreen"><div class="lock-title">No employees yet</div><div class="lock-sub">Add someone in the Employees tab first.</div></div>`;
    }
    const options = `<option value="" disabled selected>Select employee</option>` +
      state.employees.map(e=>`<option value="${e.id}">${escapeHtml(e.name)}</option>`).join('');
      return `
      <div class="card form-card">
        <div class="section-title">Log a payment</div>
        <div class="field-grid">
          <div class="field"><label>Employee</label><select id="${containerId}-p-emp">${options}</select></div>
          <div class="field"><label>Amount</label><div class="field-input-wrap"><input type="number" id="${containerId}-p-amt" placeholder="0" min="1"><span class="unit">₹</span></div></div>
          <div class="field"><label>Date</label><input type="date" id="${containerId}-p-date" value="${isoToday()}"></div>
          <div class="field"><label>Note (optional)</label><input type="text" id="${containerId}-p-note" placeholder="e.g. advance"></div>
        </div>
        <button class="today-btn" id="${containerId}-p-submit" style="margin-top:14px;">Save payment</button>
      </div>
    `;
  }

  function renderHistory(){
    if(state.employees.length===0){
      return `<div class="card plain owner-lockscreen"><div class="lock-title">No employees yet</div><div class="lock-sub">Add someone in the Employees tab first.</div></div>`;
    }
    if(!state.historyEmpId) state.historyEmpId = state.employees[0].id;
    const options = state.employees.map(e=>`<option value="${e.id}" ${e.id===state.historyEmpId?'selected':''}>${escapeHtml(e.name)}</option>`).join('');
    const rows = state.payments.filter(p=>p.emp_id===state.historyEmpId).sort((a,b)=> b.date.localeCompare(a.date));
    const total = rows.reduce((s,p)=>s+num(p.amount),0);
    const tableHtml = rows.length===0
      ? `<div class="lock-sub" style="margin-top:14px;">No payments logged yet.</div>`
      : `<table class="pay-history-table">
          <tr><th>Date</th><th>Amount</th><th>Note</th><th></th></tr>
          ${rows.map(p=>`<tr>
            <td>${p.date}</td><td>${fmtMoney(p.amount)}</td><td>${escapeHtml(p.note||'—')}</td>
            <td><button class="pay-del-btn" data-del-payment="${p.id}">Delete</button></td>
          </tr>`).join('')}
        </table>
        <div class="stat-row" style="margin-top:12px;"><span class="lbl">Total paid</span><span class="val">${fmtMoney(total)}</span></div>`;
    return `
      <div class="card form-card">
        <div class="section-title">Payment history</div>
        <div class="field" style="max-width:280px;"><label>Employee</label><select id="${containerId}-h-emp">${options}</select></div>
        ${tableHtml}
      </div>
    `;
  }

  function renderEmployees(){
    const list = state.employees.length===0
      ? `<div class="lock-sub">No employees yet — add your first one below.</div>`
      : `<ul class="pay-emp-list">${state.employees.map(e=>`
          <li><div><div class="name">${escapeHtml(e.name)}</div><div class="meta">${fmtMoney(e.salary)}/month</div></div>
          <button class="pay-del-btn" data-del-emp="${e.id}">Remove</button></li>`).join('')}</ul>`;
    return `
      <div class="card form-card">
        <div class="section-title">Employees</div>
        ${list}
      </div>
      <div class="card form-card" style="margin-top:14px;">
        <div class="section-title">Add employee</div>
        <div class="field-grid">
          <div class="field"><label>Name</label><input type="text" id="${containerId}-e-name" placeholder="e.g. Karthik S"></div>
          <div class="field"><label>Fixed monthly salary</label><div class="field-input-wrap"><input type="number" id="${containerId}-e-salary" placeholder="0" min="1"><span class="unit">₹</span></div></div>
        </div>
        <button class="today-btn" id="${containerId}-e-submit" style="margin-top:14px;">Add employee</button>
      </div>
    `;
  }

  function attach(){
    container.querySelectorAll('.pay-tabs button').forEach(b=>{
      b.addEventListener('click', ()=>{ state.sub = b.dataset.sub; render(); });
    });
    const asof = document.getElementById(`${containerId}-asof`);
    if(asof) asof.addEventListener('change', e=>{ if(e.target.value){ state.asOfDate = new Date(e.target.value+'T00:00:00'); render(); } });

    container.querySelectorAll('[data-toggle]').forEach(el=>{
      el.addEventListener('click', ()=>{
        const id = el.dataset.toggle;
        if(state.openMonth.has(id)) state.openMonth.delete(id); else state.openMonth.add(id);
        render();
      });
    });

    const pSubmit = document.getElementById(`${containerId}-p-submit`);
    if(pSubmit) pSubmit.addEventListener('click', async ()=>{
      const empVal = document.getElementById(`${containerId}-p-emp`).value;
      const emp_id = Number(empVal);
      const amount = num(document.getElementById(`${containerId}-p-amt`).value);
      const date = document.getElementById(`${containerId}-p-date`).value;
      const note = document.getElementById(`${containerId}-p-note`).value;
      if(!empVal){ showToast('Select an employee'); return; }
      if(!amount || amount<=0){ showToast('Enter a valid amount'); return; }
      if(!date){ showToast('Pick a date'); return; }
      try{
        await api('/api/payments', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({emp_id, amount, date, note}) });
        showToast('Payment saved ✓');
        await loadAll();
        state.sub = 'add'; render();
      }catch(e){ showToast('Could not save payment'); }
    });

    const histSel = document.getElementById(`${containerId}-h-emp`);
    if(histSel) histSel.addEventListener('change', e=>{ state.historyEmpId = e.target.value; render(); });

    container.querySelectorAll('[data-del-payment]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if(!confirm('Delete this payment?')) return;
        try{ await api(`/api/payments/${btn.dataset.delPayment}`, { method:'DELETE' }); showToast('Payment deleted'); await loadAll(); render(); }
        catch(e){ showToast('Could not delete'); }
      });
    });

    const eSubmit = document.getElementById(`${containerId}-e-submit`);
    if(eSubmit) eSubmit.addEventListener('click', async ()=>{
      const name = document.getElementById(`${containerId}-e-name`).value.trim();
      const salary = num(document.getElementById(`${containerId}-e-salary`).value);
      if(!name || !salary){ showToast('Fill in name and salary'); return; }
      try{
        await api('/api/employees', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name, salary}) });
        showToast('Employee added ✓');
        await loadAll(); render();
      }catch(e){ showToast('Could not add employee'); }
    });

    container.querySelectorAll('[data-del-emp]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if(!confirm('Remove this employee? Their payment history will be deleted too.')) return;
        try{ await api(`/api/employees/${btn.dataset.delEmp}`, { method:'DELETE' }); showToast('Employee removed'); await loadAll(); render(); }
        catch(e){ showToast('Could not remove'); }
      });
    });
  }

  loadAll();
}

initPaymentView('app-payment');