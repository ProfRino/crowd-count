# Crowd Count

Browser-only crowd-size estimator. Draw a polygon on a map (outdoor) or a
floor plan (indoor), pick a density, get a Fermi estimate. Everything runs
client-side — there is no backend.

## Features

- **Outdoor** mode — MapLibre + OSM, with free Esri satellite tiles, OSM
  Nominatim search, and a real-world scale bar
- **Indoor** mode — upload a floor plan, calibrate with two clicks + a
  known distance, then draw zones in real m² / ft²
- **Multi-zone management** — name, colour, per-zone density slider with
  Keith Still's reference tick marks
- **Codified safety thresholds** — UK Purple Guide (2.0 ppl/m²),
  UK Green Guide standing terrace (4.7), NFPA 101 standing assembly
  (2.15), Still's upper safe limit (5.0); badge updates live per zone
- **Crowd visualisation** — head-on-shoulders person symbols rendered at
  real-world 0.6 m scale, jittered-grid sampled inside each polygon, cached
  per zone so editing one zone doesn't reshuffle the others
- **Metric / imperial toggle** for the scale bar, areas and calibration
- **Permalink sharing** — fflate-compressed URL fragment, no backend
- **Ctrl+Z** to remove the last polygon vertex while drawing

## Stack

Vue 3 + Vite + Tailwind + MapLibre GL JS + Turf.js + fflate.
MIT-licensed source.

## Develop

```sh
npm install
npm run dev        # localhost:5173
npm run build      # static site → dist/
npm run preview    # serve dist/ at localhost:4173
```

Deploys cleanly to GitHub Pages, Cloudflare Pages, Netlify, or any static host.

## License

[MIT](LICENSE).
