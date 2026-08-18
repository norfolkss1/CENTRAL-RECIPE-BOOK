/* global firebase, FIREBASE_CONFIG, CATEGORIES, SEED_RECIPES */

/* ============================== Firebase ============================== */
firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const ALLERGEN_LABELS = { D: "Dairy", G: "Gluten", S: "Seafood", Sh: "Shellfish", N: "Nuts", V: "Vegetarian", Vg: "Vegan", P: "Pork", Soy: "Soy" };

/* ============================== State ============================== */
const state = {
  role: null,      // 'user' | 'admin'
  name: "",
  categories: [],
  recipes: [],
  requests: [],
  pins: { user: "4671", admin: "2580" },
  query: "",
  activeCat: "all",
  showFavoritesOnly: false,
  viewMode: "dishes", // 'dishes' | 'components'
  selectedRecipeId: null,
  selectedComponentKey: null,
  activeDetailTab: 0,
  favorites: JSON.parse(localStorage.getItem("me-recipe-favs") || "[]"),
  adminOpen: false,
  adminTab: "requests",
};

/* ============================== Status banner ============================== */
function showStatus(msg, type) {
  const el = document.getElementById("status-banner");
  el.innerHTML = msg;
  el.className = type === "info" ? "info" : "";
  el.classList.remove("hidden");
}
function hideStatus() {
  document.getElementById("status-banner").classList.add("hidden");
}
function connectionErrorMsg(err) {
  return `Couldn't reach the recipe database (${escapeHtml(err && err.message ? err.message : String(err))}).
    This usually means Firestore Database hasn't been created yet for this Firebase project, or its rules
    don't allow access. See the README "Deployment" steps.`;
}

/* ============================== Boot ============================== */
document.addEventListener("DOMContentLoaded", () => {
  const saved = JSON.parse(localStorage.getItem("me-recipe-session") || "null");
  showStatus("Connecting to the recipe database…", "info");
  ensureConfigDoc().then(() => {
    hideStatus();
    listenPins();
    if (saved && saved.role) {
      state.role = saved.role;
      state.name = saved.name;
      enterApp();
    } else {
      showGate();
    }
  }).catch((err) => {
    showStatus(connectionErrorMsg(err));
    showGate();
  });

  document.getElementById("gate-unlock-btn").addEventListener("click", handleUnlock);
  document.getElementById("gate-pin").addEventListener("keydown", (e) => { if (e.key === "Enter") handleUnlock(); });
  document.getElementById("search-input").addEventListener("input", (e) => { state.query = e.target.value; renderBody(); });
  document.getElementById("lock-btn").addEventListener("click", lockApp);
  document.getElementById("admin-open-btn").addEventListener("click", () => openAdmin("requests"));
  document.getElementById("my-requests-btn").addEventListener("click", () => openAdmin("mine"));
  document.getElementById("modal-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "modal-backdrop") closeModal();
  });
  document.getElementById("drawer-backdrop").addEventListener("click", (e) => {
    if (e.target.id === "drawer-backdrop") closeAdmin();
  });
});

async function ensureConfigDoc() {
  const ref = db.collection("config").doc("access");
  const snap = await ref.get();
  if (!snap.exists) await ref.set({ userPin: "4671", adminPin: "2580" });
}
function listenPins() {
  db.collection("config").doc("access").onSnapshot(
    (snap) => {
      if (snap.exists) state.pins = { user: snap.data().userPin, admin: snap.data().adminPin };
    },
    (err) => showStatus(connectionErrorMsg(err))
  );
}

/* ============================== Gate ============================== */
function showGate() {
  document.getElementById("gate-screen").classList.remove("hidden");
  document.getElementById("app-shell").classList.add("hidden");
}
function handleUnlock() {
  const name = document.getElementById("gate-name").value.trim();
  const pin = document.getElementById("gate-pin").value.trim();
  const errEl = document.getElementById("gate-error");
  if (!name) { errEl.textContent = "Please enter your name."; return; }
  let role = null;
  if (pin === state.pins.admin) role = "admin";
  else if (pin === state.pins.user) role = "user";
  if (!role) { errEl.textContent = "That code isn't recognized — check with your manager."; return; }
  errEl.textContent = "";
  state.role = role;
  state.name = name;
  localStorage.setItem("me-recipe-session", JSON.stringify({ role, name }));
  enterApp();
}
function lockApp() {
  localStorage.removeItem("me-recipe-session");
  state.role = null;
  location.reload();
}

/* ============================== Enter app ============================== */
function enterApp() {
  document.getElementById("gate-screen").classList.add("hidden");
  document.getElementById("app-shell").classList.remove("hidden");
  document.getElementById("who-am-i").textContent = `${state.name} · ${state.role === "admin" ? "Admin" : "Kitchen staff"}`;
  document.getElementById("admin-open-btn").classList.toggle("hidden", state.role !== "admin");

  listenCategories();
  listenRecipes();
  listenRequests();
}

function listenCategories() {
  db.collection("categories").get().then(async (snap) => {
    if (snap.empty) {
      const batch = db.batch();
      CATEGORIES.forEach((c) => batch.set(db.collection("categories").doc(c.id), c));
      await batch.commit();
    }
    db.collection("categories").orderBy("order").onSnapshot(
      (s) => {
        state.categories = s.docs.map((d) => d.data());
        renderSidebarNav();
        renderBody();
      },
      (err) => showStatus(connectionErrorMsg(err))
    );
  }).catch((err) => showStatus(connectionErrorMsg(err)));
}

function listenRecipes() {
  db.collection("recipes").get().then(async (snap) => {
    if (snap.empty) {
      const batch = db.batch();
      SEED_RECIPES.forEach((r) => {
        batch.set(db.collection("recipes").doc(r.id), {
          ...r,
          version: 1,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedBy: "seed",
        });
      });
      await batch.commit();
    }
    db.collection("recipes").onSnapshot(
      (s) => {
        state.recipes = s.docs.map((d) => ({ ...d.data(), id: d.id }));
        renderBody();
        if (state.selectedRecipeId) renderModal();
        if (state.adminOpen) renderAdmin();
      },
      (err) => showStatus(connectionErrorMsg(err))
    );
  }).catch((err) => showStatus(connectionErrorMsg(err)));
}

function listenRequests() {
  db.collection("requests").orderBy("createdAt", "desc").onSnapshot(
    (s) => {
      state.requests = s.docs.map((d) => ({ ...d.data(), id: d.id }));
      const pendingCount = state.requests.filter((r) => r.status === "pending").length;
      const badge = document.getElementById("req-badge");
      if (pendingCount > 0 && state.role === "admin") {
        badge.textContent = pendingCount;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
      if (state.adminOpen) renderAdmin();
    },
    (err) => showStatus(connectionErrorMsg(err))
  );
}

/* ============================== View mode / navigation ============================== */
function setViewMode(mode) {
  state.viewMode = mode;
  document.getElementById("search-input").placeholder = mode === "dishes"
    ? "Search dishes, ingredients, method…"
    : "Search sauces, dressings, sub-recipes…";
}

function goToAllDishes() {
  state.viewMode = "dishes"; state.activeCat = "all"; state.showFavoritesOnly = false;
  setViewMode("dishes"); renderSidebarNav(); renderBody(); closeMobileSidebar();
}
function goToCategory(catId) {
  state.viewMode = "dishes"; state.activeCat = catId; state.showFavoritesOnly = false;
  setViewMode("dishes"); renderSidebarNav(); renderBody(); closeMobileSidebar();
}
function goToFavorites() {
  state.viewMode = "dishes"; state.activeCat = "all"; state.showFavoritesOnly = true;
  setViewMode("dishes"); renderSidebarNav(); renderBody(); closeMobileSidebar();
}
function goToAllRecipes() {
  state.viewMode = "components"; state.showFavoritesOnly = false;
  setViewMode("components"); renderSidebarNav(); renderBody(); closeMobileSidebar();
}
function closeMobileSidebar() {
  document.getElementById("sidebar").classList.remove("open");
  document.getElementById("sidebar-scrim").classList.remove("open");
}

/* ============================== Sidebar nav ============================== */
function renderSidebarNav() {
  const wrap = document.getElementById("sidebar-nav");
  const counts = {};
  state.recipes.filter((r) => !r.archived).forEach((r) => { counts[r.category] = (counts[r.category] || 0) + 1; });
  const totalDishes = state.recipes.filter((r) => !r.archived).length;
  const isDishesAll = state.viewMode === "dishes" && state.activeCat === "all" && !state.showFavoritesOnly;
  const isFavs = state.viewMode === "dishes" && state.showFavoritesOnly;
  const isAllRecipes = state.viewMode === "components";

  wrap.innerHTML = "";
  wrap.appendChild(navItem({ icon: "🍽", label: "All Dishes", count: totalDishes, active: isDishesAll, onClick: goToAllDishes }));

  const label = document.createElement("div");
  label.className = "nav-section-label";
  label.textContent = "Categories";
  wrap.appendChild(label);
  state.categories.forEach((c) => {
    const active = state.viewMode === "dishes" && state.activeCat === c.id && !state.showFavoritesOnly;
    wrap.appendChild(navItem({ dot: true, label: c.label, count: counts[c.id] || 0, active, onClick: () => goToCategory(c.id) }));
  });

  const label2 = document.createElement("div");
  label2.className = "nav-section-label";
  label2.textContent = "Browse";
  wrap.appendChild(label2);
  wrap.appendChild(navItem({ icon: "★", label: "Favorites", count: state.favorites.length, active: isFavs, onClick: goToFavorites }));
  wrap.appendChild(navItem({ icon: "🧾", label: "All Recipes (flat list)", active: isAllRecipes, onClick: goToAllRecipes }));
}

function navItem({ icon, dot, label, count, active, onClick }) {
  const b = document.createElement("button");
  b.className = "nav-item" + (active ? " active" : "");
  b.innerHTML = `
    ${icon ? `<span>${icon}</span>` : dot ? `<span class="nav-dot"></span>` : ""}
    <span>${escapeHtml(label)}</span>
    ${count !== undefined ? `<span class="nav-count">${count}</span>` : ""}
  `;
  b.addEventListener("click", onClick);
  return b;
}

function updateContentTitle() {
  const el = document.getElementById("content-title");
  if (state.viewMode === "components") { el.textContent = "All Recipes"; return; }
  if (state.showFavoritesOnly) { el.textContent = "Favorites"; return; }
  if (state.activeCat === "all") { el.textContent = "All Dishes"; return; }
  const cat = state.categories.find((c) => c.id === state.activeCat);
  el.textContent = cat ? cat.label : "Dishes";
}

/* ============================== Body / grid ============================== */

function matchesSearch(r, q) {
  if (!q) return true;
  const hay = [
    r.nameEn, r.nameAr, r.chefNotes, r.platingNotes,
    ...(r.components || []).flatMap((c) => [c.title, ...(c.ingredients || []), ...(c.method || [])]),
  ].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}

function visibleRecipes() {
  const q = state.query.trim();
  let list = state.recipes.filter((r) => !r.archived);
  if (state.showFavoritesOnly) list = list.filter((r) => state.favorites.includes(r.id));
  if (q) list = list.filter((r) => matchesSearch(r, q));
  else if (state.activeCat !== "all") list = list.filter((r) => r.category === state.activeCat);
  return list;
}

function recipeStatus(r) {
  const draft = (r.components || []).some((c) => c.draft);
  return draft ? "draft" : "verified";
}

function renderBody() {
  updateContentTitle();
  if (state.viewMode === "components") renderComponentsBody();
  else renderDishesBody();
}

function renderDishesBody() {
  const body = document.getElementById("app-body-content");
  const list = visibleRecipes();
  const q = state.query.trim();

  document.getElementById("result-count").textContent = `${list.length} dish${list.length === 1 ? "" : "es"}${q ? ` for "${q}"` : ""}`;
  document.getElementById("result-count").classList.remove("hidden");

  body.innerHTML = "";

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    if (state.showFavoritesOnly) {
      empty.textContent = "No favorites saved on this device yet — tap the star on a recipe to add one.";
    } else if (state.recipes.length === 0 && !q) {
      empty.innerHTML = "No recipes have loaded yet.<br>If this doesn't change in a few seconds, check the banner at the top of the page — it usually means Firestore Database hasn't been created for this project yet, or its rules are blocking access. See the README's step-by-step setup.";
    } else {
      empty.textContent = "Nothing matches yet. Try another dish, ingredient, or category.";
    }
    body.appendChild(empty);
    return;
  }

  const byCat = {};
  list.forEach((r) => { (byCat[r.category] = byCat[r.category] || []).push(r); });
  Object.values(byCat).forEach((arr) => arr.sort((a, b) => a.nameEn.localeCompare(b.nameEn)));

  const catsToShow = (q || state.activeCat === "all" || state.showFavoritesOnly)
    ? state.categories
    : state.categories.filter((c) => c.id === state.activeCat);
  const showHeaders = catsToShow.length > 1 || q || state.showFavoritesOnly;

  catsToShow.forEach((cat) => {
    const items = byCat[cat.id];
    if (!items || items.length === 0) return;
    const section = document.createElement("div");
    section.className = "section-block";
    section.innerHTML = showHeaders ? `
      <div class="section-head">
        <span class="section-title">${cat.label}</span>
        <span class="section-count">${items.length} dish${items.length === 1 ? "" : "es"}</span>
      </div>
      <div class="list-box"></div>
    ` : `<div class="list-box"></div>`;
    const box = section.querySelector(".list-box");
    items.forEach((r) => box.appendChild(dishListRowEl(r)));
    body.appendChild(section);
  });
}

function dishListRowEl(r) {
  const row = document.createElement("div");
  row.className = "list-row";
  const status = recipeStatus(r);
  const isFav = state.favorites.includes(r.id);
  row.innerHTML = `
    <span class="list-row-dot ${status === "draft" ? "draft" : ""}" title="${status === "draft" ? "Draft — needs review" : "Verified"}"></span>
    <span class="list-row-name">${escapeHtml(r.nameEn)}${r.nameAr ? `<span class="ar" dir="rtl">${escapeHtml(r.nameAr)}</span>` : ""}</span>
    <button class="list-row-star${isFav ? " active" : ""}" data-fav="${r.id}" title="Favorite">★</button>
    <span class="list-chevron">›</span>
  `;
  row.querySelector("[data-fav]").addEventListener("click", (e) => { e.stopPropagation(); toggleFavorite(r.id); });
  row.addEventListener("click", () => openModal(r.id));
  return row;
}

/* ---- Recipes & components (flat sub-recipe catalog) ---- */
function computeComponentCatalog() {
  const map = new Map();
  state.recipes.filter((r) => !r.archived).forEach((r) => {
    (r.components || []).forEach((c, idx) => {
      const key = (c.title || "").trim().toLowerCase() + "|" + (c.ingredients || []).join("~") + "|" + (c.method || []).join("~");
      if (!map.has(key)) {
        map.set(key, {
          key,
          title: c.title || "Untitled",
          draft: !!c.draft,
          ingredients: c.ingredients || [],
          method: c.method || [],
          category: r.category,
          usedIn: [],
        });
      }
      const entry = map.get(key);
      entry.draft = entry.draft || !!c.draft;
      entry.usedIn.push({ recipeId: r.id, recipeName: r.nameEn, componentIndex: idx });
    });
  });
  return Array.from(map.values());
}

function matchesComponentSearch(entry, q) {
  if (!q) return true;
  const hay = [
    entry.title, ...entry.ingredients, ...entry.method,
    ...entry.usedIn.map((u) => u.recipeName),
  ].join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}

function renderComponentsBody() {
  const body = document.getElementById("app-body-content");
  const q = state.query.trim();
  let list = computeComponentCatalog();
  if (q) list = list.filter((e) => matchesComponentSearch(e, q));
  else if (state.activeCat !== "all") list = list.filter((e) => e.category === state.activeCat);
  list.sort((a, b) => a.title.localeCompare(b.title));

  document.getElementById("result-count").textContent = `${list.length} item${list.length === 1 ? "" : "s"}${q ? ` for "${q}"` : ""}`;
  document.getElementById("result-count").classList.remove("hidden");

  body.innerHTML = "";

  if (list.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No sub-recipes match yet. Try another ingredient, sauce name, or dish it's used in.";
    body.appendChild(empty);
    return;
  }

  const section = document.createElement("div");
  section.className = "section-block";
  section.innerHTML = `<div class="list-box"></div>`;
  const box = section.querySelector(".list-box");
  list.forEach((e) => box.appendChild(componentListRowEl(e)));
  body.appendChild(section);
}

function componentListRowEl(entry) {
  const row = document.createElement("div");
  row.className = "list-row";
  const dishNames = [...new Set(entry.usedIn.map((u) => u.recipeName))];
  row.innerHTML = `
    <span class="list-row-dot ${entry.draft ? "draft" : ""}" title="${entry.draft ? "Draft — needs review" : "Verified"}"></span>
    <span class="list-row-name">${escapeHtml(entry.title)}</span>
    <span class="list-row-sub">${escapeHtml(dishNames.join(", "))}</span>
    <span class="list-chevron">›</span>
  `;
  row.addEventListener("click", () => openComponentModal(entry.key));
  return row;
}

function initials(text) {
  return (text || "?").split(" ").filter((w) => w.length).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}


function allergenPillsHtml(codes, source) {
  if (!codes || codes.length === 0) return "";
  return codes.map((c) => `<span class="allergen-pill" title="${source === "unverified-menu" ? "Unverified — from guest menu" : ""}">${ALLERGEN_LABELS[c] || c}</span>`).join("");
}

function ingredientListHtml(items, keyPrefix) {
  if (!items || items.length === 0) return `<div class="hint-text" style="margin-top:0;">No ingredients listed.</div>`;
  return `<ul class="ingredient-list">${items.map((i, idx) => `
    <li class="ingredient-row" data-check-row="${keyPrefix}-${idx}">
      <input type="checkbox" id="chk-${keyPrefix}-${idx}">
      <label for="chk-${keyPrefix}-${idx}">${escapeHtml(i)}</label>
    </li>
  `).join("")}</ul>`;
}
function wireIngredientChecks() {
  document.querySelectorAll("[data-check-row]").forEach((row) => {
    const cb = row.querySelector("input[type=checkbox]");
    if (!cb) return;
    cb.addEventListener("change", () => row.classList.toggle("checked", cb.checked));
  });
}

function methodListHtml(steps) {
  if (!steps || steps.length === 0) return `<div class="hint-text" style="margin-top:0;">No method listed.</div>`;
  return `<ol class="method-steps">${steps.map((m) => `
    <li class="method-step"><span class="method-step-num"></span><span>${escapeHtml(m)}</span></li>
  `).join("")}</ol>`;
}

function toggleFavorite(id) {
  const i = state.favorites.indexOf(id);
  if (i >= 0) state.favorites.splice(i, 1); else state.favorites.push(id);
  localStorage.setItem("me-recipe-favs", JSON.stringify(state.favorites));
  renderSidebarNav();
  renderBody();
  if (state.selectedRecipeId === id) renderModal();
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
}

/* ============================== Recipe modal ============================== */
function openModal(id) {
  state.selectedRecipeId = id;
  state.selectedComponentKey = null;
  state.activeDetailTab = 0;
  state.editFormOpen = false;
  renderModal();
  document.getElementById("modal-backdrop").classList.remove("hidden");
}
function openComponentModal(key) {
  state.selectedComponentKey = key;
  state.selectedRecipeId = null;
  renderModal();
  document.getElementById("modal-backdrop").classList.remove("hidden");
}
function closeModal() {
  state.selectedRecipeId = null;
  state.selectedComponentKey = null;
  document.getElementById("modal-backdrop").classList.add("hidden");
}

function renderModal() {
  if (state.selectedComponentKey) renderComponentModal();
  else renderRecipeModal();
}

function renderComponentModal() {
  const entry = computeComponentCatalog().find((e) => e.key === state.selectedComponentKey);
  const wrap = document.getElementById("modal-card");
  if (!entry) { wrap.innerHTML = ""; return; }
  const dishNames = [...new Set(entry.usedIn.map((u) => u.recipeName))];
  const primary = entry.usedIn[0];

  wrap.innerHTML = `
    <button class="modal-close" id="modal-close-btn">✕</button>
    <div class="modal-img-fallback">${initials(entry.title)}</div>
    <div class="modal-body">
      <div class="modal-title-row">
        <div>
          <div class="modal-title">${escapeHtml(entry.title)}</div>
        </div>
      </div>
      <div class="modal-badges">
        <span class="badge ${entry.draft ? "badge-draft" : "badge-verified"}">${entry.draft ? "Draft — needs chef review" : "Verified from source"}</span>
      </div>

      <div class="note-box">
        <b>Used in:</b>
        ${dishNames.map((n) => `<a href="#" class="used-in-link" data-recipe-name="${escapeHtml(n)}">${escapeHtml(n)}</a>`).join(", ")}
        ${dishNames.length > 1 ? "<br><span style='color:var(--muted);'>This is a shared sub-recipe — if you request a change here, remember it may need updating in the other dishes too.</span>" : ""}
      </div>

      <div class="part-panel-grid" style="margin-top:20px;">
        <div>
          <div class="panel-heading">Ingredients</div>
          ${ingredientListHtml(entry.ingredients, "comp")}
        </div>
        <div>
          <div class="panel-heading">Method</div>
          ${methodListHtml(entry.method)}
        </div>
      </div>

      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" id="req-edit-btn">✎ Request a change</button>
        <button class="btn btn-ghost btn-sm" id="open-parent-btn">📖 Open full dish recipe</button>
      </div>
      <div id="modal-extra"></div>
    </div>
  `;

  document.getElementById("modal-close-btn").addEventListener("click", closeModal);
  document.getElementById("open-parent-btn").addEventListener("click", () => openModal(primary.recipeId));
  wireIngredientChecks();
  document.querySelectorAll(".used-in-link").forEach((a) => a.addEventListener("click", (e) => {
    e.preventDefault();
    const u = entry.usedIn.find((x) => x.recipeName === a.dataset.recipeName);
    if (u) openModal(u.recipeId);
  }));
  document.getElementById("req-edit-btn").addEventListener("click", () => {
    const parentRecipe = state.recipes.find((r) => r.id === primary.recipeId);
    if (parentRecipe) showEditRequestForm(parentRecipe, `component:${primary.componentIndex}:ingredients`);
  });
}

function renderRecipeModal() {
  const r = state.recipes.find((x) => x.id === state.selectedRecipeId);
  const wrap = document.getElementById("modal-card");
  if (!r) { wrap.innerHTML = ""; return; }

  const status = recipeStatus(r);
  const isFav = state.favorites.includes(r.id);
  const parts = r.components || [];
  if (state.activeDetailTab === undefined || state.activeDetailTab === null || state.activeDetailTab >= parts.length) {
    state.activeDetailTab = 0;
  }
  const activePart = parts[state.activeDetailTab] || { title: "", ingredients: [], method: [] };

  wrap.innerHTML = `
    <button class="modal-close" id="modal-close-btn">✕</button>
    ${r.image ? `<img class="modal-img" src="${r.image}" alt="${escapeHtml(r.nameEn)}">` : `<div class="modal-img-fallback">${initials(r.nameEn)}</div>`}
    <div class="modal-body">
      <div class="modal-title-row">
        <div>
          <div class="modal-title">${escapeHtml(r.nameEn)}</div>
          ${r.nameAr ? `<div class="modal-title-ar" dir="rtl">${escapeHtml(r.nameAr)}</div>` : ""}
        </div>
        <button class="fav-star${isFav ? " active" : ""}" id="modal-fav-btn">★</button>
      </div>
      <div class="modal-badges">
        <span class="badge ${status === "draft" ? "badge-draft" : "badge-verified"}">${status === "draft" ? "⚠ Draft — needs chef review" : "✓ Verified from source"}</span>
        <span class="badge">Version ${r.version || 1}</span>
        ${r.archived ? '<span class="badge badge-archived">Archived</span>' : ""}
      </div>

      <div class="stat-strip">
        <div class="stat-box"><div class="stat-box-label">Prep</div><div class="stat-box-value">${escapeHtml(r.prepTime) || "—"}</div></div>
        <div class="stat-box"><div class="stat-box-label">Cook</div><div class="stat-box-value">${escapeHtml(r.cookTime) || "—"}</div></div>
        <div class="stat-box"><div class="stat-box-label">Yield</div><div class="stat-box-value">${escapeHtml(r.yield) || "—"}</div></div>
      </div>

      ${(r.allergens && r.allergens.length) ? `
        <div class="form-label">Allergens ${r.allergensSource === "unverified-menu" ? "(unverified — from guest menu)" : ""}</div>
        <div class="allergen-row">${allergenPillsHtml(r.allergens, r.allergensSource)}</div>` : ""}

      ${r.dishExplanation ? `<div class="note-box">${escapeHtml(r.dishExplanation)}</div>` : ""}
      ${r.chefNotes ? `<div class="note-box"><b>Chef notes:</b> ${escapeHtml(r.chefNotes)}</div>` : ""}

      ${parts.length > 1 ? `
        <div class="part-tabs">
          ${parts.map((c, i) => `
            <button class="part-tab${i === state.activeDetailTab ? " active" : ""}" data-tab="${i}">
              ${c.draft ? '<span class="dot"></span>' : ""}${escapeHtml(c.title)}
            </button>
          `).join("")}
        </div>
      ` : `<div class="panel-heading" style="margin-top:22px;">${escapeHtml(activePart.title)}</div>`}

      <div class="part-panel">
        <div class="part-panel-grid">
          <div>
            <div class="panel-heading">Ingredients</div>
            ${ingredientListHtml(activePart.ingredients, "dish" + state.activeDetailTab)}
          </div>
          <div>
            <div class="panel-heading">Method</div>
            ${methodListHtml(activePart.method)}
          </div>
        </div>
      </div>

      ${r.platingNotes ? `<div class="note-box"><b>Plating:</b> ${escapeHtml(r.platingNotes)}</div>` : `<div class="form-label" style="margin-top:16px;">Plating notes: not set yet</div>`}

      <div class="modal-actions">
        <button class="btn btn-outline btn-sm" id="req-edit-btn">✎ Request a change</button>
        ${state.role === "admin" ? `<button class="btn btn-outline btn-sm" id="admin-edit-btn">🛠 Edit directly (admin)</button>` : ""}
        <button class="btn btn-ghost btn-sm" id="history-btn">🕘 Version history</button>
        <button class="btn btn-ghost btn-sm" id="print-btn">🖨 Print</button>
        ${state.role === "admin" ? `<button class="btn btn-danger btn-sm" id="archive-btn">${r.archived ? "Restore" : "Archive"}</button>` : ""}
      </div>

      <div id="modal-extra"></div>
    </div>
  `;

  document.getElementById("modal-close-btn").addEventListener("click", closeModal);
  document.getElementById("modal-fav-btn").addEventListener("click", () => toggleFavorite(r.id));
  document.getElementById("req-edit-btn").addEventListener("click", () => showEditRequestForm(r, `component:${state.activeDetailTab}:ingredients`));
  document.getElementById("history-btn").addEventListener("click", () => showHistory(r));
  document.getElementById("print-btn").addEventListener("click", () => printRecipe(r));
  wireIngredientChecks();
  document.querySelectorAll("[data-tab]").forEach((el) => el.addEventListener("click", () => {
    state.activeDetailTab = Number(el.dataset.tab);
    document.getElementById("modal-extra").innerHTML = "";
    renderModal();
  }));
  if (state.role === "admin") {
    document.getElementById("admin-edit-btn").addEventListener("click", () => showAdminDirectEdit(r));
    document.getElementById("archive-btn").addEventListener("click", () => toggleArchive(r));
  }
}

/* ---- Request-a-change form ---- */

function showEditRequestForm(r, presetField) {
  const extra = document.getElementById("modal-extra");
  const fieldOptions = [
    { v: "prepTime", l: "Prep time" },
    { v: "cookTime", l: "Cook time" },
    { v: "yield", l: "Yield / portions" },
    { v: "chefNotes", l: "Chef notes" },
    { v: "platingNotes", l: "Plating notes" },
    { v: "allergens", l: "Allergens (comma separated, e.g. D, G, N)" },
    ...(r.components || []).map((c, i) => ({ v: `component:${i}:ingredients`, l: `Ingredients — ${c.title}` })),
    ...(r.components || []).map((c, i) => ({ v: `component:${i}:method`, l: `Method — ${c.title}` })),
  ];
  extra.innerHTML = `
    <div class="component-block">
      <div class="component-title">Request a change</div>
      <label class="form-label">What would you like to change?</label>
      <select class="field" id="req-field">
        ${fieldOptions.map((o) => `<option value="${o.v}" ${presetField === o.v ? "selected" : ""}>${o.l}</option>`).join("")}
      </select>
      <label class="form-label">New value</label>
      <textarea class="field" id="req-value" rows="4" placeholder="For ingredients/method, one item per line"></textarea>
      <label class="form-label">Why is this change needed?</label>
      <textarea class="field" id="req-reason" rows="2" placeholder="Explain the reason for the change"></textarea>
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost btn-sm" id="req-cancel">Cancel</button>
        <button class="btn btn-gold btn-sm" id="req-submit">Send for approval</button>
      </div>
      <div id="req-confirm" class="hint-text hidden">Sent to the admin for approval.</div>
    </div>
  `;
  document.getElementById("req-cancel").addEventListener("click", () => { extra.innerHTML = ""; });
  document.getElementById("req-submit").addEventListener("click", async () => {
    const field = document.getElementById("req-field").value;
    const newValue = document.getElementById("req-value").value.trim();
    const reason = document.getElementById("req-reason").value.trim();
    if (!newValue) return;
    const fieldLabel = fieldOptions.find((o) => o.v === field)?.l || field;
    const oldValue = getOldValueForField(r, field);
    await db.collection("requests").add({
      recipeId: r.id, recipeName: r.nameEn, field, fieldLabel,
      oldValue, newValue, reason,
      requestedBy: state.name, status: "pending",
      adminNote: "", createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    document.getElementById("req-submit").disabled = true;
    document.getElementById("req-confirm").classList.remove("hidden");
  });
}

function getOldValueForField(r, field) {
  if (field.startsWith("component:")) {
    const [, idx, sub] = field.split(":");
    const c = (r.components || [])[Number(idx)];
    return c ? (c[sub] || []).join("\n") : "";
  }
  if (field === "allergens") return (r.allergens || []).join(", ");
  return r[field] || "";
}

/* ---- Admin direct edit (bypasses request queue — admin is the authority) ---- */
function showAdminDirectEdit(r) {
  const extra = document.getElementById("modal-extra");
  const componentsHtml = (r.components || []).map((c, i) => `
    <div class="component-block">
      <div class="component-title">${escapeHtml(c.title)}</div>
      <label class="form-label">Ingredients (one per line)</label>
      <textarea class="field" id="ae-ing-${i}" rows="4">${escapeHtml((c.ingredients || []).join("\n"))}</textarea>
      <label class="form-label">Method (one step per line)</label>
      <textarea class="field" id="ae-method-${i}" rows="4">${escapeHtml((c.method || []).join("\n"))}</textarea>
      <label class="form-label">
        <input type="checkbox" id="ae-draft-${i}" ${c.draft ? "checked" : ""}> Still a draft (needs chef confirmation)
      </label>
    </div>
  `).join("");

  extra.innerHTML = `
    <div class="component-block">
      <div class="component-title">Edit directly</div>
      <label class="form-label">Prep time</label>
      <input class="field" id="ae-prep" value="${escapeHtml(r.prepTime)}">
      <label class="form-label">Cook time</label>
      <input class="field" id="ae-cook" value="${escapeHtml(r.cookTime)}">
      <label class="form-label">Yield</label>
      <input class="field" id="ae-yield" value="${escapeHtml(r.yield)}">
      <label class="form-label">Chef notes</label>
      <textarea class="field" id="ae-notes" rows="2">${escapeHtml(r.chefNotes)}</textarea>
      <label class="form-label">Plating notes</label>
      <textarea class="field" id="ae-plating" rows="2">${escapeHtml(r.platingNotes)}</textarea>
      <label class="form-label">Allergens (comma separated)</label>
      <input class="field" id="ae-allergens" value="${(r.allergens || []).join(", ")}">
      <label class="form-label">Image path (e.g. images/dish-name.jpg)</label>
      <input class="field" id="ae-image" value="${escapeHtml(r.image)}">
    </div>
    ${componentsHtml}
    <div class="component-block">
      <div style="display:flex; gap:8px;">
        <button class="btn btn-ghost btn-sm" id="ae-cancel">Cancel</button>
        <button class="btn btn-gold btn-sm" id="ae-save">Save (admin)</button>
      </div>
    </div>
  `;
  document.getElementById("ae-cancel").addEventListener("click", () => { extra.innerHTML = ""; });
  document.getElementById("ae-save").addEventListener("click", async () => {
    const components = (r.components || []).map((c, i) => ({
      ...c,
      ingredients: document.getElementById(`ae-ing-${i}`).value.split("\n").map((s) => s.trim()).filter(Boolean),
      method: document.getElementById(`ae-method-${i}`).value.split("\n").map((s) => s.trim()).filter(Boolean),
      draft: document.getElementById(`ae-draft-${i}`).checked,
    }));
    const patch = {
      prepTime: document.getElementById("ae-prep").value.trim(),
      cookTime: document.getElementById("ae-cook").value.trim(),
      yield: document.getElementById("ae-yield").value.trim(),
      chefNotes: document.getElementById("ae-notes").value.trim(),
      platingNotes: document.getElementById("ae-plating").value.trim(),
      allergens: document.getElementById("ae-allergens").value.split(",").map((s) => s.trim()).filter(Boolean),
      allergensSource: "kitchen-confirmed",
      image: document.getElementById("ae-image").value.trim(),
      components,
    };
    await applyRecipeChange(r, patch, `Direct edit by admin ${state.name}`, state.name, state.name);
    extra.innerHTML = "";
  });
}

async function toggleArchive(r) {
  await applyRecipeChange(r, { archived: !r.archived }, r.archived ? "Restored by admin" : "Archived by admin", state.name, state.name);
}

/* ---- Apply a change to a recipe + push version history ---- */
async function applyRecipeChange(r, patch, summary, changedBy, approvedBy) {
  const ref = db.collection("recipes").doc(r.id);
  const prevSnapshot = { ...r };
  delete prevSnapshot.id;
  await ref.collection("versions").add({
    version: r.version || 1,
    snapshot: prevSnapshot,
    changedBy: changedBy || "",
    approvedBy: approvedBy || "",
    summary,
    changedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
  await ref.update({
    ...patch,
    version: (r.version || 1) + 1,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    updatedBy: approvedBy || changedBy || "",
  });
}

/* ---- Version history ---- */
async function showHistory(r) {
  const extra = document.getElementById("modal-extra");
  extra.innerHTML = `<div class="component-block"><div class="component-title">Version history</div><div class="hint-text">Loading…</div></div>`;
  const snap = await db.collection("recipes").doc(r.id).collection("versions").orderBy("changedAt", "desc").get();
  if (snap.empty) {
    extra.innerHTML = `<div class="component-block"><div class="component-title">Version history</div><div class="hint-text">No changes recorded yet — this is the original version.</div></div>`;
    return;
  }
  const rows = snap.docs.map((d) => {
    const v = d.data();
    const when = v.changedAt && v.changedAt.toDate ? v.changedAt.toDate().toLocaleString() : "";
    return `
      <div class="req-card">
        <div class="req-title">Version ${v.version}</div>
        <div class="req-meta">${escapeHtml(summaryLine(v))} · ${when}</div>
      </div>
    `;
  }).join("");
  extra.innerHTML = `<div class="component-block"><div class="component-title">Version history</div>${rows}</div>`;
}
function summaryLine(v) {
  const who = v.changedBy && v.approvedBy && v.changedBy !== v.approvedBy
    ? `requested by ${v.changedBy}, approved by ${v.approvedBy}`
    : (v.approvedBy ? `by ${v.approvedBy}` : "");
  return `${v.summary || "Updated"} — ${who}`;
}

/* ---- Print ---- */
function printRecipe(r) {
  const area = document.getElementById("print-area");
  const componentsHtml = (r.components || []).map((c) => `
    <h2>${escapeHtml(c.title)}${c.draft ? " (draft — needs confirmation)" : ""}</h2>
    ${(c.ingredients || []).length ? `<ul>${c.ingredients.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>` : ""}
    ${(c.method || []).length ? `<ol>${c.method.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ol>` : ""}
  `).join("");
  area.innerHTML = `
    <h1>${escapeHtml(r.nameEn)}</h1>
    <div class="print-meta">Version ${r.version || 1} · Prep: ${r.prepTime || "—"} · Cook: ${r.cookTime || "—"} · Yield: ${r.yield || "—"}</div>
    ${r.allergens && r.allergens.length ? `<div class="print-meta">Allergens: ${r.allergens.join(", ")}${r.allergensSource === "unverified-menu" ? " (unverified — from guest menu)" : ""}</div>` : ""}
    ${r.chefNotes ? `<p><b>Chef notes:</b> ${escapeHtml(r.chefNotes)}</p>` : ""}
    ${componentsHtml}
    ${r.platingNotes ? `<h2>Plating</h2><p>${escapeHtml(r.platingNotes)}</p>` : ""}
  `;
  window.print();
}

/* ============================== Admin drawer ============================== */
function openAdmin(tab) {
  state.adminOpen = true;
  state.adminTab = tab === "mine" ? "mine" : "requests";
  document.getElementById("drawer-backdrop").classList.remove("hidden");
  renderAdmin();
}
function closeAdmin() {
  state.adminOpen = false;
  document.getElementById("drawer-backdrop").classList.add("hidden");
}

function renderAdmin() {
  const isAdmin = state.role === "admin";
  const tabs = isAdmin
    ? [["requests", "Pending requests"], ["mine", "My requests"], ["recipes", "Recipes"], ["categories", "Categories"], ["settings", "Settings"]]
    : [["mine", "My requests"]];
  if (!tabs.find((t) => t[0] === state.adminTab)) state.adminTab = tabs[0][0];

  const tabsHtml = tabs.map(([id, label]) =>
    `<button class="tab-btn${state.adminTab === id ? " active" : ""}" data-tab="${id}">${label}</button>`
  ).join("");

  let bodyHtml = "";
  if (state.adminTab === "requests") bodyHtml = renderPendingRequests();
  else if (state.adminTab === "mine") bodyHtml = renderMyRequests();
  else if (state.adminTab === "recipes") bodyHtml = renderRecipeAdmin();
  else if (state.adminTab === "categories") bodyHtml = renderCategoryAdmin();
  else if (state.adminTab === "settings") bodyHtml = renderSettingsAdmin();

  document.getElementById("drawer-content").innerHTML = `
    <div class="tabs">${tabsHtml}</div>
    <div id="admin-tab-body">${bodyHtml}</div>
  `;
  document.querySelectorAll("#drawer-content .tab-btn").forEach((b) =>
    b.addEventListener("click", () => { state.adminTab = b.dataset.tab; renderAdmin(); })
  );
  wireAdminTabEvents();
}

function renderPendingRequests() {
  const pending = state.requests.filter((r) => r.status === "pending");
  if (pending.length === 0) return `<div class="hint-text">No pending requests right now.</div>`;
  return pending.map((req) => `
    <div class="req-card" data-req="${req.id}">
      <div class="req-title">${escapeHtml(req.recipeName)}</div>
      <div class="req-meta">${escapeHtml(req.fieldLabel || req.field)} · requested by ${escapeHtml(req.requestedBy)}</div>
      <div class="diff-row"><span class="diff-old">${escapeHtml(String(req.oldValue).slice(0, 200))}</span></div>
      <div class="diff-row"><span class="diff-new">${escapeHtml(String(req.newValue).slice(0, 200))}</span></div>
      ${req.reason ? `<div class="req-meta" style="margin-top:6px;">Reason: “${escapeHtml(req.reason)}”</div>` : ""}
      <div class="req-actions">
        <button class="btn btn-gold btn-sm" data-approve="${req.id}">✓ Approve</button>
        <button class="btn btn-ghost btn-sm" data-clarify="${req.id}">? Ask for clarification</button>
        <button class="btn btn-danger btn-sm" data-reject="${req.id}">✕ Reject</button>
      </div>
    </div>
  `).join("");
}

function renderMyRequests() {
  const mine = state.requests.filter((r) => r.requestedBy === state.name);
  if (mine.length === 0) return `<div class="hint-text">You haven't submitted any change requests yet.</div>`;
  return mine.map((req) => `
    <div class="req-card">
      <div class="req-title">${escapeHtml(req.recipeName)}</div>
      <div class="req-meta">${escapeHtml(req.fieldLabel || req.field)} — status: <b>${req.status.replace("_", " ")}</b></div>
      ${req.adminNote ? `<div class="req-meta" style="margin-top:6px;">Admin: “${escapeHtml(req.adminNote)}”</div>` : ""}
    </div>
  `).join("");
}

function renderRecipeAdmin() {
  const archived = state.recipes.filter((r) => r.archived);
  const active = state.recipes.filter((r) => !r.archived);
  return `
    <button class="btn btn-gold btn-sm btn-block" id="new-recipe-btn" style="margin-bottom:12px;">+ Add new recipe</button>
    <div id="new-recipe-form"></div>
    <div class="form-label">Active (${active.length})</div>
    ${active.map((r) => `
      <div class="list-card">
        <div class="req-title">${escapeHtml(r.nameEn)}</div>
        <div class="req-meta">${escapeHtml(r.category)} · v${r.version || 1}</div>
        <div class="req-actions">
          <button class="btn btn-danger btn-sm" data-archive="${r.id}">Archive</button>
        </div>
      </div>
    `).join("")}
    ${archived.length ? `<div class="form-label" style="margin-top:16px;">Archived (${archived.length})</div>` : ""}
    ${archived.map((r) => `
      <div class="list-card">
        <div class="req-title">${escapeHtml(r.nameEn)}</div>
        <div class="req-meta">${escapeHtml(r.category)}</div>
        <div class="req-actions">
          <button class="btn btn-outline btn-sm" data-restore="${r.id}">Restore</button>
        </div>
      </div>
    `).join("")}
  `;
}

function renderCategoryAdmin() {
  return `
    <div class="settings-grid">
      <input class="field" id="new-cat-label" placeholder="New category name">
      <button class="btn btn-gold btn-sm" id="add-cat-btn">+ Add category</button>
    </div>
    <div class="form-label" style="margin-top:16px;">Existing</div>
    ${state.categories.map((c) => `<div class="list-card">${escapeHtml(c.label)}</div>`).join("")}
  `;
}

function renderSettingsAdmin() {
  return `
    <div class="form-label">User access code</div>
    <input class="field" id="set-user-pin" value="${escapeHtml(state.pins.user)}">
    <div class="form-label">Admin access code</div>
    <input class="field" id="set-admin-pin" value="${escapeHtml(state.pins.admin)}">
    <button class="btn btn-gold btn-sm" id="save-pins-btn">Save codes</button>
    <div class="hint-text">These are UI-level access codes, the same pattern as your live ordering board — not a full authentication system. Anyone with the code (and only the code) can get in at that role.</div>
  `;
}

function wireAdminTabEvents() {
  document.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => resolveRequest(b.dataset.approve, "approved")));
  document.querySelectorAll("[data-reject]").forEach((b) => b.addEventListener("click", () => resolveRequest(b.dataset.reject, "rejected")));
  document.querySelectorAll("[data-clarify]").forEach((b) => b.addEventListener("click", () => resolveRequest(b.dataset.clarify, "clarification_requested")));
  document.querySelectorAll("[data-archive]").forEach((b) => b.addEventListener("click", () => {
    const r = state.recipes.find((x) => x.id === b.dataset.archive);
    if (r) applyRecipeChange(r, { archived: true }, "Archived by admin", state.name, state.name);
  }));
  document.querySelectorAll("[data-restore]").forEach((b) => b.addEventListener("click", () => {
    const r = state.recipes.find((x) => x.id === b.dataset.restore);
    if (r) applyRecipeChange(r, { archived: false }, "Restored by admin", state.name, state.name);
  }));

  const newRecipeBtn = document.getElementById("new-recipe-btn");
  if (newRecipeBtn) newRecipeBtn.addEventListener("click", showNewRecipeForm);

  const addCatBtn = document.getElementById("add-cat-btn");
  if (addCatBtn) addCatBtn.addEventListener("click", async () => {
    const label = document.getElementById("new-cat-label").value.trim();
    if (!label) return;
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    await db.collection("categories").doc(id).set({ id, label, order: state.categories.length + 1 });
    document.getElementById("new-cat-label").value = "";
  });

  const savePinsBtn = document.getElementById("save-pins-btn");
  if (savePinsBtn) savePinsBtn.addEventListener("click", async () => {
    const userPin = document.getElementById("set-user-pin").value.trim();
    const adminPin = document.getElementById("set-admin-pin").value.trim();
    if (!userPin || !adminPin) return;
    await db.collection("config").doc("access").set({ userPin, adminPin });
    savePinsBtn.textContent = "Saved ✓";
  });
}

function showNewRecipeForm() {
  const wrap = document.getElementById("new-recipe-form");
  wrap.innerHTML = `
    <input class="field" id="nr-name" placeholder="Dish name">
    <select class="field" id="nr-cat">${state.categories.map((c) => `<option value="${c.id}">${c.label}</option>`).join("")}</select>
    <textarea class="field" id="nr-ingredients" rows="4" placeholder="Ingredients, one per line"></textarea>
    <textarea class="field" id="nr-method" rows="4" placeholder="Method steps, one per line"></textarea>
    <button class="btn btn-gold btn-sm" id="nr-save">Create recipe</button>
  `;
  document.getElementById("nr-save").addEventListener("click", async () => {
    const name = document.getElementById("nr-name").value.trim();
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") + "-" + Date.now().toString(36);
    const ingredients = document.getElementById("nr-ingredients").value.split("\n").map((s) => s.trim()).filter(Boolean);
    const method = document.getElementById("nr-method").value.split("\n").map((s) => s.trim()).filter(Boolean);
    await db.collection("recipes").doc(id).set({
      id, category: document.getElementById("nr-cat").value, nameEn: name, nameAr: "",
      image: "", prepTime: "", cookTime: "", yield: "", chefNotes: "", platingNotes: "",
      allergens: [], allergensSource: "none", archived: false, version: 1,
      components: [{ title: "Recipe", draft: true, ingredients, method }],
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: state.name,
    });
    wrap.innerHTML = "";
    renderAdmin();
  });
}

async function resolveRequest(reqId, status) {
  const req = state.requests.find((r) => r.id === reqId);
  if (!req) return;
  let adminNote = "";
  if (status === "rejected" || status === "clarification_requested") {
    adminNote = prompt(status === "rejected" ? "Reason for rejecting (optional):" : "What clarification do you need?") || "";
  }
  if (status === "approved") {
    const r = state.recipes.find((x) => x.id === req.recipeId);
    if (r) {
      const patch = buildPatchFromRequest(r, req);
      await applyRecipeChange(r, patch, `${req.fieldLabel || req.field} — requested by ${req.requestedBy}`, req.requestedBy, state.name);
    }
  }
  await db.collection("requests").doc(reqId).update({
    status, adminNote, resolvedBy: state.name, resolvedAt: firebase.firestore.FieldValue.serverTimestamp(),
  });
}

function buildPatchFromRequest(r, req) {
  if (req.field.startsWith("component:")) {
    const [, idx, sub] = req.field.split(":");
    const components = (r.components || []).map((c, i) => {
      if (i !== Number(idx)) return c;
      return { ...c, [sub]: req.newValue.split("\n").map((s) => s.trim()).filter(Boolean), draft: false };
    });
    return { components };
  }
  if (req.field === "allergens") {
    return { allergens: req.newValue.split(",").map((s) => s.trim()).filter(Boolean), allergensSource: "kitchen-confirmed" };
  }
  return { [req.field]: req.newValue };
}
