// Audience + Baseline engine.
//
// Feature catalog and Baseline status come from `web-features` (which also
// carries the BCD-derived minimum browser versions). Usage share comes from
// caniuse. The audience % for a set of features is the share of users — across
// the seven BCD-tracked engines — on a browser version new enough to support
// every selected feature, normalized so "nothing selected" == 100%.

// BCD browser id -> caniuse agent key.
const BCD_TO_CANIUSE = {
  chrome: "chrome",
  chrome_android: "and_chr",
  edge: "edge",
  firefox: "firefox",
  firefox_android: "and_ff",
  safari: "safari",
  safari_ios: "ios_saf",
};

// Baseline ordering, worst to best.
const BASELINE_RANK = { false: 0, low: 1, high: 2 };

const parseVer = (v) => {
  if (v == null) return NaN;
  // caniuse versions can be ranges ("9.0-9.2"), "TP", "all"; take the first number.
  return Number.parseFloat(String(v));
};

export async function loadData() {
  const [features, usage] = await Promise.all([
    fetch("data/features.json").then((r) => r.json()),
    fetch("data/usage.json").then((r) => r.json()),
  ]);
  return new Engine(features, usage);
}

export class Engine {
  constructor(features, usage) {
    this.features = features;
    this.usage = usage;

    this._agents = Object.entries(BCD_TO_CANIUSE)
      .filter(([, ci]) => usage[ci])
      .map(([bcd, ci]) => ({ bcd, ci, type: usage[ci].type }));

    // Per agent, numeric versions ascending with a suffix sum of usage share,
    // so "share at versions >= min" is one binary search rather than a scan.
    this._suffix = {};
    for (const a of this._agents) {
      const entries = Object.entries(usage[a.ci].usage)
        .map(([v, s]) => [parseVer(v), s || 0])
        .filter(([v]) => !Number.isNaN(v))
        .sort((x, y) => x[0] - y[0]);
      let acc = 0;
      const arr = new Array(entries.length);
      for (let i = entries.length - 1; i >= 0; i--) {
        acc += entries[i][1];
        arr[i] = { v: entries[i][0], suffix: acc };
      }
      this._suffix[a.ci] = arr;
    }

    // Denominator per device universe = total numeric usage, so an empty
    // selection scores exactly 100%.
    this._denominator = {};
    for (const device of ["all", "desktop", "mobile"]) {
      this._denominator[device] = this._agentsFor(device).reduce(
        (sum, a) => sum + (this._suffix[a.ci][0]?.suffix ?? 0),
        0,
      );
    }
  }

  _agentsFor(device) {
    if (device === "all") return this._agents;
    return this._agents.filter((a) => a.type === device);
  }

  // Usage of one agent at versions >= the required minimum (Infinity => 0).
  _agentShareFrom(ci, minVersion) {
    if (minVersion === Infinity) return 0;
    const arr = this._suffix[ci];
    if (arr.length === 0) return 0;
    if (minVersion <= arr[0].v) return arr[0].suffix;
    // First index whose version >= minVersion.
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid].v < minVersion) lo = mid + 1;
      else hi = mid;
    }
    return lo < arr.length ? arr[lo].suffix : 0;
  }

  getFeature(id) {
    return this.features[id];
  }

  // All features as [id, feature] pairs, sorted by name.
  allFeatures() {
    return Object.entries(this.features).sort((a, b) =>
      a[1].name.localeCompare(b[1].name),
    );
  }

  // Per-BCD-browser minimum version required to support every feature.
  // A browser a feature doesn't support becomes Infinity (unreachable).
  requiredVersions(featureIds) {
    const req = {};
    for (const bcd of Object.keys(BCD_TO_CANIUSE)) req[bcd] = 0;
    for (const id of featureIds) {
      const support = this.features[id]?.support ?? {};
      for (const bcd of Object.keys(BCD_TO_CANIUSE)) {
        if (req[bcd] === Infinity) continue;
        const min = support[bcd];
        req[bcd] = min === undefined ? Infinity : Math.max(req[bcd], parseVer(min));
      }
    }
    return req;
  }

  // Normalized audience share (0-100) for the given device universe.
  audienceShare(featureIds, device = "all") {
    const denom = this._denominator[device];
    if (!denom) return 0;
    const req = this.requiredVersions(featureIds);
    let num = 0;
    for (const a of this._agentsFor(device)) {
      num += this._agentShareFrom(a.ci, req[a.bcd]);
    }
    return (num / denom) * 100;
  }

  // Rows for the per-browser support table.
  perBrowserShare(featureIds, device = "all") {
    const req = this.requiredVersions(featureIds);
    const denomAll = this._denominator.all;
    return this._agentsFor(device)
      .map((a) => ({
        name: this.usage[a.ci].name,
        type: a.type,
        since: req[a.bcd] === Infinity ? null : req[a.bcd],
        share: (this._agentShareFrom(a.ci, req[a.bcd]) / denomAll) * 100,
      }))
      .sort((x, y) => y.share - x.share);
  }

  // Desktop vs mobile contribution to the overall audience (sums to the total).
  deviceSplit(featureIds) {
    const denomAll = this._denominator.all;
    const req = this.requiredVersions(featureIds);
    return ["desktop", "mobile"].map((device) => {
      let num = 0;
      for (const a of this._agentsFor(device)) num += this._agentShareFrom(a.ci, req[a.bcd]);
      return { name: device, share: (num / denomAll) * 100 };
    });
  }

  // Worst-case Baseline status of the whole selection.
  // Returns { status: "widely"|"newly"|"limited"|"none", date, gatingId }.
  combinedBaseline(featureIds) {
    if (featureIds.length === 0) return { status: "none", date: null, gatingId: null };

    let worst = "high";
    for (const id of featureIds) {
      const b = String(this.features[id]?.baseline);
      if (BASELINE_RANK[b] < BASELINE_RANK[worst]) worst = b;
    }

    if (worst === "false" || worst === "undefined") {
      const gatingId = featureIds.find(
        (id) => BASELINE_RANK[String(this.features[id]?.baseline)] === 0,
      );
      return { status: "limited", date: null, gatingId: gatingId ?? featureIds[0] };
    }

    // For "newly"/"widely" the set arrives at that status when its *last*
    // feature does, so surface the max date and the feature that owns it.
    const dateKey = worst === "high" ? "baselineHighDate" : "baselineLowDate";
    let gatingId = featureIds[0];
    let date = null;
    for (const id of featureIds) {
      const d = this.features[id]?.[dateKey];
      if (d && (!date || d > date)) {
        date = d;
        gatingId = id;
      }
    }
    return { status: worst === "high" ? "widely" : "newly", date, gatingId };
  }

  // Features whose support is already covered by the current selection, so
  // adding them wouldn't reduce the audience.
  freeFeatures(featureIds) {
    const selected = new Set(featureIds);
    const req = this.requiredVersions(featureIds);
    const finite = Object.entries(req).filter(([, v]) => v !== Infinity);
    if (finite.length === 0 || finite.every(([, v]) => v === 0)) return [];

    const out = [];
    for (const [id, feature] of Object.entries(this.features)) {
      if (selected.has(id)) continue;
      const covered = finite.every(([bcd, reqVer]) => {
        const min = feature.support[bcd];
        return min !== undefined && parseVer(min) <= reqVer;
      });
      if (covered) out.push([id, feature]);
    }
    return out.sort((a, b) => a[1].name.localeCompare(b[1].name));
  }
}
