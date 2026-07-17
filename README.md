# Crowd Count (version 2)

[![Latest release](https://img.shields.io/github/v/release/ProfRino/crowd-count?label=latest&color=blue)](https://github.com/ProfRino/crowd-count/releases/latest)
[![License: MIT](https://img.shields.io/github/license/ProfRino/crowd-count?label=License&color=yellow)](LICENSE)
[![Live demo](https://img.shields.io/badge/Live%20demo-profrino.github.io%2Fcrowd--count-1f5b96?logo=github&logoColor=white)](https://profrino.github.io/crowd-count/)

Crowd Count is a **browser-only crowd-size estimator**. Draw a polygon on a
real-world map or an uploaded indoor floor plan, pick a crowd density —
uniform or a linear gradient — and the tool multiplies area by density and
benchmarks the estimate against codified safety thresholds (UK Purple Guide,
Green Guide, NFPA 101, Still's upper safe limit). Version 2.0 adds a full 3D
site view with instanced crowds, optional Google Photorealistic 3D Tiles, and
animated 3D density references.

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

## Project team

<a href="https://github.com/yingying930902">
  <img src="https://github.com/yingying930902.png?size=90"
       width="90"
       alt="Yingying">
</a>

**[Yingying](https://github.com/yingying930902)**  
Project collaborator

## Features

Pure client-side — no installation, no backend. The entire app builds to a
static `dist/` folder you can drop on GitHub Pages, Cloudflare Pages, Netlify
or any CDN.

* **Outdoor mode.** [MapLibre GL JS](https://maplibre.org) on top of
  [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles, with a free
  Esri satellite imagery toggle, optional Google roadmap and satellite
  basemaps (bring your own API key), an OSM Nominatim search box, and a live
  metric/imperial scale bar.
* **Indoor mode.** Upload any JPG/PNG floor plan, click two points, enter a
  known real-world distance, and the image becomes a calibrated drawing
  surface in true m² (or ft²).
* **Density gradients.** Each zone can be uniform or a piecewise-linear
  gradient through any number of distance/density points along a draggable
  direction. Totals use exact integration over the real zone geometry
  (minus obstructions); safety warnings use the peak density.
* **Multi-zone management.** Name, colour, and a density slider per zone. Editing one zone does not reshuffle
  the others; sampled person positions are cached per zone.
* **Crowd appearance.** Neutral, by-zone, or natural-mix people colours with
  separate head, torso and leg tones; random orientation or **Aim crowd** to
  face everyone in a zone towards a draggable point.
* **Codified safety thresholds.** Per-zone pass / approaching / over-limit
  badge against any of:
  * **UK Purple Guide** — 2.0 ppl/m² planning ceiling for outdoor mixed-audience events
  * **UK Green Guide** (standing terrace) — 4.7 ppl/m²
  * **NFPA 101** standing assembly — 5 net sq ft per person = 2.15 ppl/m²
  * **Still upper safe limit** — 5.0 ppl/m²
* **Full 3D site view.** Switch the whole site into 3D: instanced crowd
  rendering built for very large crowds, 3D zones and obstructions,
  synchronized 2D/3D switching, orbit/pan/zoom mouse controls, WASD keyboard
  navigation, grayscale and colour display modes, and looping cinematic
  camera moves (Orbit, Flyover, Sweep, Push, Drone, Skim). Press `H` for a
  crowd wave.
* **Google Photorealistic 3D Tiles.** Optional photorealistic terrain and
  buildings in the 3D view via the Google Maps Platform, with terrain-height
  sampling so the crowd stands on the real ground. The API key is stored only
  in the browser's localStorage — never in project files or share links.
* **Crowd visualisation.** Top-down head-on-shoulders person symbols rendered
  at real-world scale via a jittered-grid sampler — now up to **200,000
  rendered people per zone**, with improved sampling for circles, concave
  polygons, and polygons with holes. Symbols stay at consistent geographic
  size as you zoom.
* **3D density reference.** Side-by-side 3 m × 3 m reference patches for 1–6
  people/m², as procedurally generated mannequins or animated crowd models
  (streamed from this project's GitHub release).
* **Ruler.** Multi-point measuring with confirmed distance, live preview to
  the cursor, projected total, and explicit Done / Clear actions.
* **Metric / imperial toggle** for the scale bar, area display, and indoor
  calibration distance.
* **Save / Open and fflate-compressed permalink.** The full state — zones,
  densities, gradients, crowd appearance, aim points, view, basemap,
  governing standard — saves to a local project file or encodes into the URL
  fragment so a single link reproduces a session exactly. Older project files
  and share links keep working. No backend.
* **Polyline undo.** `Ctrl+Z` / `Cmd+Z` removes the last vertex while drawing.

## How to use it

You have **two equally simple ways** to run the app — both with no
installation, no account, and no server.

### Option 1 — Online

> **[Open it in your browser — profrino.github.io/crowd-count](https://profrino.github.io/crowd-count/)**

Just open the link in Chrome, Edge, Firefox, or Safari and start drawing.
That's it.

### Option 2 — Offline, on your own computer

Download **[crowd-count.html](https://github.com/ProfRino/crowd-count/releases/latest/download/crowd-count.html)**
— one single file, about 2.5 MB — from the
[Releases page](https://github.com/ProfRino/crowd-count/releases). Save it
anywhere on your computer, then **double-click it**. The app opens straight
in your default browser, no server, no install. You can email it to a
colleague, put it on a USB stick, or keep it on an air-gapped laptop.

An internet connection is needed for the map tiles (street map, satellite
background, 3D basemaps), the place-search box, the optional Google
features, and the animated 3D density references (large models streamed
from the Crowd Count website) — everything else (drawing, density, person
rendering, indoor floor plans, save/open, sharing via permalink) works
fully offline.

## Tutorial

A short walk-through showing how to draw zones, set densities, and read the
estimate:

[![Watch the tutorial](https://img.youtube.com/vi/x5br6jshsyM/hqdefault.jpg)](https://youtu.be/x5br6jshsyM)

> **[Watch on YouTube — youtu.be/x5br6jshsyM](https://youtu.be/x5br6jshsyM)**

## For developers

If you want to fork the code, audit it, run a local copy, or contribute
changes:

* **Clone and run the dev server:**
  ```sh
  git clone https://github.com/ProfRino/crowd-count.git
  cd crowd-count
  npm install
  npm run dev        # http://localhost:5173
  ```
* **Build a production bundle:** `npm run build` produces a static site in
  `dist/` that deploys cleanly to GitHub Pages, Cloudflare Pages, Netlify or
  any static host.
* **Single-file build:** `npm run build` produces a self-contained
  `dist/index.html` (~2.5 MB) plus a byte-identical `dist/crowd-count.html`
  that double-clicks straight into any browser via `file://`. The `index.html`
  copy is what GitHub Pages serves; the renamed `crowd-count.html` is the
  one attached to each GitHub release. All assets — JS, CSS, fonts, the
  favicon, the 3D mannequin — are inlined via
  [`vite-plugin-singlefile`](https://github.com/richardtallent/vite-plugin-singlefile).
* **Animated crowd models:** the six animated GLB references (~430 MB
  combined) are too large for the repository — two exceed GitHub's 100 MB
  per-file limit — so they are attached to the
  [v2.0.0 release](https://github.com/ProfRino/crowd-count/releases/tag/v2.0.0)
  as individual assets. The deploy workflow stages them from there into the
  GitHub Pages site, and the app streams them from that site whenever no
  local copy is served. For local development, download them into
  `public/crowd-models/` — the app always tries the local path first.

The GitHub Actions workflow at `.github/workflows/deploy.yml` rebuilds and
redeploys the hosted version on every push to `main`, staging the animated
crowd models from the release assets into the site. The single-file
`crowd-count.html` build is attached to each tagged GitHub release.

## Stack

[Vue 3](https://vuejs.org) + [Vite](https://vitejs.dev) +
[Tailwind CSS](https://tailwindcss.com) +
[MapLibre GL JS](https://maplibre.org) + [Three.js](https://threejs.org) +
[3d-tiles-renderer](https://github.com/NASA-AMMOS/3DTilesRendererJS) +
[Turf.js](https://turfjs.org) + [earcut](https://github.com/mapbox/earcut) +
[fflate](https://github.com/101arrowz/fflate). MIT-licensed.

## Citation

If you reference this work, please cite:

> Lovreglio, R. *Crowd Count*. Massey University.
> https://github.com/ProfRino/crowd-count

A machine-readable [`CITATION.cff`](CITATION.cff) is included in this
repository — GitHub renders it as a "Cite this repository" button in the
sidebar.

## License

[MIT](LICENSE) — © 2026 Rino Lovreglio.
