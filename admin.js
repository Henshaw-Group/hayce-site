/* Admin utility (no Google OAuth):
   - Anonymous Auth only
   - Verify email+passcode against admins_registry/{emailHash}
   - If correct, register this browser: admins/{auth.uid} { role:'admin', active:true, ... }
   - Then we can read waitlist/{id} per rules.
*/
import { CONFIG } from './config.js';

const qs = (s, el = document) => el.querySelector(s);
const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);

// Firebase imports on demand
let initializeApp;
let getAuth, signInAnonymously, signOut, onAuthStateChanged;
let initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider, getToken;
let getFirestore, serverTimestamp, doc, getDoc, setDoc, deleteDoc;

let app = null, db = null, auth = null;
let currentUser = null;
let isAdmin = false;

document.addEventListener('DOMContentLoaded', async () => {
  // year
  const y = qs('#year'); if (y) y.textContent = new Date().getFullYear();

  // prefill project/collection from CONFIG
  const projectInput = qs('#projectId');
  const collInput = qs('#collection');
  if (CONFIG?.firebase?.projectId) projectInput.value = CONFIG.firebase.projectId;
  collInput.value = CONFIG?.firebase?.collection || collInput.value || 'waitlist';

  // prefill lookup email via ?email=
  const p = new URLSearchParams(location.search);
  const preEmail = p.get('email');
  if (preEmail) qs('#email').value = preEmail;

  // wire UI
  qs('#lookup-form').addEventListener('submit', onCompute);
  qs('#clear').addEventListener('click', onClear);
  document.body.addEventListener('click', onCopyClick);

  qs('#admin-login-form').addEventListener('submit', onVerifyRegister);
  qs('#unregister').addEventListener('click', doUnregister);
  qs('#rotate-id').addEventListener('click', rotateAnon);

  // NEW: Sign up (create registry) button
  const btnSignup = qs('#btn-signup');
  if (btnSignup) btnSignup.addEventListener('click', onSignupCreate);

  // dev helper visible only local (remove from DOM in non-local)
if (isLocal) {
  qs('#dev-gen').hidden = false;
  qs('#devMake').addEventListener('click', devGenerate);
} else {
  const dev = qs('#dev-gen');
  if (dev) dev.remove();
}


  // Firebase boot
  await importFirebase();
  await initFirebaseAndAppCheck();
  await loadSelfServeFlag(); // NEW: hide/disable sign-up if toggle is off
  await ensureAnonAuth();


  // if email was prefilled, auto-compute
  if (preEmail) onCompute(new Event('submit'));
});

function onCopyClick(e) {
  const btn = e.target.closest('[data-copy]');
  if (!btn) return;
  const sel = btn.getAttribute('data-copy');
  const el = qs(sel);
  if (!el) return;
  copyToClipboard(el.textContent || '');
  btn.textContent = 'Copied!';
  setTimeout(() => (btn.textContent = 'Copy'), 1000);
}

async function importFirebase() {
  const [
    appMod,
    authMod,
    appCheckMod,
    fsMod
  ] = await Promise.all([
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js'),
    import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js')
  ]);

  ({ initializeApp } = appMod);
  ({ getAuth, signInAnonymously, signOut, onAuthStateChanged } = authMod);
  ({ initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider, getToken } = appCheckMod);
  ({ getFirestore, serverTimestamp, doc, getDoc, setDoc, deleteDoc } = fsMod);
}

async function initFirebaseAndAppCheck() {
  const { firebase, appCheck } = CONFIG;
  if (!firebase?.apiKey || !firebase?.projectId || !firebase?.appId) {
    qs('#appcheck-ind').textContent = 'misconfigured (missing Firebase config)';
    throw new Error('Missing Firebase config in config.js');
  }

  app = initializeApp(firebase);
  db = getFirestore(app);

  // App Check (Enterprise or v3)
  try {
    if (appCheck?.debug && isLocal) {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = appCheck.debug === true ? true : String(appCheck.debug);
    }
    let provider;
    if (appCheck?.provider === 'recaptchaEnterprise' && appCheck?.siteKey) {
      provider = new ReCaptchaEnterpriseProvider(appCheck.siteKey);
    } else if (appCheck?.provider === 'recaptchaV3' && appCheck?.siteKey) {
      provider = new ReCaptchaV3Provider(appCheck.siteKey);
    }
    if (provider) {
      const ac = initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
      try {
        const tok = await getToken(ac, true);
        qs('#appcheck-ind').textContent = tok?.token ? 'ok' : 'missing';
      } catch {
        qs('#appcheck-ind').textContent = 'failed to acquire token';
      }
    } else {
      qs('#appcheck-ind').textContent = 'skipped (no siteKey/provider)';
    }
  } catch (e) {
    qs('#appcheck-ind').textContent = 'error';
    console.warn('[Admin] App Check failed:', e);
  }
}

async function loadSelfServeFlag() {
  try {
    // Read once; rules allow public read
    const s = await getDoc(doc(db, 'public_settings', 'security'));
    const allowed = s.exists() && s.data()?.allowSelfServeAdmin === true;

    const btn = qs('#btn-signup');
    if (btn) {
      btn.disabled = !allowed;
      btn.hidden = !allowed;  // hide when disabled, show only when explicitly allowed
    }
  } catch (e) {
    // On any error, be conservative: hide/disable the sign-up button
    const btn = qs('#btn-signup');
    if (btn) {
      btn.disabled = true;
      btn.hidden = true;
    }
    console.warn('[Admin] loadSelfServeFlag failed; hiding sign-up:', e);
  }
}


async function ensureAnonAuth() {
  auth = getAuth(app);
  onAuthStateChanged(auth, async (user) => {
    currentUser = user || null;
    const authStatus = qs('#auth-status');
    const unregisterBtn = qs('#unregister');
    const rotateBtn = qs('#rotate-id');

    if (!user) {
      authStatus.textContent = 'Signed out';
      unregisterBtn.disabled = true;
      rotateBtn.disabled = true;
      setAdmin(false, 'not registered');
      return;
    }

    authStatus.textContent = `Anon UID: ${user.uid}`;
    unregisterBtn.disabled = false;
    rotateBtn.disabled = false;

    // is this UID registered as admin?
    await refreshAdminStatus();
  });

    // Start / ensure signed in
  try {
    if (!auth.currentUser) await signInAnonymously(auth);
  } catch (e) {
    const code = String(e?.code || '');
    let msg = 'Anonymous sign-in failed';
    if (code === 'auth/admin-restricted-operation' || code === 'auth/operation-not-allowed') {
      msg = 'Anonymous sign-in is disabled for this project';
      const tip = qs('#auth-error-tip');
      if (tip) {
        tip.hidden = false;
        tip.innerHTML = 'Anonymous sign-in is disabled for this project. ' +
          'Open Firebase Console → <b>Authentication</b> → <b>Sign-in method</b>, enable <b>Anonymous</b>. ' +
          'Also ensure your domain is in <b>Authorized domains</b>.';
      }
    }
    qs('#auth-status').textContent = `${msg} (${code})`;
    console.warn('[Admin] Anonymous sign-in error:', e);
  }

}

async function refreshAdminStatus() {
  if (!currentUser) return setAdmin(false, 'not registered');
  try {
    const adminDoc = await getDoc(doc(db, 'admins', currentUser.uid));
    if (adminDoc.exists() && adminDoc.data()?.active === true && adminDoc.data()?.role === 'admin') {
      setAdmin(true, 'registered');
    } else {
      setAdmin(false, 'not registered');
    }
  } catch (e) {
    console.warn('[Admin] check failed', e);
    setAdmin(false, 'unknown');
  }
}

function setAdmin(flag, msg) {
  isAdmin = !!flag;
  const el = qs('#admin-status');
  el.innerHTML = `Admin: <span class="badge ${flag ? 'ok':'warn'}">${msg}</span>`;
  qs('#existence').textContent = flag ? 'Ready — compute an email and we’ll check.' : 'Register as admin to check existence.';

  const btn = qs('#btn-signup');
  if (btn && flag) { btn.disabled = true; btn.hidden = true; }

}

async function rotateAnon() {
  try {
    await signOut(auth);
    await signInAnonymously(auth);
  } catch (e) {
    console.warn('[Admin] rotate anon failed', e);
  }
}

async function doUnregister() {
  if (!currentUser) return;
  try {
    await deleteDoc(doc(db, 'admins', currentUser.uid));
    await refreshAdminStatus();
	await loadSelfServeFlag(); // NEW: restore button visibility according to settings

  } catch (e) {
    console.warn('[Admin] unregister failed', e);
  }
}

/* -------- Admin SIGN UP (create admins_registry) ---------- */
async function onSignupCreate() {
  const email = (qs('#adminEmail').value || '').trim().toLowerCase();
  const pass = (qs('#adminPass').value || '').trim();
  qs('#error-adminEmail').textContent = '';
  qs('#error-adminPass').textContent = '';
  setLoginStatus('');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    qs('#error-adminEmail').textContent = 'Enter a valid email.';
    return;
  }
  if (!pass) {
    qs('#error-adminPass').textContent = 'Enter your passcode.';
    return;
  }
  if (!currentUser) {
    setLoginStatus('Not signed in (anon). Reload and try again.', 'error');
    return;
  }
  
   try {
    const s = await getDoc(doc(db, 'public_settings', 'security'));
    const allowed = s.exists() && s.data()?.allowSelfServeAdmin === true;
    if (!allowed) {
      setLoginStatus('Self-serve sign up is currently disabled by admin.', 'error');
      const btn = qs('#btn-signup');
      if (btn) { btn.disabled = true; btn.hidden = true; }
      return;
    }
  } catch (e) {
    setLoginStatus('Sign up unavailable (couldn’t read settings).', 'error');
    return;
  }

  try {
    const emailHash = await sha256Hex(email);
    const regRef = doc(db, 'admins_registry', emailHash);
    const existsSnap = await getDoc(regRef);
    if (existsSnap.exists()) {
      setLoginStatus('A registry entry already exists for this email. Use “Verify & Register”.', 'warn');
      return;
    }

    const salt = randomSaltHex(16); // 16 bytes => 32 hex chars
    const passHash = await kdfSHA256Hex(pass, salt, 5000);

    await setDoc(regRef, {
      email,
      emailHash,
      salt,
      passHash,
      role: 'admin',
      allowed: true,
      createdAt: serverTimestamp(),
      createdBy: currentUser.uid,
      createdFromUA: navigator.userAgent || null,
      note: 'self-serve signup'
    });

    setLoginStatus('Registry created ✔︎. Now click “Verify & Register this browser”.');
  } catch (e) {
    console.warn('[Admin] signup/create failed', e);
    const code = String(e?.code || '');
    if (code.includes('permission-denied')) {
      setLoginStatus('Permission denied. Temporarily enable self-serve in Firestore rules (public_settings/security.allowSelfServeAdmin = true).', 'error');
    } else if (code.includes('failed-precondition')) {
      setLoginStatus('App Check required. Enable debug for localhost.', 'error');
    } else {
      setLoginStatus('Sign up failed. See console.', 'error');
    }
  }
}

/* -------- Admin VERIFY + REGISTER ---------- */
async function onVerifyRegister(ev) {
  ev.preventDefault();
  const email = (qs('#adminEmail').value || '').trim().toLowerCase();
  const pass = (qs('#adminPass').value || '').trim();
  qs('#error-adminEmail').textContent = '';
  qs('#error-adminPass').textContent = '';
  setLoginStatus('');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    qs('#error-adminEmail').textContent = 'Enter a valid email.';
    return;
  }
  if (!pass) {
    qs('#error-adminPass').textContent = 'Enter your passcode.';
    return;
  }
  if (!currentUser) {
    setLoginStatus('Not signed in (anon). Reload and try again.', 'error');
    return;
  }

  try {
    const emailHash = await sha256Hex(email);
    const regRef = doc(db, 'admins_registry', emailHash);
    const regSnap = await getDoc(regRef);
    if (!regSnap.exists()) {
      setLoginStatus('No registry entry for that email. Use “Sign up (create registry)” first.', 'error');
      return;
    }
    const reg = regSnap.data() || {};
    if (reg.allowed !== true || reg.role !== 'admin') {
      setLoginStatus('Registry entry not allowed or not admin.', 'error');
      return;
    }
    const salt = String(reg.salt || '');
    const want = String(reg.passHash || '');
    if (!/^[0-9a-f]{32,}$/i.test(salt) || !/^[0-9a-f]{64}$/i.test(want)) {
      setLoginStatus('Registry entry malformed (salt or passHash).', 'error');
      return;
    }

    // KDF: H = sha256^N( salt + ":" + passcode )
    const got = await kdfSHA256Hex(pass, salt, 5000);
    if (got !== want) {
      setLoginStatus('Incorrect passcode.', 'error');
      return;
    }

    // OK: register this UID
    const adminRef = doc(db, 'admins', currentUser.uid);
    await setDoc(adminRef, {
      uid: currentUser.uid,
      email,
      emailHash,
      role: 'admin',
      active: true,
      registeredAt: serverTimestamp(),
      userAgent: navigator.userAgent || null
    });

    setLoginStatus('Registered ✔︎. You can check existence now.');
    await refreshAdminStatus();
  } catch (e) {
    console.warn('[Admin] verify/register failed', e);
    const code = String(e?.code || '');
    if (code.includes('failed-precondition')) {
      setLoginStatus('App Check required. Enable debug for localhost.', 'error');
    } else if (code.includes('permission-denied')) {
      setLoginStatus('Permission denied by rules.', 'error');
    } else {
      setLoginStatus('Login failed. See console.', 'error');
    }
  }
}

function setLoginStatus(msg, kind = 'info') {
  const el = qs('#login-status');
  el.textContent = msg;
  el.dataset.kind = kind;
}

/* -------- Compute & existence ---------- */
function setStatus(msg, kind = 'info') {
  const el = qs('#status');
  if (!el) return;
  el.textContent = msg;
  el.dataset.kind = kind;
}

function onClear() {
  qs('#email').value = '';
  setStatus('');
  qs('#results').hidden = true;
  qs('#email').focus();
}

async function onCompute(ev) {
  ev.preventDefault();
  setStatus('');
  const email = (qs('#email').value || '').trim();
  const projectId = (qs('#projectId').value || '').trim() || (CONFIG?.firebase?.projectId || '');
  const collection = (qs('#collection').value || '').trim() || 'waitlist';

  const errEl = qs('#error-email');
  errEl.textContent = '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'Enter a valid email.';
    return;
  }
  if (!projectId) setStatus('Project ID is empty — links will not work until you fill it.', 'error');

  const normalized = email.toLowerCase().trim();
  const id = await sha256Hex(normalized);

  qs('#results').hidden = false;
  qs('#norm').textContent = normalized;
  qs('#docId').textContent = id;
  qs('#path').textContent = `/${collection}/${id}`;

  const aFb = qs('#link-firebase');
  const aGc = qs('#link-cloud');
  aFb.href = buildFirebaseConsoleUrl(projectId, collection, id);
  aGc.href = buildCloudConsoleUrl(projectId, collection, id);

  setStatus(isAdmin ? 'Computed. Checking existence…' : 'Computed. Register as admin to check.');
  if (isAdmin) await checkExistence(collection, id);
  else qs('#existence').innerHTML = '<span class="badge warn">UNKNOWN</span> Register as admin to check.';
}

async function checkExistence(collection, id) {
  try {
    const snap = await getDoc(doc(db, collection, id));
    if (snap.exists()) {
      qs('#existence').innerHTML = `<span class="badge ok">EXISTS</span> Found.`;
    } else {
      qs('#existence').innerHTML = `<span class="badge err">NOT FOUND</span> No document with this ID.`;
    }
  } catch (e) {
    const code = String(e?.code || '');
    if (code.includes('failed-precondition')) {
      qs('#existence').innerHTML = `<span class="badge warn">UNKNOWN</span> App Check required.`;
    } else if (code.includes('permission-denied')) {
      qs('#existence').innerHTML = `<span class="badge warn">UNKNOWN</span> Permission denied (not registered).`;
    } else {
      qs('#existence').innerHTML = `<span class="badge warn">UNKNOWN</span> Lookup failed.`;
    }
    console.warn('[Admin] existence check error:', e);
  }
}

/* -------- Dev helper: make admins_registry JSON (local only) ---------- */
async function devGenerate() {
  const email = (qs('#devEmail').value || '').trim().toLowerCase();
  const pass = (qs('#devPass').value || '').trim();
  if (!email || !pass) { qs('#devOut').textContent = 'Enter email + passcode.'; return; }
  const emailHash = await sha256Hex(email);
  const salt = randomSaltHex(16);
  const passHash = await kdfSHA256Hex(pass, salt, 5000);
  const obj = {
    email, emailHash,
    salt, passHash,
    role: 'admin',
    allowed: true,
    note: 'Paste into admins_registry/{emailHash}'
  };
  qs('#devOut').textContent = JSON.stringify(obj, null, 2);
}

/* -------- helpers ---------- */
function copyToClipboard(text) { try { navigator.clipboard.writeText(text); } catch {} }
function randomSaltHex(lenBytes=16) { const b=new Uint8Array(lenBytes); crypto.getRandomValues(b); return [...b].map(x=>x.toString(16).padStart(2,'0')).join(''); }
function bytesToHex(arr){ return Array.from(arr).map(b=>b.toString(16).padStart(2,'0')).join(''); }
function hexToBytes(h){ const a=[]; for (let i=0;i<h.length;i+=2){ a.push(parseInt(h.substr(i,2),16)); } return new Uint8Array(a); }

async function sha256Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return bytesToHex(new Uint8Array(buf));
}

// KDF: sha256^rounds( saltHex + ":" + pass )
async function kdfSHA256Hex(pass, saltHex, rounds=5000) {
  const enc = new TextEncoder();
  let data = new Uint8Array([...hexToBytes(saltHex), ...enc.encode(':' + pass)]);
  let buf = await crypto.subtle.digest('SHA-256', data);
  for (let i = 1; i < rounds; i++) {
    buf = await crypto.subtle.digest('SHA-256', buf);
  }
  return bytesToHex(new Uint8Array(buf));
}

/* Console URL builders */
function buildFirebaseConsoleUrl(projectId, collection, docId) {
  const colEnc = encodeURIComponent(collection);
  const docEnc = encodeURIComponent(docId);
  return `https://console.firebase.google.com/project/${encodeURIComponent(projectId)}/firestore/data/~2F${colEnc}~2F${docEnc}`;
}
function buildCloudConsoleUrl(projectId, collection, docId) {
  const colEnc = encodeURIComponent(collection);
  const docEnc = encodeURIComponent(docId);
  return `https://console.cloud.google.com/firestore/document/${encodeURIComponent(projectId)}/databases/(default)/documents/${colEnc}/${docEnc}?project=${encodeURIComponent(projectId)}`;
}
