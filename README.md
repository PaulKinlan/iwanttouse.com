# iwanttouse.com

Pick the web features you want to use and see, at a glance:

- their **Baseline** status — _Widely_, _Newly_, or _Limited_ availability;
- the **minimum browser versions** your selection requires; and
- the **share of users** who can use your site (across the major browser engines).

Share a selection by URL — the chosen features live in the hash, e.g.
`https://iwanttouse.com/#grid,has`. The `ondesktop.` and `onmobile.` subdomains
scope the audience to a single device class.

## Data

Two small files drive the app, generated from npm packages:

- `public/data/features.json` — Baseline status + BCD-derived minimum browser
  versions, from [`web-features`](https://github.com/web-platform-dx/web-features).
- `public/data/usage.json` — per-version usage share for the seven engines
  Baseline tracks, from [`caniuse-db`](https://github.com/Fyrd/caniuse).

The audience % is the share of users on a browser version new enough to support
**every** selected feature, normalized so an empty selection is 100%.

## Develop

```sh
npm install
npm run build      # regenerate public/data/*.json from the packages
npx serve public   # serve the static site
```

`npm start` runs the build then serves. To refresh the data, bump the package
versions (`npm update web-features caniuse-db`) and re-run `npm run build`.

## Deploy

Static site on Vercel. `vercel.json` sets `buildCommand: npm run build` and
`outputDirectory: public`, so the data files are regenerated on each deploy.
