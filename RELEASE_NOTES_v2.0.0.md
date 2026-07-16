# Crowd Count v2.0.0

The largest release since Crowd Count launched. Version 2.0 takes the estimator into full 3D — a complete 3D site view with instanced crowds, optional Google Photorealistic 3D Tiles, animated density references — and adds density gradients, crowd appearance controls, and a 2D renderer that now handles up to 200,000 people per zone.

Try it online at [profrino.github.io/crowd-count](https://profrino.github.io/crowd-count/), or download `crowd-count.html` below and double-click it.

## Downloads in this release

- **`crowd-count.html`** — the entire app in a single ~2.5 MB file. No install, no server: save it and double-click. Map tiles, place search, Google features, and the animated density references need an internet connection; everything else works offline.
- **`dynamic_crowd_export_loop_1000_3x3x1.glb` … `3x3x6.glb`** — the six animated crowd reference models (24–117 MB each). You do not need to download these: the app streams them from the Crowd Count website on demand. They are attached here as the canonical copies (the website deployment stages them from this release) and for self-hosting — place them in a `crowd-models/` folder next to a self-hosted build and the app will use the local copies instead.

## Full 3D site view

- A complete 3D view of your site alongside the existing 2D map, with synchronized switching between the two.
- Instanced crowd rendering designed for very large crowds, plus 3D zones and obstructions.
- Orbit, pan and zoom mouse controls; keyboard navigation with WASD, Q/E, R/F and +/-.
- Grayscale and colour display modes, and a collapsible controls panel.
- Looping cinematic camera modes: Orbit, Flyover, Sweep, Push, Drone and Skim.
- Press `H` for a crowd wave; Natural mix mode adds subtle idle crowd movement.

## Google Maps and Photorealistic 3D Tiles

- Google roadmap and satellite basemaps, and Google Photorealistic 3D Tiles in the 3D site view.
- Bring your own Google Maps API key. It is stored only in your browser's localStorage and is never written into project files or share links.
- Terrain-height sampling and raycasting place the crowd on the real ground, with tile-aware occlusion and a manual **Reset height** action after tiles finish loading.
- Camera-clearance handling keeps cinematic flights above Google terrain.
- Direct links and guidance for Google Cloud billing reports, API traffic, quotas and pricing.

## Density gradients

- Each zone can now be **Uniform** or a **Gradient**: a linear ramp between two densities along a draggable map direction.
- Draggable start and end handles with configurable distances and densities, and an Enter-to-apply workflow so the direction can be adjusted before pedestrians are rendered.
- Totals use exact gradient integration over the real zone geometry — accounting for changing polygon width and excluded obstructions — while safety warnings assess the peak gradient density against the selected standard.

## Crowd appearance and orientation

- Three people-colour modes: Neutral, By zone and Natural mix, with separate head, upper-body and lower-body colouring and more natural skin, hair and clothing palettes.
- Random pedestrian orientation by default, or **Aim crowd** to face everyone in a zone towards a draggable point.
- Shared human-scale definitions keep dimensions consistent across the 2D and 3D views, and the 2D symbols gained distinct head and shoulder geometry.

## 3D density reference

- The original procedural **Simple** mode is joined by an **Animated** mode with six animated crowd presets, one for each density from 1 to 6 people/m².
- Single and Compare examples are standardized to a 3 m × 3 m reference area, with the number of people matched exactly to the selected density.
- Varied and Forward orientation options, deterministic randomized placement instead of obvious rows, and improved camera framing.

## Sampling and count accuracy

- The 2D visible-agent ceiling increased from roughly 15,000 to **200,000 agents per zone**.
- Improved sampling for circles, concave polygons and polygons containing holes, with reservoir and top-up sampling to eliminate missing areas in large or irregular zones.
- Weighted rejection sampling matches the rendered distribution to gradient densities, and zone capacity keeps the exact area-minus-obstruction calculation.

## Governing standards

- Standard-specific threshold markers on the density sliders.
- Corrected Green Guide threshold presentation (4.70, replacing the former 4.75 marker) and clearer warning wording that distinguishes the selected standard from its numeric limit.

## Drawing, editing and ruler improvements

- Better circle and rectangle completion (Enter or second click), restored draggable zone geometry handles, and cleaner cancellation when leaving drawing modes.
- The ruler now shows the confirmed distance, a live preview to the next point, and a projected total — with explicit Done and Clear actions, correct point/segment counting, and a measurement that stays visible after leaving ruler mode.
- Improved keyboard handling throughout for Enter, Escape and Ctrl/Cmd+Z.

## Saving and sharing

- Share links and project files now preserve gradient settings, people-colour mode, crowd aim points, and the new view settings.
- Full backward compatibility: project files and share links from earlier versions keep working.
- The Google API key remains excluded from saved projects and shared URLs.

## Help, privacy and attribution

- A much more complete About panel: feature inventory, density/area/gradient calculation explanations, 2D and 3D navigation instructions, and Google Maps Platform setup, usage and billing guidance.
- Clear statements of which features make network requests and which data stays local.
- Expanded attribution for map tiles, satellite imagery, 3D Tiles and human models, with map attribution controls repositioned out of the working area.

## Compatibility

Everything from v1.5.0 is still here: polygon, circle and rectangle zones; obstructions; governing standards; indoor calibrated plans; Save/Open; share links; and the original Simple 3D density reference.

---

**Disclaimer:** all results are Fermi-style order-of-magnitude estimates and must be independently verified by a qualified safety professional before use in any design, planning, or regulatory context.
