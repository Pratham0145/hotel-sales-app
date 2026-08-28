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

// Auth (AUTH/roles/login modal) now lives in layout.js, loaded before this file.

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
  if(!container) return; // this page doesn't render this view
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
      if(!canEditDates() && !isTodayCell(state.year, state.month, day)) classes.push('locked');
      html += `<div class="${classes.join(' ')}" data-day="${day}">${day}</div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.cal-day[data-day]').forEach(el => {
      el.addEventListener('click', () => {
        const day = parseInt(el.dataset.day,10);
        if(!canEditDates() && !isTodayCell(state.year, state.month, day)){
          showToast('🔒 Sign in to change the date');
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
    if(!canEditDates()){ showToast('🔒 Sign in to change the date'); return; }
    state.month += delta;
    if(state.month < 1){ state.month = 12; state.year--; }
    if(state.month > 12){ state.month = 1; state.year++; }
    const nDays = daysInMonth(state.year, state.month);
    if(state.day > nDays) state.day = nDays;
    await loadMonth();
  }
  async function changeDay(delta){
    if(!canEditDates()){ showToast('🔒 Sign in to change the date'); return; }
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
    if(!confirm(`Send the daily report + weekly comparison email for ${dateStr}?`)) return;
    btn.disabled = true; btn.textContent = 'Sending…';
    statusEl.style.display = 'block'; statusEl.textContent = 'Sending report email…';
    try{
      await api(`/api/send-report-email/${dateStr}`, { method:'POST' });
      statusEl.textContent = 'Report sent — sending weekly comparison…';
      try{
        await api(`/api/send-comparison-email/${dateStr}`, { method:'POST' });
        statusEl.textContent = `Report + weekly comparison sent for ${dateStr} ✓`;
        showToast('Report + comparison sent ✓');
      }catch(e2){
        statusEl.textContent = `Report sent, but comparison email failed: ${e2.message}`;
        showToast('Report sent, comparison failed');
      }
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
// Material — "All Materials" page (manage master list only)
// ===========================================================================
function initMaterialsAllView(containerId){
  const container = document.getElementById(containerId);
  if(!container) return;
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  container.innerHTML = `
    <div class="card form-card materials-manage">
      <div class="section-title">All materials</div>
      <table class="materials-table">
        <thead><tr><th>Name</th><th>Qty</th><th>Amt</th><th>Status</th></tr></thead>
        <tbody id="${containerId}-matTableBody"></tbody>
      </table>
      <div class="add-material-row">
        <input type="text" id="${containerId}-newMatName" placeholder="Material name">
        <label><input type="checkbox" id="${containerId}-newMatQty" checked> Quantity</label>
        <label><input type="checkbox" id="${containerId}-newMatAmt" checked> Amount</label>
        <button class="today-btn" id="${containerId}-newMatAdd">+ Add</button>
      </div>
    </div>
  `;

  let materials = [];

  async function load(){
    try{ materials = await api('/api/materials'); }catch(e){ materials = []; }
    render();
  }

  function render(){
    const body = document.getElementById(`${containerId}-matTableBody`);
    if(materials.length === 0){
      body.innerHTML = `<tr><td colspan="4" class="lock-sub">No materials yet — add one below.</td></tr>`;
      return;
    }
    body.innerHTML = materials.map(mat => `
      <tr>
        <td>${escapeHtml(mat.name)}</td>
        <td>${mat.track_quantity ? '✓' : '—'}</td>
        <td>${mat.track_amount ? '✓' : '—'}</td>
        <td><button class="status-toggle ${mat.active ? 'active' : 'inactive'}" data-toggle-active="${mat.id}">${mat.active ? 'Active' : 'Inactive'}</button></td>
      </tr>
    `).join('');
    body.querySelectorAll('[data-toggle-active]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const mat = materials.find(m => String(m.id) === btn.dataset.toggleActive);
        try{
          await api(`/api/materials/${mat.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ active: !mat.active }) });
          await load();
        }catch(e){ showToast('Could not update (sign in first)'); }
      });
    });
  }

  document.getElementById(`${containerId}-newMatAdd`).addEventListener('click', async () => {
    const nameEl = document.getElementById(`${containerId}-newMatName`);
    const qtyEl = document.getElementById(`${containerId}-newMatQty`);
    const amtEl = document.getElementById(`${containerId}-newMatAmt`);
    const name = nameEl.value.trim();
    if(!name){ showToast('Enter a material name'); return; }
    const trackQty = !!qtyEl.checked, trackAmt = !!amtEl.checked;
    if(!trackQty && !trackAmt){ showToast('Select Quantity and/or Amount'); return; }
    try{
      await api('/api/materials', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ name, track_quantity: trackQty, track_amount: trackAmt })
      });
      showToast('Material added ✓');
      nameEl.value = ''; qtyEl.checked = true; amtEl.checked = true;
      await load();
    }catch(e){ showToast('Could not add material (sign in first)'); }
  });

  load();
}

// ===========================================================================
// Material — "Materials Got" page (calendar + daily boxes only)
// ===========================================================================
function hasAnyMaterial(map, day){
  const d = map[day];
  if(!d) return false;
  return Object.values(d).some(v => num(v.quantity) !== 0 || num(v.amount) !== 0);
}
function materialDayStatus(map, day){ return hasAnyMaterial(map, day) ? 'good' : 'empty'; }

function initMaterialGotView(containerId){
  const container = document.getElementById(containerId);
  if(!container) return;
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

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
      </div>
      <div class="card form-card">
        <div class="section-title">Material used / received</div>
        <div class="material-grid" id="${containerId}-materials"></div>
      </div>
    </div>
  `;

  const state = { year:0, month:0, day:0, map:{}, materials:[] };
  const now = new Date();
  state.year = now.getFullYear(); state.month = now.getMonth()+1; state.day = now.getDate();

  async function loadMaterials(){
    try{ state.materials = await api('/api/materials'); }catch(e){ state.materials = []; }
  }

  let saveTimer = null;
  function scheduleSave(day, materialId, field, value){
    if(!state.map[day]) state.map[day] = {};
    if(!state.map[day][materialId]) state.map[day][materialId] = { quantity:0, amount:0 };
    state.map[day][materialId][field] = value;
    renderMonthStats(); updateCalTile(day);

    setSyncing(true);
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try{
        await api(`/api/material-entries/${state.year}/${state.month}/${day}`, {
          method:'PUT', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ entries: state.map[day] })
        });
        setSyncing(false);
        showToast('Saved to server ✓');
      }catch(e){ setSyncing(false, true); }
    }, 500);
  }

  async function loadMonth(){
    try{ state.map = await api(`/api/material-entries/${state.year}/${state.month}`); }
    catch(e){ state.map = {}; }
    renderCalendar(); renderMonthStats(); renderDayForm();
  }

  function renderDayForm(){
    const d = new Date(state.year, state.month-1, state.day);
    const weekday = d.toLocaleDateString('en-IN', {weekday:'long'});
    document.getElementById(`${containerId}-dayTitle`).textContent = `${weekday}, ${state.day} ${monthNames[state.month-1]} ${state.year}`;
    document.getElementById(`${containerId}-daySub`).textContent = 'Goods used / received — both outlets';

    const grid = document.getElementById(`${containerId}-materials`);
    const dayData = state.map[state.day] || {};
    const hasDataThisDay = (matId) => {
      const e = dayData[matId];
      return !!e && (num(e.quantity) !== 0 || num(e.amount) !== 0);
    };
    const visibleMaterials = state.materials.filter(m => m.active || hasDataThisDay(m.id));
    if(visibleMaterials.length === 0){
      grid.innerHTML = `<div class="lock-sub">No active materials — add or activate one in the "All Materials" tab.</div>`;
      return;
    }
    grid.innerHTML = visibleMaterials.map(mat => {
      const entry = dayData[mat.id] || {};
      const qty = entry.quantity !== undefined ? entry.quantity : '';
      const amt = entry.amount !== undefined ? entry.amount : '';
      return `
        <div class="material-box">
          <div class="material-name"><span>${escapeHtml(mat.name)}${!mat.active ? ' <span style="color:var(--chili);font-size:11px;">(inactive)</span>' : ''}</span></div>
          <div class="material-inputs">
            ${mat.track_quantity ? `
            <div class="field">
              <label>Quantity</label>
              <div class="field-input-wrap">
                <input type="number" inputmode="decimal" step="any" placeholder="0" value="${qty}"
                  data-material="${mat.id}" data-field="quantity">
              </div>
            </div>` : ''}
            ${mat.track_amount ? `
            <div class="field">
              <label>Amount</label>
              <div class="field-input-wrap">
                <input type="number" inputmode="decimal" step="any" placeholder="0" value="${amt}"
                  data-material="${mat.id}" data-field="amount">
                <span class="unit">₹</span>
              </div>
            </div>` : ''}
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('input[data-material]').forEach(inp => {
      inp.addEventListener('input', () => scheduleSave(state.day, inp.dataset.material, inp.dataset.field, inp.value));
    });
  }

  function renderCalendar(){
    document.getElementById(`${containerId}-calTitle`).textContent = `${monthNames[state.month-1]} ${state.year}`;
    const grid = document.getElementById(`${containerId}-calGrid`);
    const nDays = daysInMonth(state.year, state.month);
    const firstDow = new Date(state.year, state.month-1, 1).getDay();
    const now2 = new Date();
    const isCurMonth = now2.getFullYear()===state.year && (now2.getMonth()+1)===state.month;
    let html = dowNames.map(dn => `<div class="cal-dow">${dn}</div>`).join('');
    for(let i=0;i<firstDow;i++) html += `<div class="cal-day empty"></div>`;
    for(let day=1; day<=nDays; day++){
      const status = materialDayStatus(state.map, day);
      const classes = ['cal-day'];
      if(status !== 'empty') classes.push('filled', 'status-'+status);
      if(day === state.day) classes.push('selected');
      if(isCurMonth && day === now2.getDate()) classes.push('today');
      html += `<div class="${classes.join(' ')}" data-day="${day}">${day}</div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.cal-day[data-day]').forEach(el => {
      el.addEventListener('click', () => {
        const day = parseInt(el.dataset.day,10);
        if(!canEditDates() && day !== now2.getDate()){
          showToast('🔒 Sign in to change the date');
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
    const status = materialDayStatus(state.map, day);
    el.className = 'cal-day' + (status!=='empty' ? ' filled status-'+status : '') + (day===state.day ? ' selected' : '');
    const now2 = new Date();
    if(now2.getFullYear()===state.year && (now2.getMonth()+1)===state.month && day===now2.getDate()) el.classList.add('today');
  }

  function renderMonthStats(){
    const nDays = daysInMonth(state.year, state.month);
    let filledDays=0, totalAmount=0;
    for(let day=1; day<=nDays; day++){
      if(!hasAnyMaterial(state.map, day)) continue;
      filledDays++;
      Object.values(state.map[day]).forEach(e => totalAmount += num(e.amount));
    }
    document.getElementById(`${containerId}-monthStats`).innerHTML = `
      <div class="stat-row"><span class="lbl">Days logged</span><span class="val">${filledDays}/${nDays}</span></div>
      <div class="stat-row"><span class="lbl">Total spent</span><span class="val">${fmtMoney(totalAmount)}</span></div>
    `;
  }

  async function changeMonth(delta){
    if(!canEditDates()){ showToast('🔒 Sign in to change the date'); return; }
    state.month += delta;
    if(state.month < 1){ state.month = 12; state.year--; }
    if(state.month > 12){ state.month = 1; state.year++; }
    const nDays = daysInMonth(state.year, state.month);
    if(state.day > nDays) state.day = nDays;
    await loadMonth();
  }
  async function changeDay(delta){
    if(!canEditDates()){ showToast('🔒 Sign in to change the date'); return; }
    const nDays = daysInMonth(state.year, state.month);
    let d = state.day + delta;
    if(d < 1){ await changeMonth(-1); state.day = daysInMonth(state.year, state.month); renderCalendar(); renderDayForm(); return; }
    if(d > nDays){ await changeMonth(1); state.day = 1; renderCalendar(); renderDayForm(); return; }
    state.day = d;
    renderCalendar(); renderDayForm();
  }
  async function goToday(){
    const now2 = new Date();
    state.year = now2.getFullYear(); state.month = now2.getMonth()+1; state.day = now2.getDate();
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
    });
  });

  (async () => { await loadMaterials(); await loadMonth(); })();
  return state;
}

// ===========================================================================
// Material — "Report" page (date-range totals per material)
// ===========================================================================
function initMaterialReportView(containerId){
  const container = document.getElementById(containerId);
  if(!container) return;
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth()+1)}-${pad2(today.getDate())}`;
  const monthStartStr = `${today.getFullYear()}-${pad2(today.getMonth()+1)}-01`;

  container.innerHTML = `
    <div class="card form-card">
      <div class="section-title">Generate material report for a date range</div>
      <div class="add-material-row">
        <label>From <input type="date" id="${containerId}-from" value="${monthStartStr}"></label>
        <label>To <input type="date" id="${containerId}-to" value="${todayStr}"></label>
        <button class="today-btn" id="${containerId}-generate">Generate</button>
      </div>
    </div>
    <div class="card form-card" style="margin-top:14px;">
      <div class="section-title">Totals</div>
      <div id="${containerId}-result"><div class="lock-sub">Pick a date range and tap Generate.</div></div>
    </div>
  `;

  const fromEl = document.getElementById(`${containerId}-from`);
  const toEl = document.getElementById(`${containerId}-to`);
  const resultEl = document.getElementById(`${containerId}-result`);

  async function generate(){
    const from = fromEl.value, to = toEl.value;
    if(!from || !to) return;
    if(from > to){ resultEl.innerHTML = `<div class="lock-sub">From date must be on or before the To date.</div>`; return; }
    resultEl.innerHTML = `<div class="lock-sub">Generating…</div>`;
    try{
      const data = await api(`/api/materials/report/${from}/${to}`);
      if(data.materials.length === 0){ resultEl.innerHTML = `<div class="lock-sub">No materials yet.</div>`; return; }
      resultEl.innerHTML = `
        <table class="materials-table">
          <thead><tr><th>Material</th><th>Total Quantity</th><th>Total Amount</th></tr></thead>
          <tbody>
            ${data.materials.map(m => `
              <tr>
                <td>${escapeHtml(m.name)}</td>
                <td>${m.track_quantity ? Number(m.totalQuantity).toLocaleString('en-IN') : '—'}</td>
                <td>${m.track_amount ? fmtMoney(Number(m.totalAmount)) : '—'}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }catch(e){
      resultEl.innerHTML = `<div class="lock-sub">🔒 Owner sign-in required to view the material report.</div>`;
    }
  }

  document.getElementById(`${containerId}-generate`).addEventListener('click', generate);
  fromEl.addEventListener('change', generate);
  toEl.addEventListener('change', generate);
  generate(); // show current month's totals immediately, no click needed
}


// ===========================================================================
// Material — "Payment" page (calendar + amount-only box per material)
// ===========================================================================
function hasAnyMaterialPayment(map, day){
  const d = map[day];
  if(!d) return false;
  return Object.values(d).some(v => num(v) !== 0);
}
function materialPaymentDayStatus(map, day){ return hasAnyMaterialPayment(map, day) ? 'good' : 'empty'; }

function initMaterialPaymentView(containerId){
  const container = document.getElementById(containerId);
  if(!container) return;
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

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
      </div>
      <div class="card form-card">
        <div class="section-title">Amount paid per material</div>
        <div class="material-grid" id="${containerId}-materials"></div>
      </div>
      <div class="card results-card">
        <div class="results-title">Total paid today</div>
        <div class="stat-grid" id="${containerId}-dayTotal"></div>
      </div>
      <div class="card form-card">
        <div class="section-title">Last Month Remaining (opening balance — not tied to any date)</div>
        <div class="material-grid" id="${containerId}-carryover"></div>
      </div>
    </div>
  `;

  const state = { year:0, month:0, day:0, map:{}, materials:[] };
  const now = new Date();
  state.year = now.getFullYear(); state.month = now.getMonth()+1; state.day = now.getDate();

  async function loadMaterials(){
    try{ state.materials = await api('/api/materials'); }catch(e){ state.materials = []; }
  }

  let saveTimer = null;
  function scheduleSave(day, materialId, value){
    if(!state.map[day]) state.map[day] = {};
    state.map[day][materialId] = value;
    renderDayTotal(); renderMonthStats(); updateCalTile(day);

    setSyncing(true);
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try{
        await api(`/api/material-payments/${state.year}/${state.month}/${day}`, {
          method:'PUT', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ entries: state.map[day] })
        });
        setSyncing(false);
        showToast('Saved to server ✓');
      }catch(e){ setSyncing(false, true); }
    }, 500);
  }

  async function loadMonth(){
    try{ state.map = await api(`/api/material-payments/${state.year}/${state.month}`); }
    catch(e){ state.map = {}; }
    renderCalendar(); renderMonthStats(); renderDayForm();
  }

  let carryTimer = null;
  function renderCarryover(){
    const grid = document.getElementById(`${containerId}-carryover`);
    const activeMaterials = state.materials.filter(m => m.active);
    if(activeMaterials.length === 0){
      grid.innerHTML = `<div class="lock-sub">No active materials.</div>`;
      return;
    }
    grid.innerHTML = activeMaterials.map(mat => `
      <div class="material-box">
        <div class="material-name"><span>${escapeHtml(mat.name)}</span></div>
        <div class="material-inputs">
          <div class="field">
            <label>Last Month Remaining</label>
            <div class="field-input-wrap">
              <input type="number" inputmode="decimal" step="any" placeholder="0" value="${mat.last_month_remaining ?? 0}"
                data-carryover="${mat.id}">
              <span class="unit">₹</span>
            </div>
          </div>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('input[data-carryover]').forEach(inp => {
      inp.addEventListener('input', () => {
        clearTimeout(carryTimer);
        setSyncing(true);
        carryTimer = setTimeout(async () => {
          try{
            await api(`/api/materials/${inp.dataset.carryover}`, {
              method:'PUT', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({ last_month_remaining: inp.value })
            });
            setSyncing(false);
            showToast('Saved to server ✓');
          }catch(e){ setSyncing(false, true); }
        }, 500);
      });
    });
  }
  function renderDayForm(){
    const d = new Date(state.year, state.month-1, state.day);
    const weekday = d.toLocaleDateString('en-IN', {weekday:'long'});
    document.getElementById(`${containerId}-dayTitle`).textContent = `${weekday}, ${state.day} ${monthNames[state.month-1]} ${state.year}`;
    document.getElementById(`${containerId}-daySub`).textContent = 'Amount paid to material suppliers — both outlets';

    const grid = document.getElementById(`${containerId}-materials`);
    const dayData = state.map[state.day] || {};
    const hasDataThisDay = (matId) => num(dayData[matId]) !== 0;
    const visibleMaterials = state.materials.filter(m => m.active || hasDataThisDay(m.id));
    if(visibleMaterials.length === 0){
      grid.innerHTML = `<div class="lock-sub">No active materials — add or activate one in the "All Materials" tab.</div>`;
      renderDayTotal();
      return;
    }
    grid.innerHTML = visibleMaterials.map(mat => {
      const val = dayData[mat.id] !== undefined ? dayData[mat.id] : '';
      return `
        <div class="material-box">
          <div class="material-name"><span>${escapeHtml(mat.name)}${!mat.active ? ' <span style="color:var(--chili);font-size:11px;">(inactive)</span>' : ''}</span></div>
          <div class="material-inputs">
            <div class="field">
              <label>Amount Paid</label>
              <div class="field-input-wrap">
                <input type="number" inputmode="decimal" step="any" placeholder="0" value="${val}"
                  data-material="${mat.id}">
                <span class="unit">₹</span>
              </div>
            </div>
          </div>
        </div>`;
    }).join('');

    grid.querySelectorAll('input[data-material]').forEach(inp => {
      inp.addEventListener('input', () => scheduleSave(state.day, inp.dataset.material, inp.value));
    });
    renderDayTotal();
  }

  function renderDayTotal(){
    const dayData = state.map[state.day] || {};
    const total = Object.values(dayData).reduce((s,v) => s + num(v), 0);
    document.getElementById(`${containerId}-dayTotal`).innerHTML =
      `<div class="stat-card"><div class="s-label">Total Paid</div><div class="s-value">${fmtMoney(total)}</div></div>`;
  }

  function renderCalendar(){
    document.getElementById(`${containerId}-calTitle`).textContent = `${monthNames[state.month-1]} ${state.year}`;
    const grid = document.getElementById(`${containerId}-calGrid`);
    const nDays = daysInMonth(state.year, state.month);
    const firstDow = new Date(state.year, state.month-1, 1).getDay();
    const now2 = new Date();
    const isCurMonth = now2.getFullYear()===state.year && (now2.getMonth()+1)===state.month;
    let html = dowNames.map(dn => `<div class="cal-dow">${dn}</div>`).join('');
    for(let i=0;i<firstDow;i++) html += `<div class="cal-day empty"></div>`;
    for(let day=1; day<=nDays; day++){
      const status = materialPaymentDayStatus(state.map, day);
      const classes = ['cal-day'];
      if(status !== 'empty') classes.push('filled', 'status-'+status);
      if(day === state.day) classes.push('selected');
      if(isCurMonth && day === now2.getDate()) classes.push('today');
      html += `<div class="${classes.join(' ')}" data-day="${day}">${day}</div>`;
    }
    grid.innerHTML = html;
    grid.querySelectorAll('.cal-day[data-day]').forEach(el => {
      el.addEventListener('click', () => {
        const day = parseInt(el.dataset.day,10);
        if(!canEditDates() && day !== now2.getDate()){
          showToast('🔒 Sign in to change the date');
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
    const status = materialPaymentDayStatus(state.map, day);
    el.className = 'cal-day' + (status!=='empty' ? ' filled status-'+status : '') + (day===state.day ? ' selected' : '');
    const now2 = new Date();
    if(now2.getFullYear()===state.year && (now2.getMonth()+1)===state.month && day===now2.getDate()) el.classList.add('today');
  }

  function renderMonthStats(){
    const nDays = daysInMonth(state.year, state.month);
    let filledDays=0, totalAmount=0;
    for(let day=1; day<=nDays; day++){
      if(!hasAnyMaterialPayment(state.map, day)) continue;
      filledDays++;
      totalAmount += Object.values(state.map[day]).reduce((s,v)=>s+num(v),0);
    }
    document.getElementById(`${containerId}-monthStats`).innerHTML = `
      <div class="stat-row"><span class="lbl">Days logged</span><span class="val">${filledDays}/${nDays}</span></div>
      <div class="stat-row"><span class="lbl">Total paid</span><span class="val">${fmtMoney(totalAmount)}</span></div>
    `;
  }

  async function changeMonth(delta){
    if(!canEditDates()){ showToast('🔒 Sign in to change the date'); return; }
    state.month += delta;
    if(state.month < 1){ state.month = 12; state.year--; }
    if(state.month > 12){ state.month = 1; state.year++; }
    const nDays = daysInMonth(state.year, state.month);
    if(state.day > nDays) state.day = nDays;
    await loadMonth();
  }
  async function changeDay(delta){
    if(!canEditDates()){ showToast('🔒 Sign in to change the date'); return; }
    const nDays = daysInMonth(state.year, state.month);
    let d = state.day + delta;
    if(d < 1){ await changeMonth(-1); state.day = daysInMonth(state.year, state.month); renderCalendar(); renderDayForm(); return; }
    if(d > nDays){ await changeMonth(1); state.day = 1; renderCalendar(); renderDayForm(); return; }
    state.day = d;
    renderCalendar(); renderDayForm();
  }
  async function goToday(){
    const now2 = new Date();
    state.year = now2.getFullYear(); state.month = now2.getMonth()+1; state.day = now2.getDate();
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
    });
  });

    (async () => { await loadMaterials(); renderCarryover(); await loadMonth(); })();
  return state;
}

// ===========================================================================
// Material — "Payment Report" page (date-range totals paid, per material)
// ===========================================================================
function initMaterialPaymentReportView(containerId){
  const container = document.getElementById(containerId);
  if(!container) return;
  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${pad2(today.getMonth()+1)}-${pad2(today.getDate())}`;
  const monthStartStr = `${today.getFullYear()}-${pad2(today.getMonth()+1)}-01`;

  container.innerHTML = `
    <div class="card form-card">
      <div class="section-title">Generate material payment report for a date range</div>
      <div class="add-material-row">
        <label>From <input type="date" id="${containerId}-from" value="${monthStartStr}"></label>
        <label>To <input type="date" id="${containerId}-to" value="${todayStr}"></label>
        <button class="today-btn" id="${containerId}-generate">Generate</button>
      </div>
    </div>
    <div class="card form-card" style="margin-top:14px;">
      <div class="section-title">Totals</div>
      <div id="${containerId}-result"><div class="lock-sub">Loading…</div></div>
    </div>
  `;

  const fromEl = document.getElementById(`${containerId}-from`);
  const toEl = document.getElementById(`${containerId}-to`);
  const resultEl = document.getElementById(`${containerId}-result`);

  async function generate(){
    const from = fromEl.value, to = toEl.value;
    if(!from || !to) return;
    if(from > to){ resultEl.innerHTML = `<div class="lock-sub">From date must be on or before the To date.</div>`; return; }
    resultEl.innerHTML = `<div class="lock-sub">Generating…</div>`;
    try{
      const data = await api(`/api/material-payments/report/${from}/${to}`);
      if(data.materials.length === 0){ resultEl.innerHTML = `<div class="lock-sub">No materials yet.</div>`; return; }
      resultEl.innerHTML = `
        ${data.crossesMonth ? `<div class="lock-sub" style="margin-bottom:10px;">Range spans a previous month — Last Month Remaining is included below.</div>` : ''}
        <table class="materials-table">
          <thead>
            <tr>
              <th>Material</th>
              ${data.crossesMonth ? '<th>Last Month Remaining</th><th>Paid This Range</th>' : ''}
              <th>${data.crossesMonth ? 'Total' : 'Total Paid'}</th>
            </tr>
          </thead>
          <tbody>
            ${data.materials.map(m => `
              <tr>
                <td>${escapeHtml(m.name)}</td>
                ${data.crossesMonth ? `<td>${fmtMoney(m.carryover)}</td><td>${fmtMoney(m.periodPaid)}</td>` : ''}
                <td>${fmtMoney(m.totalPaid)}</td>
              </tr>
            `).join('')}
            <tr>
              <td><strong>Grand Total</strong></td>
              ${data.crossesMonth ? '<td></td><td></td>' : ''}
              <td><strong>${fmtMoney(Number(data.grandTotal))}</strong></td>
            </tr>
          </tbody>
        </table>
      `;
    }catch(e){
      resultEl.innerHTML = `<div class="lock-sub">🔒 Owner sign-in required to view the material payment report.</div>`;
    }
  }

  document.getElementById(`${containerId}-generate`).addEventListener('click', generate);
  fromEl.addEventListener('change', generate);
  toEl.addEventListener('change', generate);
  generate();
}



initMaterialPaymentView('app-material-payment');
initMaterialPaymentReportView('app-material-payment-report');
initMaterialReportView('app-material-report');
initMaterialsAllView('app-material-all');
initMaterialGotView('app-material');


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

// ---- Report tab: date-range summary panel (sums + averages across a range) ----
function setupRangeReport(containerId){
  const fromEl = document.getElementById(`${containerId}-rangeFrom`);
  const toEl = document.getElementById(`${containerId}-rangeTo`);
  const goBtn = document.getElementById(`${containerId}-rangeGo`);
  const errEl = document.getElementById(`${containerId}-rangeError`);
  const statsEl = document.getElementById(`${containerId}-rangeStats`);

  // Default to the current month so far.
  const now = new Date();
  const firstOfMonth = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-01`;
  const today = `${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}`;
  fromEl.value = firstOfMonth;
  toEl.value = today;

  const RANGE_CARDS = [
    ['jpSale', 'JP Nagar Sale', 'money'], ['truckSale', 'Truck Sale', 'money'], ['totalSale', 'Total Sale', 'money'],
    ['jpDiff', 'JP Nagar Difference', 'money'], ['truckDiff', 'Truck Difference', 'money'], ['totalDiff', 'Total Difference', 'money'],
    ['chickenPlateDiffAll', 'Chicken Plate Diff', 'num'], ['ricePlateDiffAll', 'Rice Plate Diff', 'num'],
    ['chickenReadyRatio', 'Chicken Ready Ratio (avg)', 'ratio'], ['chickenSaleRatio', 'Chicken Sale Ratio (avg)', 'ratio'],
    ['chickenSaleWasteRatio', 'Chicken Sale+Waste Ratio (avg)', 'ratio'], ['riceReadyRatio', 'Rice Ready Ratio (avg)', 'ratio'],
    ['riceSaleRatio', 'Rice Sale Ratio (avg)', 'ratio'], ['riceSaleWasteRatio', 'Rice Sale+Waste Ratio (avg)', 'ratio'],
  ];

  async function generate(){
    errEl.textContent = '';
    statsEl.innerHTML = '';
    const from = fromEl.value, to = toEl.value;
    if(!from || !to){ errEl.textContent = 'Pick both a From and To date.'; return; }
    if(from > to){ errEl.textContent = 'From date must be on or before the To date.'; return; }
    goBtn.disabled = true; goBtn.textContent = 'Generating…';
    try{
      const result = await api(`/api/report/range/${from}/${to}`);
      const t = result.totals;
      const fmt = (kind, v) => kind === 'money' ? fmtMoney(v || 0) : (kind === 'ratio' ? fmtRatio(v) : Math.round(v || 0));
      statsEl.innerHTML = RANGE_CARDS.map(([key,label,kind]) =>
        `<div class="stat-card"><div class="s-label">${label}</div><div class="s-value">${fmt(kind, t[key])}</div></div>`
      ).join('') + `<div class="stat-card"><div class="s-label">Days with data</div><div class="s-value">${t.daysWithData}/${t.daysInRange}</div></div>`;
    }catch(e){
      errEl.textContent = 'Could not generate report: ' + e.message;
    }finally{
      goBtn.disabled = false; goBtn.textContent = 'Generate';
    }
  }

  goBtn.addEventListener('click', generate);
  generate(); // show the current month's numbers immediately
}

function initOwnerDayView(containerId, cfg){
  const container = document.getElementById(containerId);
  if(!container) return; // this page doesn't render this view

  if(!isOwner()){
    container.innerHTML = `
      <div class="card plain owner-lockscreen" style="grid-column:1/-1;">
        <div class="lock-icon">🔒</div>
        <div class="lock-title">${cfg.lockLabel} is owner-only</div>
        <div class="lock-sub">Enter the OWNER password to view ${cfg.lockLabel.toLowerCase()} for any date.</div>
        <button class="today-btn" id="${containerId}-unlockBtn">Enter owner password</button>
      </div>
    `;
    document.getElementById(`${containerId}-unlockBtn`).addEventListener('click', openLoginModal);
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
      ${cfg.rangeReport ? `
      <div class="card results-card" id="${containerId}-rangeCard">
        <div class="results-title">Generate report for a date range</div>
        <div class="range-controls">
          <label>From <input type="date" id="${containerId}-rangeFrom"></label>
          <label>To <input type="date" id="${containerId}-rangeTo"></label>
          <button class="today-btn" id="${containerId}-rangeGo">Generate</button>
        </div>
        <div class="range-error" id="${containerId}-rangeError"></div>
        <div class="stat-grid" id="${containerId}-rangeStats" style="margin-top:10px;"></div>
      </div>` : ''}
      ${cfg.weeklyComparison ? `
      <div class="card results-card" id="${containerId}-weekCompareCard">
        <div class="results-title">This <span id="${containerId}-weekCompareLabel">weekday</span> vs last week</div>
        <div class="stat-grid" id="${containerId}-weekCompareStats"></div>
      </div>` : ''}
      <details class="info-line">
        <summary>How these numbers are calculated</summary>
        ${cfg.infoText}
      </details>
    </div>
  `;

  const state = { year:0, month:0, day:0, data:{truck:{}, jp:{}, itemsUsed:{}} };
  const now = new Date();
  state.year = now.getFullYear(); state.month = now.getMonth()+1; state.day = now.getDate();

  if(cfg.rangeReport) setupRangeReport(containerId);

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
    if(cfg.weeklyComparison) renderWeekCompare();
  }

  async function renderWeekCompare(){
    const pad2 = n => String(n).padStart(2,'0');
    const dateStr = `${state.year}-${pad2(state.month)}-${pad2(state.day)}`;
    const d = new Date(state.year, state.month-1, state.day);
    const weekday = d.toLocaleDateString('en-IN', {weekday:'long'});
    const labelEl = document.getElementById(`${containerId}-weekCompareLabel`);
    const statsEl = document.getElementById(`${containerId}-weekCompareStats`);
    if(!statsEl) return;
    labelEl.textContent = weekday;
    statsEl.innerHTML = `<div class="stat-card"><div class="s-label">Loading…</div></div>`;
    try{
      const comp = await api(`/api/report/weekly-comparison/${dateStr}`);
      const cur = comp.current, prev = comp.previous;

      const cardsFor = (r) => [
        ['JP Nagar Sale', r.report.jpSale],
        ['Truck Sale', r.report.truckSale],
      ].map(([label,val]) =>
        `<div class="stat-card"><div class="s-label">${label}</div><div class="s-value">${fmtMoney(val)}</div></div>`
      ).join('');

      statsEl.innerHTML = `
        <div class="week-compare-cols">
          <div>
            <div class="results-title" style="font-size:13px;">This ${weekday} (${cur.date})</div>
            <div class="stat-grid">${cardsFor(cur)}</div>
          </div>
          <div>
            <div class="results-title" style="font-size:13px;">Last ${weekday} (${prev.date})</div>
            <div class="stat-grid">${cardsFor(prev)}</div>
          </div>
        </div>
      `;
    }catch(e){
      statsEl.innerHTML = `<div class="stat-card"><div class="s-label">Couldn't load comparison</div><div class="s-value" style="font-size:13px;color:var(--steel);">${e.message}</div></div>`;
    }
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
  rangeReport: true,
  weeklyComparison: true,
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
  if(!container) return; // this page doesn't render this view

  if(!isOwner()){
    container.innerHTML = `
      <div class="card plain owner-lockscreen" style="grid-column:1/-1;">
        <div class="lock-icon">🔒</div>
        <div class="lock-title">Payment is owner-only</div>
        <div class="lock-sub">Enter the OWNER password to log salary payments and see who's owed what.</div>
        <button class="today-btn" id="${containerId}-unlockBtn">Enter owner password</button>
      </div>
    `;
    document.getElementById(`${containerId}-unlockBtn`).addEventListener('click', openLoginModal);
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