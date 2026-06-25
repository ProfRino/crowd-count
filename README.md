# Crowd Count

[![Latest release](https://img.shields.io/github/v/release/ProfRino/crowd-count?label=latest&color=blue)](https://github.com/ProfRino/crowd-count/releases/latest)
[![License: MIT](https://img.shields.io/github/license/ProfRino/crowd-count?label=License&color=yellow)](LICENSE)
[![Live demo](https://img.shields.io/badge/Live%20demo-profrino.github.io%2Fcrowd--count-1f5b96?logo=github&logoColor=white)](https://profrino.github.io/crowd-count/)

Crowd Count is a **browser-only crowd-size estimator**. Draw a polygon on a
real-world map or an uploaded indoor floor plan, pick a crowd density, and the
tool multiplies area by density and benchmarks the estimate against codified
safety thresholds (UK Purple Guide, Green Guide, NFPA 101, Still's upper safe
limit).

The whole tool runs **entirely in your web browser**. There is no
installation, no backend, no Python environment, and no build step.

![Demo](demo/demo.gif)

> **Project Lead:** Prof Rino Lovreglio, PhD — Massey University
>
> **Disclaimer:** No responsibility is taken for the use or output of this tool.
> All results are *Fermi-style* order-of-magnitude estimates and must be
> independently verified by a qualified safety professional before use in any
> design, planning, or regulatory context.

---

## Features

Pure client-side — no installation, no backend. The entire app builds to a
static `dist/` folder you can drop on GitHub Pages, Cloudflare Pages, Netlify
or any CDN.

* **Outdoor mode.** [MapLibre GL JS](https://maplibre.org) on top of
  [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles, with a free
  Esri satellite imagery toggle, an OSM Nominatim search box, and a live
  metric/imperial scale bar.
* **Indoor mode.** Upload any JPG/PNG floor plan, click two points, enter a
  known real-world distance, and the image becomes a calibrated drawing
  surface in true m² (or ft²).
* **Multi-zone management.** Name, colour, and a density slider per zone —
  with [Keith Still](https://www.gkstill.com)'s reference tick marks at 1, 2,
  4, 4.7, 5 ppl/m². Editing one zone does not reshuffle the others; sampled
  person positions are cached per zone.
* **Codified safety thresholds.** Per-zone pass / approaching / over-limit
  badge against any of:
  * **UK Purple Guide** — 2.0 ppl/m² planning ceiling for outdoor mixed-audience events
  * **UK Green Guide** (standing terrace) — 4.7 ppl/m²
  * **NFPA 101** standing assembly — 5 net sq ft per person = 2.15 ppl/m²
  * **Still upper safe limit** — 5.0 ppl/m²
* **Crowd visualisation.** Top-down head-on-shoulders person symbols rendered
  at real-world **0.6 m** scale via a jittered-grid sampler, with random
  rotation. Symbols stay at consistent geographic size as you zoom — Fitting
  in MapLibre's 512-tile pixel space is handled correctly.
* **Crush regime warning.** Densities above 5.0 ppl/m² trigger a red callout
  explaining that the linear area × density model is no longer a safe-headcount
  estimate but a crowd-dynamics question.
* **Metric / imperial toggle** for the scale bar, area display, and indoor
  calibration distance.
* **fflate-compressed permalink.** The full state — zones, densities, view,
  basemap, governing standard — encodes into the URL fragment so a single
  link reproduces a session exactly. No backend.
* **Polyline undo.** `Ctrl+Z` / `Cmd+Z` removes the last vertex while drawing.

## Try it live

> **👉 [Run it now in your browser — profrino.github.io/crowd-count](https://profrino.github.io/crowd-count/)**
>
> No installation, no local server, no account.

For a versioned snapshot, see the
[latest release](https://github.com/ProfRino/crowd-count/releases/latest).
All releases are listed on the
[Releases page](https://github.com/ProfRino/crowd-count/releases).

## Stack

[Vue 3](https://vuejs.org) + [Vite](https://vitejs.dev) +
[Tailwind CSS](https://tailwindcss.com) +
[MapLibre GL JS](https://maplibre.org) + [Turf.js](https://turfjs.org) +
[fflate](https://github.com/101arrowz/fflate).

## Develop

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # produces a static site in dist/
npm run preview    # serve dist/ at http://localhost:4173
```

The `dist/` folder is a self-contained static site that deploys cleanly to
GitHub Pages, Cloudflare Pages, Netlify, or any static host. A GitHub Actions
workflow at `.github/workflows/deploy.yml` redeploys to
[profrino.github.io/crowd-count](https://profrino.github.io/crowd-count/) on
every push to `main`.

## Inspired by

The area × density approach was popularised by
[MapChecking](https://github.com/paraboul/mapchecking) (Anthony Catel, MIT
licensed). This project rebuilds the idea from scratch with multi-zone
management, codified safety thresholds, indoor floor-plan support, and the
crowd-visualisation layer.

## Citation

If you reference this work, please cite:

> Lovreglio, R. *Crowd Count*. Massey University.
> https://github.com/ProfRino/crowd-count

A machine-readable [`CITATION.cff`](CITATION.cff) is included in this
repository — GitHub renders it as a "Cite this repository" button in the
sidebar.

## License

[MIT](LICENSE) — © 2026 Rino Lovreglio.
