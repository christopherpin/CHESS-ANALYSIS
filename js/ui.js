// iPod-style navigation: one stack of pages per tab, pages slide in from the right.
export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const ICONS = {
  history: '<path d="M15 2.5A12.5 12.5 0 1 0 27.5 15 12.5 12.5 0 0 0 15 2.5zm0 3A9.5 9.5 0 1 1 5.5 15 9.5 9.5 0 0 1 15 5.5zM13.6 8v8.2l6.6 4 1.4-2.3-5.1-3V8z" fill-rule="evenodd"/>',
  saved: '<path d="M6 2h18v26l-9-6-9 6z"/>',
  drills: '<path d="M11 3h8v3h-1.6l1.4 4.4a6.5 6.5 0 0 1-2.2 7.1l3.4 6.5H24v4H6v-4h4l3.4-6.5a6.5 6.5 0 0 1-2.2-7.1L12.6 6H11z"/>',
  puzzles: '<path d="M4 9h6a3 3 0 1 1 6 0h6v6a3 3 0 1 0 0 6v6h-6a3 3 0 1 0-6 0H4v-6a3 3 0 1 1 0-6z"/>',
};

export function createNav({ root, tabs, initial }) {
  root.innerHTML = `
  <svg width="0" height="0" style="position:absolute"><defs>
    <linearGradient id="gBlue" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fd8ff"/><stop offset=".5" stop-color="#29a6f7"/><stop offset=".5" stop-color="#1688e6"/><stop offset="1" stop-color="#0d6ed1"/></linearGradient>
    <linearGradient id="gGrey" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a8a8a8"/><stop offset="1" stop-color="#6b6b6b"/></linearGradient>
  </defs></svg>
  <header class="nav"><div class="nav-in"><div class="back hidden"><span></span></div><div class="title"></div><div class="navbtn hidden"></div></div></header>
  <main class="pages"></main>
  <nav class="tabs">${tabs.map(t => `<div class="tab" data-tab="${t.key}"><svg viewBox="0 0 30 30">${ICONS[t.icon || t.key]}</svg>${t.label}</div>`).join("")}</nav>`;
  const pagesEl = root.querySelector(".pages"), titleEl = root.querySelector(".title"), backEl = root.querySelector(".back"), btnEl = root.querySelector(".navbtn");
  const stacks = {};
  let cur = null;

  function makePage(spec) {
    const el = document.createElement("div");
    el.className = "page still right";
    pagesEl.appendChild(el);
    const page = { ...spec, el };
    spec.render(el, page);
    return page;
  }
  function chrome() {
    const st = stacks[cur], top = st[st.length - 1], prev = st[st.length - 2];
    titleEl.textContent = top.title;
    backEl.classList.toggle("hidden", !prev);
    if (prev) backEl.firstChild.textContent = prev.short || prev.title;
    btnEl.classList.toggle("hidden", !top.right);
    if (top.right) { btnEl.textContent = top.right.label; btnEl.onclick = top.right.onClick; }
  }
  function place(page, cls, animate) {
    page.el.classList.toggle("still", !animate);
    page.el.classList.remove("left", "right");
    if (cls) page.el.classList.add(cls);
  }

  const api = {
    push(spec) {
      const st = stacks[cur], from = st[st.length - 1];
      const page = makePage(spec);
      st.push(page);
      void page.el.offsetWidth;
      place(page, null, true); place(from, "left", true);
      chrome();
      return page;
    },
    pop() {
      const st = stacks[cur];
      if (st.length < 2) return;
      const gone = st.pop(), to = st[st.length - 1];
      place(gone, "right", true); place(to, null, true);
      gone.onClose?.();
      setTimeout(() => gone.el.remove(), 400);
      to.onShow?.();
      chrome();
    },
    popToRoot() { while (stacks[cur].length > 1) api.pop(); },
    setTab(key) {
      if (cur && cur !== key) for (const p of stacks[cur]) place(p, "right", false);
      cur = key;
      root.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.tab === key));
      if (!stacks[key]) { const t = tabs.find(t => t.key === key); stacks[key] = [makePage(t.root)]; }
      const st = stacks[key];
      st.forEach((p, i) => place(p, i === st.length - 1 ? null : "left", false));
      st[st.length - 1].onShow?.();
      chrome();
      try { localStorage.setItem("chesstrainer.tab", JSON.stringify(key)); } catch {}
    },
    get tab() { return cur; },
    top() { const st = stacks[cur]; return st[st.length - 1]; },
    refreshChrome: chrome,
  };
  backEl.onclick = () => api.pop();
  root.querySelector(".tabs").onclick = e => {
    const t = e.target.closest(".tab"); if (!t) return;
    if (t.dataset.tab === cur) api.popToRoot(); else api.setTab(t.dataset.tab);
  };
  api.setTab(initial || tabs[0].key);
  return api;
}

export function toast(text, ms = 2200) {
  const d = document.createElement("div");
  d.className = "toast"; d.textContent = text;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), ms);
}

/** a list row; returns html. opts: { title, sub, val, go, badge, attrs } */
export function row({ title, sub, val, go = true, badge, attrs = "", cls = "" }) {
  return `<div class="row ${go ? "go" : ""} ${cls}" ${attrs}>${badge || ""}<div class="main"><b>${esc(title)}</b>${sub ? `<i>${esc(sub)}</i>` : ""}</div>${val != null ? `<span class="val">${esc(val)}</span>` : ""}</div>`;
}
export const sec = t => `<div class="sec">${esc(t)}</div>`;
