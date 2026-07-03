// Regenerates the two data files the site reads at runtime, from the
// `web-features` (Baseline + BCD-derived min versions) and `caniuse-db`
// (per-version usage share) npm packages.
//
//   public/data/features.json  — feature catalog with Baseline status
//   public/data/usage.json     — usage share for the BCD-tracked engines
//
// Run with `npm run build`.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Engine } from "../public/js/audience.js";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "public", "data");

// BCD browser id -> caniuse agent key. These seven are the engines that
// web-features' support data tracks, so they define the audience universe.
const BCD_TO_CANIUSE = {
  chrome: "chrome",
  chrome_android: "and_chr",
  edge: "edge",
  firefox: "firefox",
  firefox_android: "and_ff",
  safari: "safari",
  safari_ios: "ios_saf",
};

function loadJSON(...candidates) {
  for (const id of candidates) {
    try {
      return JSON.parse(readFileSync(require.resolve(id), "utf8"));
    } catch {
      /* try next */
    }
  }
  throw new Error(`Could not resolve any of: ${candidates.join(", ")}`);
}

const webFeatures = loadJSON("web-features/data.json");
const caniuse = loadJSON("caniuse-db/data.json", "caniuse-db/fulldata-json/data-2.0.json");

// --- features.json -------------------------------------------------------
// Trim each feature to what the UI needs; drop the huge `by_compat_key`.
const features = {};
for (const [id, f] of Object.entries(webFeatures.features)) {
  const status = f.status ?? {};
  features[id] = {
    name: f.name,
    description: f.description ?? "",
    baseline: status.baseline ?? false, // "high" | "low" | false
    baselineLowDate: status.baseline_low_date ?? null,
    baselineHighDate: status.baseline_high_date ?? null,
    support: status.support ?? {}, // { bcdBrowser: "minVersion" }
    group: f.group ?? null,
    caniuse: f.caniuse ?? null,
  };
}

// --- usage.json ----------------------------------------------------------
// Only the seven mapped agents, only the usage share by version.
const usage = {};
for (const ci of Object.values(BCD_TO_CANIUSE)) {
  const agent = caniuse.agents[ci];
  if (!agent) {
    console.warn(`[warn] caniuse agent "${ci}" not found`);
    continue;
  }
  usage[ci] = {
    name: agent.browser,
    type: agent.type, // "desktop" | "mobile" | ...
    usage: agent.usage_global,
  };
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "features.json"), JSON.stringify(features));
writeFileSync(join(outDir, "usage.json"), JSON.stringify(usage));

const kb = (obj) => (Buffer.byteLength(JSON.stringify(obj)) / 1024).toFixed(0);
console.log(
  `Wrote ${Object.keys(features).length} features (${kb(features)} KB) and ` +
    `${Object.keys(usage).length} usage agents (${kb(usage)} KB) to public/data/`,
);

// --- prerender helpers --------------------------------------------------
const BASELINE_CLASS = { high: "widely", low: "newly", false: "limited", undefined: "limited" };
const baselineClassOf = (feature) => BASELINE_CLASS[String(feature?.baseline)] ?? "limited";

const escapeHtml = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

// Replaces the content between `<!--@name-->` and `<!--/@name-->` markers in
// index.html. Idempotent: the hand-authored template keeps the markers, and each
// build rewrites only the generated slice between them.
function injectSlice(html, name, slice) {
  const open = `<!--@${name}-->`;
  const close = `<!--/@${name}-->`;
  const re = new RegExp(`(${open.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})([\\s\\S]*?)(${close.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`);
  if (!re.test(html)) throw new Error(`prerender markers for "${name}" not found in index.html`);
  return html.replace(re, `$1${slice}$3`);
}

function prerenderIndex(root, features, usage) {
  const engine = new Engine(features, usage);
  const all = engine.allFeatures(); // [id, feature] sorted by name

  // Initial grid = nothing selected; each chip shows that feature's standalone
  // audience share. Mirrors app.js renderGrid() for the empty-selection state
  // (no checked inputs, no --chip tint; CSS falls back to the surface colour).
  const grid = all
    .map(([id, f]) => {
      const pct = engine.audienceShare([id], "all");
      const cls = baselineClassOf(f);
      const title = escapeHtml(f.description || f.name);
      return `<li>
        <input type="checkbox" id="f-${id}" data-feature="${id}">
        <label for="f-${id}" title="${title}">
          <span class="dot ${cls}"></span>
          <span class="name">${escapeHtml(f.name)}</span>
          <span class="pct">${pct.toFixed(0)}%</span>
        </label>
      </li>`;
    })
    .join("");

  const labels = { widely: "Widely available", newly: "Newly available", limited: "Limited availability" };
  const datalist = all
    .map(([id, f]) => {
      const pct = engine.audienceShare([id], "all");
      return `<option value="${escapeHtml(f.name)}">${pct.toFixed(0)}% · ${labels[baselineClassOf(f)]}</option>`;
    })
    .join("");

  const index = join(root, "public", "index.html");
  // index.html is a build artifact generated from the hand-authored
  // index.template.html (mirrors how public/data/ is generated + gitignored).
  const template = join(root, "public", "index.template.html");
  let html = readFileSync(template, "utf8");
  html = injectSlice(html, "prerender:features", grid);
  html = injectSlice(html, "prerender:datalist", datalist);
  writeFileSync(index, html);
  console.log(`Pre-rendered ${all.length} features into public/index.html (raw HTML now crawlable).`);
}

// --- index.html prerender ------------------------------------------------
// The feature grid and search datalist are rendered client-side from JSON, so a
// crawler that doesn't run JavaScript sees only a shell. Pre-render the initial
// (nothing-selected) grid + datalist into public/index.html between markers, so
// the feature names, Baseline status, and audience shares are present in the raw
// HTML that search and AI crawlers ingest. app.js replaces this on hydration.
prerenderIndex(root, features, usage);
