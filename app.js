/* FILE: /app.js */
import { CONFIG } from "./config.js";

const qs = (s, el = document) => el.querySelector(s);
const qsa = (s, el = document) => Array.from(el.querySelectorAll(s));

const FORM_ID = "waitlist-form";
const STATUS_ID = "form-status";
const SUBMIT_BTN_ID = "submit-btn";
const allowedRoles = ["Poster", "Provider", "Both"];

const ORIGIN = location.origin;
const HOST = location.hostname;
const IS_LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(HOST);

console.info("[Hayce] Boot", { origin: ORIGIN, hostname: HOST, isLocal: IS_LOCAL });

document.addEventListener("DOMContentLoaded", () => {
  qsa("#year").forEach(el => (el.textContent = new Date().getFullYear()));

  qsa('[data-action="prefill-role"]').forEach(btn => {
    btn.addEventListener("click", () => {
      const role = btn.getAttribute("data-role");
      const select = qs("#role");
      if (select && allowedRoles.includes(role)) select.value = role;
      document.getElementById(FORM_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
      qs("#name")?.focus();
    });
  });

  const params = new URLSearchParams(location.search);
  const preRole = params.get("role");
  if (preRole && allowedRoles.includes(preRole)) {
    const select = qs("#role");
    if (select) select.value = preRole;
  }

  if (CONFIG.enableAnalytics) loadAnalytics();
  enablePlacesIfConfigured();

  try {
    const ensureAuto = [
      ["#name", "name"],
      ["#email", "email"],
      ["#phone", "tel"],
      ["#city", "address-level2"],
      ["#country", "country-name"],
      ["#role", "off"],
      ["#ref", "off"]
    ];
    ensureAuto.forEach(([sel, val]) => {
      const el = qs(sel);
      if (el && !el.getAttribute("autocomplete")) el.setAttribute("autocomplete", val);
    });
  } catch {}

  const form = document.getElementById(FORM_ID);
  form?.addEventListener("submit", onSubmit);
});

function setStatus(msg, kind = "info") {
  const el = document.getElementById(STATUS_ID);
  if (!el) return;
  el.textContent = msg;
  el.dataset.kind = kind;
}

function clearErrors() {
  qsa(".error").forEach(e => (e.textContent = ""));
}

function gatherChecked(name) {
  return qsa(`input[name="${name}"]:checked`).map(i => i.value);
}

function getFormData(form) {
  const fd = new FormData(form);
  const platforms = gatherChecked("platform");
  const posterIntent = gatherChecked("posterIntent");
  const skills = gatherChecked("skills");

  return {
    name: fd.get("name")?.toString().trim() || "",
    email: fd.get("email")?.toString().trim() || "",
    phone: fd.get("phone")?.toString().trim() || "",
    city: fd.get("city")?.toString().trim() || "",
    country: fd.get("country")?.toString().trim() || "",
    role: fd.get("role")?.toString() || "",
    platform: platforms,
    ref: fd.get("ref")?.toString().trim() || "",
    posterIntent,
    skills,
    consent: fd.get("consent") === "on",
    _hp: fd.get("company")?.toString().trim() || ""
  };
}

function validate(payload) {
  const errs = {};
  if (payload._hp) return errs; // silently accept bots
  if (payload.name.length < 2) errs.name = "Please enter your full name.";
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email);
  if (!emailOk) errs.email = "Enter a valid email address.";
  if (payload.phone && !/^\+?[0-9 ()\-]{7,}$/.test(payload.phone)) errs.phone = "Enter a valid phone number (optional).";
  if (!payload.city) errs.city = "City is required.";
  if (!payload.country) errs.country = "Country is required.";
  if (!allowedRoles.includes(payload.role)) errs.role = "Pick a role.";
  if (!Array.isArray(payload.platform) || payload.platform.length === 0) errs.platform = "Select at least one platform.";
  if (!payload.consent) errs.consent = "You must consent to proceed.";
  return errs;
}

async function onSubmit(e) {
  e.preventDefault();
  clearErrors();
  setStatus("");
  const form = e.currentTarget;
  const btn = document.getElementById(SUBMIT_BTN_ID);
  btn.disabled = true;
  btn.textContent = "Submitting…";

  try {
    const payload = getFormData(form);
    const errs = validate(payload);
    if (Object.keys(errs).length) {
      showErrors(errs);
      btn.disabled = false;
      btn.textContent = "Join waitlist";
      return;
    }

    if (payload._hp) {
      await sleep(300); // honeypot -> pretend success
    } else if (CONFIG.provider === "firebase") {
      await submitViaFirebase(payload);
    } else if (CONFIG.provider === "form") {
      await submitViaFormEndpoint(payload);
    } else {
      throw new Error("Unknown provider. Check config.js");
    }

    setStatus("Success! Redirecting…");
    form.setAttribute("aria-disabled", "true");
    qsa("input,select,button", form).forEach(el => (el.disabled = true));
    setTimeout(() => {
      const url = new URL("thanks.html", location.href);
      url.searchParams.set("role", payload.role);
      location.href = url.toString();
    }, 900);
  } catch (err) {
    console.error("[Form] submit failed:", err);
    const code = String(err?.code || "");
    if (code === "already-registered") {
      setStatus("You’re already on the list with that email. Redirecting…");
      setTimeout(() => {
        const url = new URL("thanks.html", location.href);
        url.searchParams.set("role", qs("#role")?.value || "");
        location.href = url.toString();
      }, 900);
    } else if (code.includes("failed-precondition")) {
      setStatus("App Check token required. See console to register a debug token.", "error");
    } else if (code.includes("permission-denied")) {
      setStatus("Permission denied (rules/App Check). Check Console & rules.", "error");
    } else if (code.includes("deadline-exceeded")) {
      setStatus("Network timeout. Check connection and try again.", "error");
    } else {
      setStatus("Something went wrong. Please try again.", "error");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "Join waitlist";
  }
}

function showErrors(errs) {
  for (const [key, msg] of Object.entries(errs)) {
    const el = document.getElementById(`error-${key}`);
    if (el) el.textContent = msg;
  }
  setStatus("Please fix the highlighted fields.", "error");
}

async function submitViaFormEndpoint(payload) {
  if (!CONFIG.formEndpoint) throw new Error("Missing formEndpoint in config.js");
  const bodyObj = {
    name: payload.name,
    email: payload.email,
    phone: payload.phone,
    city: payload.city,
    country: payload.country,
    role: payload.role,
    platform: payload.platform.join(", "),
    referral: payload.ref,
    posterIntent: payload.posterIntent.join(", "),
    skills: payload.skills.join(", "),
    consent: payload.consent ? "yes" : "no",
    _gotcha: "", _honeypot: ""
  };
  const headers = {};
  let body;

  if (CONFIG.formEncoding === "urlencoded") {
    headers["Content-Type"] = "application/x-www-form-urlencoded; charset=utf-8";
    body = new URLSearchParams(bodyObj).toString();
  } else {
    headers["Content-Type"] = "application/json; charset=utf-8";
    body = JSON.stringify(bodyObj);
  }

  console.info("[FormEndpoint] POST", CONFIG.formEndpoint, { encoding: CONFIG.formEncoding });
  const res = await fetch(CONFIG.formEndpoint, { method: "POST", headers, body, mode: "cors" });
  if (!res.ok) throw new Error(`Form endpoint error: ${res.status}`);
}

async function submitViaFirebase(payload) {
  const { firebase, appCheck } = CONFIG;
  if (!firebase?.apiKey || !firebase?.projectId || !firebase?.appId) {
    throw new Error("Missing Firebase config in config.js");
  }

  console.info("[Firebase] Importing SDKs…");
 const [
  { initializeApp },
  { initializeAppCheck, ReCaptchaV3Provider, ReCaptchaEnterpriseProvider, getToken },
  { getFirestore, serverTimestamp, doc, setDoc }
] = await Promise.all([
  import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
  import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js"),
  import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js")
]);

  const app = initializeApp(firebase);
  console.info("[Firebase] App initialized for project:", firebase.projectId);

  // --- App Check (Enterprise or v3) ---
let appCheckInstance = undefined;

if (appCheck?.debug) {
  self.FIREBASE_APPCHECK_DEBUG_TOKEN = appCheck.debug === true ? true : String(appCheck.debug);
  console.info("[AppCheck] Debug mode ON.");
}

try {
  if (appCheck?.provider === "recaptchaEnterprise" && appCheck?.siteKey) {
    const provider = new ReCaptchaEnterpriseProvider(appCheck.siteKey);
    appCheckInstance = initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
  } else if (appCheck?.provider === "recaptchaV3" && appCheck?.siteKey) {
    const provider = new ReCaptchaV3Provider(appCheck.siteKey);
    appCheckInstance = initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
  } else {
    console.warn("[AppCheck] Skipped (no provider/siteKey).");
  }

  if (appCheckInstance) {
    const tok = await getToken(appCheckInstance, /* forceRefresh */ true);
    document.documentElement.setAttribute("data-appcheck", tok?.token ? "ok" : "missing");
    console.info(`[AppCheck] token ${tok?.token ? "acquired" : "missing"}.`);
  }
} catch (e) {
  console.warn("[AppCheck] getToken failed", e);
  document.documentElement.setAttribute("data-appcheck", "missing");
}


  const db = getFirestore(app);
  console.info("[Firestore] Ready.");

  const normalizedEmail = normalizeEmail(payload.email);
  const emailHash = await sha256Hex(normalizedEmail);
  const col = firebase.collection || "waitlist";
  const ref = doc(db, col, emailHash);

  const docData = {
    name: payload.name,
    email: payload.email,
    phone: payload.phone || null,
    city: payload.city,
    country: payload.country,
    role: payload.role,
    platform: payload.platform,
    referral: payload.ref || null,
    posterIntent: payload.posterIntent || [],
    skills: payload.skills || [],
    consent: !!payload.consent,
    emailHash,
    createdAt: serverTimestamp(),
    userAgent: navigator.userAgent || null
  };

  try {
    // Write-first: rules allow create but NOT read/update.
    await setDoc(ref, docData);
    setStatus("Submitted with App Check token ✔️");
  } catch (e) {
    // If the doc already exists, rules classify this as an UPDATE (not allowed) -> permission-denied.
    if (String(e?.code) === "permission-denied") {
      const friendly = new Error("Already registered");
      friendly.code = "already-registered";
      throw friendly;
    }
    throw e;
  }
}

/* ---------- Google Places (optional) ---------- */
function enablePlacesIfConfigured() {
  const key = CONFIG?.googleMaps?.apiKey;
  if (!key) {
    console.info("[Places] Skipped (no apiKey in config.js).");
    return;
  }

  const params = new URLSearchParams({
    key,
    v: "beta",
    libraries: "places",
    loading: "async"
  });

  const script = document.createElement("script");
  script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
  script.async = true;
  script.defer = true;
  script.onload = attachCityAutocompleteSmart;
  script.onerror = () => console.warn("[Places] Failed to load Google Maps JS.");
  document.head.appendChild(script);
}

async function attachCityAutocompleteSmart() {
  try {
    await google.maps.importLibrary("places");
    if (google.maps.places?.PlaceAutocompleteElement) {
      return attachCityAutocompleteElement();
    }
  } catch (e) {}
  if (google.maps.places?.Autocomplete) {
    console.info("[Places] Using legacy Autocomplete fallback.");
    return attachAutocompleteLegacy(CONFIG?.googleMaps?.allowedCountries || ["CA","US","NG"]);
  }
  console.warn("[Places] No autocomplete available.");
}

async function attachCityAutocompleteElement() {
  const input = document.getElementById("city");
  if (!input) return;

  const pac = document.createElement("gmp-place-autocomplete");
  pac.setAttribute("id", "city-autocomplete");
  pac.setAttribute("placeholder", input.getAttribute("placeholder") || "City");
  pac.style.display = "block";
  pac.style.marginBottom = "8px";

  const allowed = CONFIG?.googleMaps?.allowedCountries || ["CA","US","NG"];
  pac.includedRegionCodes = allowed;
  try { pac.includedPrimaryTypes = ["locality", "postal_town"]; } catch {}
  pac.fetchFields = ["addressComponents", "displayName"];

  const cityField = input.closest(".field") || input.parentElement;
  cityField.insertBefore(pac, input);
  input.style.display = "none";

  const handleSelect = async (ev) => {
    try {
      const prediction = ev.placePrediction || ev.detail?.placePrediction;
      if (!prediction?.toPlace) return;
      const place = await prediction.toPlace();
      await place.fetchFields({ fields: ["addressComponents", "displayName"] });

      const comps = place.addressComponents || [];
      const countryComp = comps.find(c => (c.types || []).includes("country"));
      const cityComp =
        comps.find(c => (c.types || []).includes("locality")) ||
        comps.find(c => (c.types || []).includes("postal_town")) ||
        comps.find(c => (c.types || []).includes("administrative_area_level_2"));

      const cityText = place.displayName || cityComp?.longText || cityComp?.long_name || "";
      const countryCode = (countryComp?.shortText || countryComp?.short_name || "").toUpperCase();

      const countrySel = document.getElementById("country");
      if (cityText) input.value = cityText;
      if (countryCode && countrySel) countrySel.value = countryCode;
    } catch (err) {
      console.warn("[Places] selection handler failed", err);
    }
  };

  pac.addEventListener("gmp-select", handleSelect);
  pac.addEventListener("placechange", handleSelect);
  console.info("[Places] <gmp-place-autocomplete> attached with region codes:", allowed);
}

function attachAutocompleteLegacy(allowedCountries) {
  const input = document.getElementById("city");
  if (!input) return;

  const ac = new google.maps.places.Autocomplete(input, {
    types: ["(cities)"],
    componentRestrictions: { country: allowedCountries }
  });

  ac.addListener("place_changed", () => {
    const place = ac.getPlace();
    const comps = place?.address_components || [];
    const countryComp = comps.find(c => c.types.includes("country"));
    const cityComp = comps.find(c => c.types.includes("locality")) ||
                     comps.find(c => c.types.includes("postal_town")) ||
                     comps.find(c => c.types.includes("administrative_area_level_2"));
    const countrySel = document.getElementById("country");
    if (countryComp?.short_name && countrySel) countrySel.value = countryComp.short_name.toUpperCase();
    if (cityComp?.long_name) input.value = cityComp.long_name;
  });

  console.info("[Places] Autocomplete attached (legacy) with country restriction:", allowedCountries);
}

/* ---------- Helpers ---------- */
function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

async function sha256Hex(str) {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(str));
  const bytes = new Uint8Array(buf);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function loadAnalytics() {
  if (CONFIG.analyticsProvider === "plausible") {
    const s = document.createElement("script"); s.defer = true;
    s.setAttribute("data-domain", CONFIG.analyticsDomain || location.hostname);
    s.src = "https://plausible.io/js/plausible.js";
    document.head.appendChild(s);
  } else if (CONFIG.analyticsProvider === "ga4") {
    const id = CONFIG.gaMeasurementId;
    if (!id) return;
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
    document.head.appendChild(s);
    window.dataLayer = window.dataLayer || [];
    function gtag(){ dataLayer.push(arguments); }
    window.gtag = gtag;
    gtag("js", new Date());
    gtag("config", id, { anonymize_ip: true });
  }
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
