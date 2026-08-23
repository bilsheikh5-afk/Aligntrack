const STATUS_META = {
  awaiting_scan: { label: "Awaiting Scan", color: "var(--amber)" },
  in_review: { label: "In Review", color: "var(--orange)" },
  in_production: { label: "In Production", color: "var(--mint)" },
  shipped: { label: "Shipped", color: "var(--blue)" },
  delivered: { label: "Delivered", color: "var(--green)" },
};

let state = {
  cases: [],
  query: "",
  statusFilter: "all",
  selectedId: null,
  geminiConfigured: true,
  user: null,
  authMode: "login", // "login" | "register"
  authError: "",
};

const app = document.getElementById("app");

async function init() {
  const health = await fetch("/api/health").then((r) => r.json()).catch(() => ({ geminiConfigured: false }));
  state.geminiConfigured = health.geminiConfigured;

  const meRes = await fetch("/api/auth/me");
  if (meRes.ok) {
    const data = await meRes.json();
    state.user = data.user;
    await loadCases();
  }
  render();
}

async function loadCases() {
  const res = await fetch("/api/cases");
  if (res.status === 401) {
    state.user = null;
    return;
  }
  state.cases = await res.json();
}

function renderAuthScreen() {
  const isLogin = state.authMode === "login";
  app.innerHTML = `
    <div style="display:flex;justify-content:center;margin:12px 0 20px">
      <img src="/assets/logo.png" alt="ClearPro" style="height:56px;width:auto" />
    </div>
    <div class="title" style="text-align:center">${isLogin ? "Sign in" : "Create account"}</div>
    <div class="subtitle" style="margin-bottom:16px;text-align:center">${isLogin ? "Dentist and admin access" : "Requires an invite code from your lab admin"}</div>

    ${state.authError ? `<div class="banner">${state.authError}</div>` : ""}

    <form id="authForm">
      ${!isLogin ? `<input class="search" id="nameInput" placeholder="Full name" />` : ""}
      <input class="search" id="emailInput" type="email" placeholder="Email" required />
      <input class="search" id="passwordInput" type="password" placeholder="Password" required />
      ${!isLogin ? `<input class="search" id="inviteInput" placeholder="Invite code" required />` : ""}
      <button type="submit" class="primary block">${isLogin ? "Sign in" : "Create account"}</button>
    </form>

    <button class="secondary block" id="toggleAuthMode">
      ${isLogin ? "Need an account? Register with invite code" : "Already have an account? Sign in"}
    </button>
  `;

  document.getElementById("authForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    state.authError = "";
    const email = document.getElementById("emailInput").value;
    const password = document.getElementById("passwordInput").value;
    const payload = { email, password };
    let url = "/api/auth/login";
    if (!isLogin) {
      url = "/api/auth/register";
      payload.name = document.getElementById("nameInput").value;
      payload.inviteCode = document.getElementById("inviteInput").value;
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Something went wrong");
      state.user = data.user;
      await loadCases();
      render();
    } catch (err) {
      state.authError = err.message;
      render();
    }
  });

  document.getElementById("toggleAuthMode").addEventListener("click", () => {
    state.authMode = isLogin ? "register" : "login";
    state.authError = "";
    render();
  });
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  state.user = null;
  state.cases = [];
  render();
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 1) return "just now";
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function filteredCases() {
  return state.cases.filter((c) => {
    const q = state.query.toLowerCase();
    const matchesQuery = c.patient.toLowerCase().includes(q) || c.id.toLowerCase().includes(q);
    const matchesStatus = state.statusFilter === "all" || c.status === state.statusFilter;
    return matchesQuery && matchesStatus;
  });
}

function counts() {
  const c = { all: state.cases.length };
  Object.keys(STATUS_META).forEach((k) => (c[k] = state.cases.filter((x) => x.status === k).length));
  return c;
}

function render() {
  if (!state.user) return renderAuthScreen();

  const cs = counts();
  const flaggedCount = state.cases.filter((c) => c.flagged).length;
  const list = filteredCases();

  app.innerHTML = `
    ${!state.geminiConfigured ? `<div class="banner">GEMINI_API_KEY not set — AI features are disabled. Add it in your Render environment variables.</div>` : ""}
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;align-items:center;gap:10px">
        <img src="/assets/logo.png" alt="ClearPro" style="height:32px;width:auto" />
        <div>
          <div class="title" style="margin:0">Case Dashboard</div>
          <div class="subtitle">${state.cases.length} active cases · ${flaggedCount} need attention</div>
        </div>
      </div>
      <button class="secondary" id="logoutBtn" style="font-size:11px;padding:6px 10px;flex-shrink:0">${state.user.email} · Sign out</button>
    </div>

    <input class="search" id="searchInput" placeholder="Search patient or case ID…" value="${state.query}" />

    <div class="chips" id="chips">
      <button class="chip ${state.statusFilter === "all" ? "active" : ""}" data-status="all" style="${state.statusFilter === "all" ? "background:var(--text-muted)" : ""}">All (${cs.all})</button>
      ${Object.entries(STATUS_META).map(([key, meta]) => `
        <button class="chip ${state.statusFilter === key ? "active" : ""}" data-status="${key}" style="${state.statusFilter === key ? `background:${meta.color}` : ""}">${meta.label} (${cs[key]})</button>
      `).join("")}
    </div>

    <div class="case-list">
      ${list.length === 0 ? `<div class="empty">No cases match "${state.query}"</div>` : ""}
      ${list.map(caseRowHtml).join("")}
    </div>

    ${state.selectedId ? detailSheetHtml(state.cases.find((c) => c.id === state.selectedId)) : ""}
  `;

  attachEvents();
}

function caseRowHtml(c) {
  const meta = STATUS_META[c.status];
  return `
    <div class="case-row ${c.flagged ? "flagged" : ""}" data-id="${c.id}">
      <div class="dot" style="background:${meta.color}"></div>
      <div class="case-main">
        <div class="case-name">${c.patient} ${c.flagged ? '<span style="color:var(--orange);font-size:11px">⚠</span>' : ""}</div>
        <div class="case-sub">${c.id} · ${c.type}</div>
      </div>
      <div class="case-status-col">
        <div class="case-status-label" style="color:${meta.color}">${meta.label}</div>
        <div class="case-time">${timeAgo(c.updated)}</div>
      </div>
    </div>
  `;
}

function detailSheetHtml(c) {
  const meta = STATUS_META[c.status];
  const lastNote = c.notes && c.notes.length ? c.notes[c.notes.length - 1] : null;
  const lastPhoto = c.photos && c.photos.length ? c.photos[c.photos.length - 1] : null;

  return `
    <div class="overlay" id="overlay">
      <div class="sheet" id="sheet">
        <div class="eyebrow">${c.id}</div>
        <div class="title" style="margin-bottom:10px">${c.patient}</div>

        <div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">${c.type}</span></div>
        <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value" style="color:${meta.color}">${meta.label}</span></div>
        <div class="detail-row"><span class="detail-label">Aligner stage</span><span class="detail-value">${c.stage}</span></div>
        <div class="detail-row"><span class="detail-label">Avg wear/day</span><span class="detail-value">${c.wearHoursAvg ? c.wearHoursAvg + "h" : "not tracked"}</span></div>
        <div class="detail-row"><span class="detail-label">Lab</span><span class="detail-value">${c.lab}</span></div>
        <div class="detail-row"><span class="detail-label">Last updated</span><span class="detail-value">${timeAgo(c.updated)}</span></div>

        <div class="ai-panel">
          <div class="ai-panel-title">✦ Gemini Coaching Note</div>
          <div id="coachingNoteArea">
            ${lastNote ? `<div class="ai-text">${lastNote.text}</div>` : `<div class="ai-empty">Generate a note based on this case's real wear pattern.</div>`}
          </div>
          <button class="primary" id="genNoteBtn" ${!state.geminiConfigured ? "disabled" : ""}>Generate coaching note</button>
        </div>

        <div class="ai-panel">
          <div class="ai-panel-title">✦ Gemini Photo Analysis</div>
          <div id="photoAnalysisArea">
            ${lastPhoto ? `<div class="ai-text">${lastPhoto.analysis}</div>` : `<div class="ai-empty">Upload a fit-check photo for AI review.</div>`}
          </div>
          <label class="file-label" for="photoInput">📷 Choose fit-check photo</label>
          <input type="file" id="photoInput" accept="image/*" style="display:none" ${!state.geminiConfigured ? "disabled" : ""} />
        </div>

        <button class="secondary block" id="closeBtn">Close</button>
      </div>
    </div>
  `;
}

function attachEvents() {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", logout);

  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.query = e.target.value;
      render();
      document.getElementById("searchInput").focus();
      const val = document.getElementById("searchInput");
      val.selectionStart = val.selectionEnd = val.value.length;
    });
  }

  document.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      state.statusFilter = chip.dataset.status;
      render();
    });
  });

  document.querySelectorAll(".case-row").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedId = row.dataset.id;
      render();
    });
  });

  const overlay = document.getElementById("overlay");
  if (overlay) {
    overlay.addEventListener("click", (e) => {
      if (e.target.id === "overlay") {
        state.selectedId = null;
        render();
      }
    });
  }
  const closeBtn = document.getElementById("closeBtn");
  if (closeBtn) closeBtn.addEventListener("click", () => { state.selectedId = null; render(); });

  const genNoteBtn = document.getElementById("genNoteBtn");
  if (genNoteBtn) {
    genNoteBtn.addEventListener("click", async () => {
      genNoteBtn.disabled = true;
      genNoteBtn.textContent = "Thinking…";
      const area = document.getElementById("coachingNoteArea");
      try {
        const res = await fetch(`/api/cases/${state.selectedId}/ai-coaching-note`, { method: "POST" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Request failed");
        area.innerHTML = `<div class="ai-text">${data.note}</div>`;
        const c = state.cases.find((x) => x.id === state.selectedId);
        c.notes.push({ text: data.note });
      } catch (err) {
        area.innerHTML = `<div class="ai-empty" style="color:var(--orange)">${err.message}</div>`;
      } finally {
        genNoteBtn.disabled = false;
        genNoteBtn.textContent = "Regenerate note";
      }
    });
  }

  const photoInput = document.getElementById("photoInput");
  if (photoInput) {
    photoInput.addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const area = document.getElementById("photoAnalysisArea");
      area.innerHTML = `<div class="ai-empty">Analyzing photo…</div>`;
      const formData = new FormData();
      formData.append("photo", file);
      try {
        const res = await fetch(`/api/cases/${state.selectedId}/ai-photo-analysis`, { method: "POST", body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Request failed");
        area.innerHTML = `<div class="ai-text">${data.analysis}</div>`;
      } catch (err) {
        area.innerHTML = `<div class="ai-empty" style="color:var(--orange)">${err.message}</div>`;
      }
    });
  }
}

init();
