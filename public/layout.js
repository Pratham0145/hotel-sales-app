// ===========================================================================
// layout.js — shared chrome for every page: sidebar, auth state, login modal.
// Loaded BEFORE app.js on every page.
//
// Two roles:
//   worker -> Food Truck / JP Nagar / Items Used, and may change the date.
//   owner  -> everything above + Amount, Report (with date-range report)
//             and Payment.
// ===========================================================================

const AUTH = {
  password: sessionStorage.getItem('appPassword') || null,
  role: sessionStorage.getItem('appRole') || 'guest',
};

function isOwner(){ return AUTH.role === 'owner'; }
function isWorker(){ return AUTH.role === 'worker'; }
function isSignedIn(){ return AUTH.role === 'owner' || AUTH.role === 'worker'; }
// Workers and owners may both pick a different date to write to.
function canEditDates(){ return isSignedIn(); }
function authHeaders(){
  return AUTH.password
    ? { 'X-App-Password': AUTH.password, 'X-Owner-Password': AUTH.password }
    : {};
}

async function api(path, opts){
  const merged = Object.assign({}, opts);
  merged.headers = Object.assign({}, (opts && opts.headers) || {}, authHeaders());
  const res = await fetch(path, merged);
  if(!res.ok) throw new Error('API error ' + res.status);
  return res.json();
}

function signOut(){
  sessionStorage.removeItem('appPassword');
  sessionStorage.removeItem('appRole');
  location.href = '/Login';
}

// ---------------------------------------------------------------------------
// Navigation model — each item is its own URL (redirect-style navigation).
// ---------------------------------------------------------------------------
const NAV_GROUPS = [
  {
    title: 'Outlets',
    items: [
      { key: 'foodtruck', label: 'Food Truck', icon: '🚚', href: '/FoodTruck' },
      { key: 'jpnagar',   label: 'JP Nagar',   icon: '🏠', href: '/JPNagar' },
      { key: 'items',     label: 'Items Used', icon: '📦', href: '/Items' },
    ],
  },
  {
    title: 'Owner Access',
    ownerOnly: true,
    items: [
      { key: 'amount',  label: 'Amount',  icon: '💰', href: '/Amount' },
      { key: 'report',  label: 'Report',  icon: '📊', href: '/Report' },
      { key: 'payment', label: 'Payment', icon: '💵', href: '/Payment' },
    ],
  },
];

function renderChrome(){
  const page = document.body.dataset.page || '';

  // ---- Sidebar ----
  const nav = document.getElementById('layout-nav');
  if(nav){
    nav.innerHTML = NAV_GROUPS.map(group => {
      if(group.ownerOnly && !isOwner()){
        // Hidden entirely for workers / signed-out visitors.
        return '';
      }
      return `
        <div class="nav-group${group.ownerOnly ? ' owner-group' : ''}">
          <div class="nav-group-title">${group.title}</div>
          ${group.items.map(item => `
            <a class="nav-item${item.key === page ? ' active' : ''}" href="${item.href}">
              <span class="nav-ico">${item.icon}</span><span>${item.label}</span>
            </a>
          `).join('')}
        </div>`;
    }).join('') + `
      <div class="nav-group">
        <div class="nav-group-title">Session</div>
        <div class="nav-role role-${AUTH.role}">${
          isOwner() ? '👑 Owner access'
          : isWorker() ? '🧑‍🍳 Worker access'
          : '🔒 Not signed in'
        }</div>
        ${isSignedIn()
          ? `<button class="nav-item as-btn" id="navSignOut"><span class="nav-ico">🚪</span><span>Sign out</span></button>`
          : `<a class="nav-item as-btn" href="/Login"><span class="nav-ico">🔑</span><span>Sign in</span></a>`}
      </div>`;

    const out = document.getElementById('navSignOut');
    if(out) out.addEventListener('click', () => { if(confirm('Sign out?')) signOut(); });
  }

  // ---- Header sign-in button ----
  const btn = document.getElementById('ownerLockBtn');
  if(btn){
    if(isOwner()){ btn.textContent = '👑 Owner — tap to sign out'; btn.classList.add('unlocked'); }
    else if(isWorker()){ btn.textContent = '🧑‍🍳 Worker — tap to sign out'; btn.classList.add('unlocked'); }
    else { btn.textContent = '🔒 Sign in'; btn.classList.remove('unlocked'); }
    btn.addEventListener('click', () => {
      if(isSignedIn()){ if(confirm('Sign out?')) signOut(); return; }
      openLoginModal();
    });
  }
}

// ---------------------------------------------------------------------------
// Login modal (also used by the owner lock screens inside Amount/Report/Payment)
// ---------------------------------------------------------------------------
function openLoginModal(){
  const backdrop = document.getElementById('ownerModalBackdrop');
  if(!backdrop){ location.href = '/Login'; return; }
  backdrop.classList.add('show');
  document.getElementById('ownerModalError').textContent = '';
  const input = document.getElementById('ownerPasswordInput');
  input.value = '';
  input.focus();
}
function closeLoginModal(){
  const backdrop = document.getElementById('ownerModalBackdrop');
  if(backdrop) backdrop.classList.remove('show');
}

// Verify a password against the server and remember the role it granted.
async function signInWithPassword(pw){
  const res = await fetch('/api/auth/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: pw }),
  });
  if(!res.ok) return null;
  const data = await res.json();
  AUTH.password = pw;
  AUTH.role = data.role || 'worker';
  sessionStorage.setItem('appPassword', pw);
  sessionStorage.setItem('appRole', AUTH.role);
  return AUTH.role;
}

async function submitLoginModal(){
  const pw = document.getElementById('ownerPasswordInput').value;
  const role = await signInWithPassword(pw);
  if(!role){ document.getElementById('ownerModalError').textContent = 'Wrong password.'; return; }
  closeLoginModal();
  location.reload();
}

function wireLoginModal(){
  const cancel = document.getElementById('ownerModalCancel');
  if(cancel) cancel.addEventListener('click', closeLoginModal);
  const submit = document.getElementById('ownerModalSubmit');
  if(submit) submit.addEventListener('click', submitLoginModal);
  const input = document.getElementById('ownerPasswordInput');
  if(input) input.addEventListener('keydown', (e) => { if(e.key === 'Enter') submitLoginModal(); });
}

renderChrome();
wireLoginModal();
