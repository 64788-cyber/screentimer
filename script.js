// ---------- utilitaires ----------
function pad(n) { return String(n).padStart(2, "0"); }

// convertit "HH:MM" en objet Date (aujourd'hui)
function parseTime(str) {
  if (!str) return null;
  const m = str.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) return null;
  const d = new Date();
  d.setHours(+m[1], +m[2], 0, 0);
  return d;
}

function fmtHM(d) {
  return d ? pad(d.getHours()) + ":" + pad(d.getMinutes()) : "—";
}

function fmtDuration(ms) {
  if (ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

// ---------- mini moteur Markdown ----------
// On échappe TOUJOURS le HTML d'abord : le texte vient d'un pad public ou d'une URL,
// il ne doit pas pouvoir injecter de <script>.
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
          .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// éléments dans une ligne : `code`, **gras**, *italique*, ~~barré~~, [lien](url)
function mdInline(text) {
  let s = escapeHtml(text || "");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
                '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return s;
}

// blocs : titres #, listes - / 1., citations >, séparateur ---, paragraphes
function mdBlock(text) {
  let html = "";
  let list = null; // "ul", "ol" ou null
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  const openList = type => { if (list !== type) { closeList(); html += `<${type}>`; list = type; } };

  for (const raw of (text || "").split("\n")) {
    const line = raw.trim();
    let m;
    if (!line) { closeList(); continue; }

    if (/^(-{3,}|\*{3,})$/.test(line)) {
      closeList(); html += "<hr>";
    } else if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      closeList();
      const n = m[1].length + 2; // # → h3, ## → h4, ### → h5 (h1/h2 trop gros dans un panneau)
      html += `<h${n}>${mdInline(m[2])}</h${n}>`;
    } else if ((m = line.match(/^[-*•]\s+(.*)$/))) {
      openList("ul"); html += `<li>${mdInline(m[1])}</li>`;
    } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      openList("ol"); html += `<li>${mdInline(m[1])}</li>`;
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      closeList(); html += `<blockquote>${mdInline(m[1])}</blockquote>`;
    } else {
      closeList(); html += `<p>${mdInline(line)}</p>`;
    }
  }
  closeList();
  return html;
}

// compatibilité : les anciennes consignes étaient "une par ligne" sans syntaxe.
// Si aucune ligne n'utilise de Markdown de bloc, on en fait une liste à puces.
function consignesToMd(text) {
  const lines = (text || "").split("\n").filter(l => l.trim());
  const hasMd = lines.some(l => /^\s*([-*•]\s|\d+[.)]\s|#{1,3}\s|>|-{3,}$)/.test(l));
  return hasMd ? text : lines.map(l => "- " + l.trim()).join("\n");
}

// ---------- config par défaut ----------
const defaultConfig = {
  mnemo: "DEMO101",
  title: "Épreuve de *démonstration*",
  start: "",
  end: "",
  leave: "",
  consignes: "## Démo\n- Ceci est un écran de **démo**\n- Cliquez sur l'icône ⚙ pour le configurer\n> Les heures peuvent être verrouillées avec 🔒",
  faq: "À qui puis-je poser une question ? = Levez la **main**.\nPuis-je sortir avant l'heure ? = **Non**, sauf urgence."
};

// ---------- config : config.json (partagé via git) ----------
// Priorité (du plus faible au plus fort) :
//   défaut < config.json < modifs locales de cet onglet < URL < cadenas 🔒
const CONFIG_URL = "config.json";
const CONFIG_REFRESH_MS = 30000;
const OVERRIDE_KEY = "screentimer_overrides";
const CONFIG_FIELDS = ["mnemo", "title", "start", "end", "leave", "consignes", "faq"];

let remoteConfig = {};   // dernier contenu lu dans config.json
let padFaq = "";         // FAQ lue sur le pad (si utilisé)
let overrides = loadOverrides();

function loadOverrides() {
  try { return JSON.parse(sessionStorage.getItem(OVERRIDE_KEY)) || {}; }
  catch (e) { return {}; }
}
function saveOverrides() {
  try { sessionStorage.setItem(OVERRIDE_KEY, JSON.stringify(overrides)); } catch (e) {}
}

// uniquement les champs présents dans l'URL
function urlConfig() {
  const params = new URLSearchParams(location.search);
  const out = {};
  CONFIG_FIELDS.forEach(k => {
    if (!params.has(k)) return;
    const v = params.get(k) || "";
    out[k] = (k === "consignes" || k === "faq") ? v.replace(/\\n/g, "\n") : v;
  });
  return out;
}

function buildConfig() {
  const url = urlConfig();
  const cfg = { ...defaultConfig, ...remoteConfig, ...overrides, ...url };
  if (padFaq && !("faq" in overrides) && !("faq" in url)) cfg.faq = padFaq;
  return applyLocks(cfg);
}

// recalcule la config et ne redessine que si quelque chose a changé
function refreshConfig() {
  const next = buildConfig();
  if (JSON.stringify(next) !== JSON.stringify(config)) {
    config = next;
    renderStatic();
    tick();
  }
}

async function fetchRemoteConfig() {
  try {
    const res = await fetch(CONFIG_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    remoteConfig = await res.json();
    refreshConfig();
  } catch (e) {
    // fichier absent, JSON invalide, ou page ouverte en file:// : on garde l'état actuel
    console.warn("config.json indisponible :", e.message);
  }
}

// ---------- cadenas (verrouillage des heures) ----------
// Problème : localStorage est PARTAGÉ entre tous les onglets du navigateur.
// Si plusieurs locaux sont ouverts sur la même machine, le dernier "Appliquer"
// écrase les heures des autres au prochain rechargement.
// Solution : les heures verrouillées sont gardées dans sessionStorage, qui est
// propre à CHAQUE onglet. Elles passent donc avant localStorage, avant l'URL
// et ne peuvent plus être modifiées tant que le cadenas est fermé.
const LOCK_KEY = "screentimer_locks";
const LOCKABLE = ["start", "end"];

function loadLocks() {
  // 1) cet onglet a déjà ses propres cadenas (même après un F5)
  try {
    const saved = sessionStorage.getItem(LOCK_KEY);
    if (saved !== null) return JSON.parse(saved);
  } catch (e) { /* sessionStorage indisponible : on continue */ }

  // 2) sinon, lien généré avec ?lock=start,end → on verrouille dès l'ouverture
  const params = new URLSearchParams(location.search);
  const locks = {};
  (params.get("lock") || "").split(",").forEach(k => {
    const v = params.get(k);
    if (LOCKABLE.includes(k) && parseTime(v)) locks[k] = v;
  });
  return locks;
}

function saveLocks() {
  try { sessionStorage.setItem(LOCK_KEY, JSON.stringify(locks)); } catch (e) {}
}

// les heures verrouillées écrasent toujours ce qui vient d'ailleurs
function applyLocks(cfg) {
  LOCKABLE.forEach(k => { if (locks[k]) cfg[k] = locks[k]; });
  return cfg;
}

let locks = loadLocks();
saveLocks();
let config = buildConfig();
let faqList = [];
let faqIndex = 0;

// ---------- affichage statique (bandeau, consignes, faq) ----------
function renderStatic() {
  document.getElementById("mnemo").textContent = config.mnemo || "ScreenTimer";
  document.getElementById("title").innerHTML = mdInline(config.title || "");

  document.getElementById("consignes").innerHTML = mdBlock(consignesToMd(config.consignes));

  // coupe au PREMIER "=" seulement : une réponse peut contenir "="
  faqList = (config.faq || "").split("\n").filter(l => l.includes("=")).map(line => {
    const i = line.indexOf("=");
    return { q: line.slice(0, i).trim(), a: line.slice(i + 1).trim() };
  });
  faqIndex = 0;
  showFaq();
}

function showFaq() {
  const q = document.getElementById("faqQ");
  const a = document.getElementById("faqA");
  if (!faqList.length) { q.innerHTML = ""; a.innerHTML = ""; return; }
  q.innerHTML = mdInline(faqList[faqIndex].q);
  a.innerHTML = mdInline(faqList[faqIndex].a);
}
setInterval(() => {
  if (faqList.length) {
    faqIndex = (faqIndex + 1) % faqList.length;
    showFaq();
  }
}, 8000);

// ---------- boucle horloge / minuteur ----------
function setBannerTime(id, date, locked) {
  const el = document.getElementById(id);
  el.textContent = fmtHM(date) + (locked ? " 🔒" : "");
  el.classList.toggle("locked", !!locked);
}

function tick() {
  const now = new Date();
  document.getElementById("clockNow").textContent =
    pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds());

  const start = parseTime(config.start);
  const end = parseTime(config.end);
  const leave = parseTime(config.leave);

  setBannerTime("clockStart", start, locks.start);
  setBannerTime("clockEnd", end, locks.end);
  setBannerTime("clockLeave", leave, false);

  const stateEl = document.getElementById("state");
  const timerEl = document.getElementById("timer");
  const subEl = document.getElementById("sub");
  stateEl.className = "state";
  timerEl.className = "timer";

  if (!end) {
    stateEl.textContent = "en attente de configuration";
    timerEl.textContent = "--:--:--";
    subEl.textContent = "Ouvrez ⚙ pour définir une heure de fin.";
    return;
  }

  if (start && now < start) {
    stateEl.textContent = "en attente du début";
    timerEl.textContent = fmtDuration(start - now);
    subEl.innerHTML = `Début prévu à <strong>${fmtHM(start)}</strong>`;
    return;
  }

  if (now >= end) {
    stateEl.textContent = "terminé";
    stateEl.classList.add("alert");
    timerEl.textContent = "00:00";
    timerEl.classList.add("alert");
    subEl.textContent = "";
    return;
  }

  const remain = end - now;
  const remainMin = remain / 60000;
  let tone = "calm";
  if (remainMin <= 3) tone = "alert";
  else if (remainMin <= 10) tone = "warn";

  let subText = "Il reste du temps.";
  if (leave) {
    if (now < leave) subText = `Sortie possible à partir de ${fmtHM(leave)}`;
    else { subText = "Vous êtes désormais libres de partir."; tone = "leave"; }
  }

  stateEl.textContent = "en cours";
  stateEl.classList.add(tone);
  timerEl.textContent = fmtDuration(remain);
  timerEl.classList.add(tone);
  subEl.textContent = subText;
}
setInterval(tick, 1000);

// ---------- panneau de configuration ----------
const overlay = document.getElementById("overlay");
const lockMsg = document.getElementById("lockMsg");

// met à jour les champs et boutons cadenas selon l'état de "locks"
function updateLockUI() {
  LOCKABLE.forEach(k => {
    const input = document.getElementById("f_" + k);
    const btn = document.querySelector(`.lockBtn[data-field="${k}"]`);
    const isLocked = !!locks[k];
    if (isLocked) input.value = locks[k];
    input.readOnly = isLocked;
    input.classList.toggle("locked", isLocked);
    btn.classList.toggle("locked", isLocked);
    btn.textContent = isLocked ? "🔒" : "🔓";
    btn.title = (isLocked ? "Déverrouiller" : "Verrouiller") +
                (k === "start" ? " l'heure de début" : " l'heure de fin");
  });
}

document.querySelectorAll(".lockBtn").forEach(btn => {
  btn.addEventListener("click", () => {
    const k = btn.dataset.field;
    const input = document.getElementById("f_" + k);
    lockMsg.textContent = "";

    if (locks[k]) {
      // déverrouillage : on demande confirmation pour éviter un clic accidentel
      const label = k === "start" ? "de début" : "de fin";
      if (!confirm(`Déverrouiller l'heure ${label} (${locks[k]}) ?`)) return;
      delete locks[k];
    } else {
      // verrouillage : l'heure doit être valide
      const value = input.value.trim();
      const t = parseTime(value);
      if (!t) { lockMsg.textContent = "Heure invalide : format HH:MM attendu."; return; }

      // cohérence début < fin (avec l'autre heure, verrouillée ou non)
      const other = k === "start"
        ? parseTime(document.getElementById("f_end").value)
        : parseTime(document.getElementById("f_start").value);
      if (other && ((k === "start" && t >= other) || (k === "end" && t <= other))) {
        lockMsg.textContent = "L'heure de début doit être avant l'heure de fin.";
        return;
      }
      locks[k] = pad(t.getHours()) + ":" + pad(t.getMinutes());
      config[k] = locks[k]; // effet immédiat, pas besoin d'"Appliquer"
    }
    saveLocks();
    updateLockUI();
    tick();
  });
});

document.getElementById("gearBtn").addEventListener("click", () => {
  document.getElementById("f_mnemo").value = config.mnemo || "";
  document.getElementById("f_title").value = config.title || "";
  document.getElementById("f_start").value = config.start || "";
  document.getElementById("f_end").value = config.end || "";
  document.getElementById("f_leave").value = config.leave || "";
  document.getElementById("f_consignes").value = config.consignes || "";
  document.getElementById("f_faq").value = config.faq || "";
  document.getElementById("shareOut").style.display = "none";
  lockMsg.textContent = "";
  updateLockUI();
  overlay.classList.add("open");
});

document.getElementById("closeBtn").addEventListener("click", () => {
  overlay.classList.remove("open");
});

function readForm() {
  return applyLocks({
    mnemo: document.getElementById("f_mnemo").value.trim(),
    title: document.getElementById("f_title").value.trim(),
    start: document.getElementById("f_start").value.trim(),
    end: document.getElementById("f_end").value.trim(),
    leave: document.getElementById("f_leave").value.trim(),
    consignes: document.getElementById("f_consignes").value,
    faq: document.getElementById("f_faq").value
  });
}

document.getElementById("applyBtn").addEventListener("click", () => {
  // on ne retient que ce qui diffère de config.json (le reste continue à se synchroniser)
  const form = readForm();
  overrides = {};
  CONFIG_FIELDS.forEach(k => {
    const base = k in remoteConfig ? remoteConfig[k] : defaultConfig[k];
    if (form[k] !== base) overrides[k] = form[k];
  });
  saveOverrides();
  refreshConfig();
  overlay.classList.remove("open");
});

// exporte la config courante : à committer dans le dépôt pour la partager à tous
document.getElementById("downloadBtn").addEventListener("click", () => {
  const form = readForm();
  const out = {};
  CONFIG_FIELDS.forEach(k => { out[k] = form[k]; });
  out.pad = remoteConfig.pad || "";
  const blob = new Blob([JSON.stringify(out, null, 2) + "\n"], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "config.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

// abandonne les modifs locales de cet onglet et revient à config.json
document.getElementById("resetBtn").addEventListener("click", () => {
  overrides = {};
  saveOverrides();
  refreshConfig();
  overlay.classList.remove("open");
});

document.getElementById("shareBtn").addEventListener("click", () => {
  const cfg = readForm();
  const params = new URLSearchParams();
  const padParam = new URLSearchParams(location.search).get("pad");
  if (padParam) params.set("pad", padParam);
  ["mnemo", "title", "start", "end", "leave"].forEach(k => {
    if (cfg[k]) params.set(k, cfg[k]);
  });
  if (cfg.consignes) params.set("consignes", cfg.consignes.replace(/\n/g, "\\n"));
  if (cfg.faq) params.set("faq", cfg.faq.replace(/\n/g, "\\n"));
  // l'écran qui ouvre ce lien démarre avec les mêmes heures verrouillées
  const lockedKeys = LOCKABLE.filter(k => locks[k]);
  if (lockedKeys.length) params.set("lock", lockedKeys.join(","));

  const url = location.origin + location.pathname + "?" + params.toString();
  const out = document.getElementById("shareOut");
  out.value = url;
  out.style.display = "block";
  out.select();
});

// ---------- FAQ partagée entre tous les locaux (Framapad) ----------
// ?pad=nom-du-pad  ou  ?pad=https://annuel.framapad.org/p/nom-du-pad
// Seule la FAQ vient du pad : heures, consignes, etc. restent propres à chaque local.
// Le pad peut aussi être écrit en Markdown (**gras**, `code`, liens…).
const PAD_HOST = "https://annuel.framapad.org";
const PAD_DEFAULT = "https://mensuel.framapad.org/p/testgestionesi-anr1"; // pad utilisé si l'URL n'a pas de ?pad=
const PAD_REFRESH_MS = 60000; // Framapad limite ~10 lectures / 1-2 min par IP

function padUrl() {
  const p = new URLSearchParams(location.search).get("pad") || remoteConfig.pad || PAD_DEFAULT;
  // enlève "?lang=fr", "#..." et le "/" final que Framapad ajoute parfois
  if (/^https?:\/\//.test(p)) return p.split(/[?#]/)[0].replace(/\/+$/, "");
  return PAD_HOST + "/p/" + encodeURIComponent(p);
}

// garde uniquement les lignes "Question = Réponse" (tiret en début de ligne accepté)
function parsePadFaq(text) {
  return text.split("\n")
    .map(l => l.replace(/^\s*[-*•]\s+/, "").trim())
    .filter(l => l.includes("="))
    .join("\n");
}

async function syncFaqFromPad() {
  try {
    const res = await fetch(padUrl() + "/export/txt", { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const faq = parsePadFaq(await res.text());
    if (faq && faq !== padFaq) {
      padFaq = faq; // ne touche jamais aux heures (verrouillées ou non)
      refreshConfig();
    }
  } catch (e) {
    // pad injoignable ou limite atteinte : on garde la FAQ déjà affichée
    console.warn("FAQ Framapad indisponible :", e.message);
  }
}

// délai aléatoire pour que les écrans ne lisent pas tous le pad en même temps
function scheduleFaqSync() {
  syncFaqFromPad().finally(() =>
    setTimeout(scheduleFaqSync, PAD_REFRESH_MS + Math.random() * 15000));
}

if (padUrl()) {
  const link = document.getElementById("padLink");
  link.href = padUrl();
  link.style.display = "block";
  setTimeout(scheduleFaqSync, Math.random() * 5000);
}

// ---------- Gestion du mode alterné (Carrousel 30s) ----------
let currentDisplayMode = 0;
let carouselTimer = null;
let currentCarouselIndex = 0; // 0 = Consignes, 1 = FAQ

const viewToggleBtn = document.getElementById("viewToggleBtn");
const panelsContainer = document.querySelector(".panels");
const panelsList = document.querySelectorAll(".panel"); // [0: consignes, 1: faq]

function updateCarouselView() {
  if (currentDisplayMode !== 1) return;

  // Retire la classe 'active' de tous les panneaux
  panelsList.forEach(p => p.classList.remove("active"));
  
  // Active le panneau courant (0 = Consignes, 1 = FAQ)
  panelsList[currentCarouselIndex].classList.add("active");
}

function clearCarouselInterval() {
  if (carouselTimer) {
    clearInterval(carouselTimer);
    carouselTimer = null;
  }
}

function applyDisplayMode(mode) {
  currentDisplayMode = mode;

  clearCarouselInterval();
  panelsContainer.classList.remove("carousel-mode", "card-dashboard-mode");
  document.body.classList.remove("dashboard-mode-active"); // Nettoyage
  panelsList.forEach(p => p.classList.remove("active"));

  switch (currentDisplayMode) {
    case 0:
      // MOD 0: 
      viewToggleBtn.style.background = "#1d2a3b";
      viewToggleBtn.title = "Mode actuel : Side-by-side";
      break;

    case 1:
      // MOD 1:
      panelsContainer.classList.add("carousel-mode");
      currentCarouselIndex = 0;
      updateCarouselView();

      carouselTimer = setInterval(() => {
        currentCarouselIndex = (currentCarouselIndex + 1) % panelsList.length;
        updateCarouselView();
      }, 30000);

      viewToggleBtn.style.background = "#3e7cb1";
      viewToggleBtn.title = "Mode actuel : Alterné 30s";
      break;

    case 2:
      // MOD 3: 
      panelsContainer.classList.add("card-dashboard-mode");
      document.body.classList.add("dashboard-mode-active"); 
      viewToggleBtn.style.background = "#10b981";
      viewToggleBtn.title = "Mode actuel : Dashboard";
      break;
  }
}

function toggleViewMode() {
  // 0 -> 1 -> 2 -> 0 boucle
  const nextMode = (currentDisplayMode + 1) % 3;
  applyDisplayMode(nextMode);
}

// Écouteur de clic sur le bouton
viewToggleBtn.addEventListener("click", toggleViewMode);

// ---------- démarrage ----------
renderStatic();
tick();
fetchRemoteConfig();
setInterval(fetchRemoteConfig, CONFIG_REFRESH_MS);
