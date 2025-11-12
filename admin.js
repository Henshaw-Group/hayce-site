/* Admin utility: hash email -> deterministic waitlist doc ID + console deep links
   - Uses same normalization + sha256 as app.js (lowercase + trim, wl_ prefix)
   - Reads CONFIG.firebase.projectId and CONFIG.firebase.collection if present
*/
import { CONFIG } from './config.js';

const qs = (s, el = document) => el.querySelector(s);

document.addEventListener('DOMContentLoaded', () => {
  // year in footer
  const y = qs('#year'); if (y) y.textContent = new Date().getFullYear();

  // prefill from CONFIG if available
  const projectInput = qs('#projectId');
  const collInput = qs('#collection');
  if (CONFIG?.firebase?.projectId) projectInput.value = CONFIG.firebase.projectId;
  collInput.value = CONFIG?.firebase?.collection || collInput.value || 'waitlist';

  // prefill from URL (?email=)
  const p = new URLSearchParams(location.search);
  const preEmail = p.get('email');
  if (preEmail) qs('#email').value = preEmail;

  qs('#lookup-form').addEventListener('submit', onCompute);
  qs('#clear').addEventListener('click', onClear);

  // copy buttons
  document.body.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const sel = btn.getAttribute('data-copy');
    const el = qs(sel);
    if (!el) return;
    copyToClipboard(el.textContent || '');
    btn.textContent = 'Copied!';
    setTimeout(() => (btn.textContent = 'Copy'), 1000);
  });

  // if email was prefilled, auto-compute
  if (preEmail) onCompute(new Event('submit'));
});

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

  // basic validation
  const errEl = qs('#error-email');
  errEl.textContent = '';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errEl.textContent = 'Enter a valid email.';
    return;
  }
  if (!projectId) {
    setStatus('Project ID is empty — links will not work until you fill it.', 'error');
  }

  // normalize & hash like app.js
  const normalized = normalizeEmail(email);
  let id = '';
  try {
    id = 'wl_' + await sha256Hex(normalized);
  } catch {
    id = 'wl_' + base64url(normalized).slice(0, 64); // rare fallback
  }

  // render results
  qs('#results').hidden = false;
  qs('#norm').textContent = normalized;
  qs('#docId').textContent = id;
  qs('#path').textContent = `/${collection}/${id}`;

  // build console links (both flavors)
  const fb = buildFirebaseConsoleUrl(projectId, collection, id);
  const gcp = buildCloudConsoleUrl(projectId, collection, id);

  const aFb = qs('#link-firebase');
  const aGc = qs('#link-cloud');
  aFb.href = fb; aGc.href = gcp;

  if (!projectId) {
    aFb.removeAttribute('href');
    aGc.removeAttribute('href');
  } else {
    setStatus('Computed. Open links in a new tab to view the document.');
  }
}

/* ---- helpers (same logic as app.js) ---- */

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

async function sha256Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  const bytes = new Uint8Array(buf);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function base64url(s) {
  const b64 = btoa(unescape(encodeURIComponent(s)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function copyToClipboard(text) {
  try { navigator.clipboard.writeText(text); } catch {}
}

/* Console URL builders
   Firebase Console: https://console.firebase.google.com/project/<pid>/firestore/data/~2F<collection>~2F<docId>
   Cloud Console:    https://console.cloud.google.com/firestore/document/<pid>/databases/(default)/documents/<collection>/<docId>?project=<pid>
*/
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
