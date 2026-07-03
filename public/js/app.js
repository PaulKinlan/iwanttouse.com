import { loadData } from "./audience.js";

const $ = (id) => document.getElementById(id);

// onmobile.* / ondesktop.* subdomains scope the audience to one device class.
const host = location.host;
const deviceType = host.startsWith("onmobile") ? "mobile" : host.startsWith("ondesktop") ? "desktop" : "all";

const BASELINE_CLASS = { high: "widely", low: "newly", false: "limited", undefined: "limited" };
const BASELINE_LABEL = { widely: "Widely available", newly: "Newly available", limited: "Limited availability" };

const baselineClassOf = (feature) => BASELINE_CLASS[String(feature?.baseline)] ?? "limited";
// 0% -> red, 100% -> green.
const hueFor = (pct) => Math.max(0, Math.min(120, pct * 1.2));
const fmtDate = (iso) => (iso ? new Date(iso).getFullYear() : "");

let engine;
let activeFilter = "all";

function selectedIds() {
  const raw = decodeURIComponent(location.hash.slice(1)).trim();
  if (!raw) return [];
  return raw.split(",").filter((id) => engine.getFeature(id));
}

function setSelected(ids) {
  const unique = [...new Set(ids)].filter((id) => engine.getFeature(id));
  location.hash = unique.join(",");
}

// --- Renderers ---------------------------------------------------------- //

function renderHeadline(ids) {
  const pct = engine.audienceShare(ids, deviceType);
  const share = $("share");
  share.textContent = pct.toFixed(2);
  // Dark colour on the light surface, light colour on the dark surface, so the
  // large figure clears 3:1 contrast in both themes (light-dark() resolves via
  // the page's color-scheme declaration).
  share.style.color = `light-dark(hsl(${hueFor(pct)} 65% 35%), hsl(${hueFor(pct)} 70% 60%))`;
  $("unusableShare").textContent = (100 - pct).toFixed(2);

  const chip = $("baselineChip");
  const { status, date, gatingId } = engine.combinedBaseline(ids);
  chip.className = `baseline baseline-big ${status === "none" ? "none" : status}`;
  if (status === "none") {
    chip.textContent = "Baseline: pick a feature";
  } else {
    const label = BASELINE_LABEL[status];
    const since = date ? ` since ${fmtDate(date)}` : "";
    const gate = gatingId ? ` · gated by ${engine.getFeature(gatingId).name}` : "";
    chip.innerHTML = `${label}<span class="date">${since}${gate}</span>`;
  }
}

function renderUsed(ids) {
  const ul = $("usedFeatures");
  if (ids.length === 0) {
    ul.innerHTML = `<li class="muted">Nothing special yet — add a feature above.</li>`;
    return;
  }
  ul.innerHTML = ids
    .map((id) => {
      const f = engine.getFeature(id);
      const cls = baselineClassOf(f);
      return `<li><button class="chip" data-remove="${id}" title="Remove">
        <span class="dot ${cls}" style="width:.6em;height:.6em;border-radius:50%;display:inline-block"></span>${escapeHtml(f.name)}</button></li>`;
    })
    .join("");
}

function renderDeviceSplit(ids) {
  const rows = engine.deviceSplit(ids);
  $("deviceSplit").innerHTML = table(
    ["device", "share"],
    rows,
    (col, row) => {
      if (col === "device") {
        const url = `https://on${row.name}.iwanttouse.com/${location.hash}`;
        return `<a href="${url}">${row.name}</a>`;
      }
      return `${row.share.toFixed(2)}%`;
    },
    (col) => col === "share",
  );
}

function renderBrowserShare(ids) {
  const rows = engine.perBrowserShare(ids, deviceType);
  $("browserShare").innerHTML = table(
    ["browser", "min version", "share"],
    rows,
    (col, row) => {
      if (col === "browser") return escapeHtml(row.name);
      if (col === "min version") return row.since === null ? "—" : row.since;
      return `${row.share.toFixed(2)}%`;
    },
    (col) => col === "share" || col === "min version",
  );
}

function renderFree(ids) {
  const free = engine.freeFeatures(ids);
  const list = $("freeList");
  if (ids.length === 0) {
    list.innerHTML = `<li class="muted">Select some features to see what comes for free.</li>`;
    return;
  }
  if (free.length === 0) {
    list.innerHTML = `<li class="muted">Nothing extra is universally covered by this selection.</li>`;
    return;
  }
  list.innerHTML = free
    .map(
      ([, f]) =>
        `<li><span class="dot ${baselineClassOf(f)}" style="width:.6em;height:.6em;border-radius:50%;flex:none;background:var(--baseline-${baselineClassOf(f)})"></span>${escapeHtml(f.name)}</li>`,
    )
    .join("");
}

function renderGrid(ids) {
  const selected = new Set(ids);
  const html = engine
    .allFeatures()
    .filter(([, f]) => activeFilter === "all" || baselineClassOf(f) === activeFilter)
    .map(([id, f]) => {
      const pct = engine.audienceShare([...ids, id], deviceType);
      const cls = baselineClassOf(f);
      const checked = selected.has(id) ? " checked" : "";
      const tint = `hsl(${hueFor(pct)} 75% 55% / 0.14)`;
      return `<li>
        <input type="checkbox" id="f-${id}" data-feature="${id}"${checked}>
        <label for="f-${id}" style="--chip:${tint}" title="${escapeHtml(f.description || f.name)}">
          <span class="dot ${cls}"></span>
          <span class="name">${escapeHtml(f.name)}</span>
          <span class="pct">${pct.toFixed(0)}%</span>
        </label>
      </li>`;
    })
    .join("");
  $("features").innerHTML = html;
}

function renderDatalist(ids) {
  const html = engine
    .allFeatures()
    .filter(([id]) => !ids.includes(id))
    .map(([id, f]) => {
      const pct = engine.audienceShare([...ids, id], deviceType);
      return `<option value="${escapeHtml(f.name)}">${pct.toFixed(0)}% · ${BASELINE_LABEL[baselineClassOf(f)]}</option>`;
    })
    .join("");
  $("featureList").innerHTML = html;
}

// --- Helpers ------------------------------------------------------------ //

function table(columns, rows, cell, isNum) {
  const head = columns.map((c) => `<th class="${isNum(c) ? "num" : ""}">${c}</th>`).join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${columns.map((c) => `<td class="${isNum(c) ? "num" : ""}">${cell(c, row)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

// Build a lookup from feature name to id for the search box.
let nameToId;
function nameLookup(value) {
  const v = value.trim();
  if (engine.getFeature(v)) return v; // exact id
  return nameToId.get(v.toLowerCase()) ?? null;
}

// --- Wiring ------------------------------------------------------------- //

function render() {
  const ids = selectedIds();
  renderHeadline(ids);
  renderUsed(ids);
  renderDeviceSplit(ids);
  renderBrowserShare(ids);
  renderFree(ids);
  renderGrid(ids);
  renderDatalist(ids);
}

function init() {
  if (deviceType !== "all") {
    $("usertype").textContent = deviceType;
    $("usertype2").textContent = deviceType;
  }

  nameToId = new Map(engine.allFeatures().map(([id, f]) => [f.name.toLowerCase(), id]));

  // Toggle a feature from the grid.
  $("features").addEventListener("change", (e) => {
    const id = e.target.dataset?.feature;
    if (!id) return;
    const ids = selectedIds();
    setSelected(e.target.checked ? [...ids, id] : ids.filter((x) => x !== id));
  });

  // Remove a used-feature chip.
  $("usedFeatures").addEventListener("click", (e) => {
    const id = e.target.closest("[data-remove]")?.dataset.remove;
    if (!id) return;
    setSelected(selectedIds().filter((x) => x !== id));
  });

  // Add via the search box.
  $("search").addEventListener("change", (e) => {
    const id = nameLookup(e.target.value);
    if (id) setSelected([...selectedIds(), id]);
    e.target.value = "";
  });

  // Baseline filter buttons.
  $("filters").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-filter]");
    if (!btn) return;
    activeFilter = btn.dataset.filter;
    for (const b of $("filters").querySelectorAll("button")) {
      b.setAttribute("aria-pressed", String(b === btn));
    }
    renderGrid(selectedIds());
  });

  window.addEventListener("hashchange", render);
  render();
}

loadData()
  .then((e) => {
    engine = e;
    init();
  })
  .catch((err) => {
    console.error(err);
    document.querySelector(".hero").innerHTML = `<p class="muted">Couldn't load feature data.</p>`;
  });
