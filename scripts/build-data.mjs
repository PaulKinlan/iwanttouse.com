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
