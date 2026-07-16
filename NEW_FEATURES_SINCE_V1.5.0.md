# Crowd Count: New Features Since v1.5.0

This document summarizes the user-facing additions and improvements in the current development version of Crowd Count compared with the published [`v1.5.0`](https://github.com/ProfRino/crowd-count/releases/tag/v1.5.0) baseline.

> Status: Development version. These changes have not yet been published as a GitHub release.

## Full 3D Site View

- Added a full 3D site view in addition to the existing 3D density-reference viewer.
- Added instanced 3D crowd rendering designed to support very large crowds.
- Added 3D representations of zones and obstructions.
- Added synchronized switching between the 2D map and 3D site view.
- Added grayscale and colour display modes.
- Added orbit, pan and zoom mouse controls.
- Added keyboard navigation using WASD, Q/E, R/F and +/-.
- Added a collapsible 3D controls panel.
- Added looping cinematic camera modes: Orbit, Flyover, Sweep, Push, Drone and Skim.
- Added a crowd wave triggered with the `H` key.
- Added subtle idle crowd movement in Natural mix mode.

## Google Maps And Photorealistic 3D Tiles

- Added Google roadmap and Google satellite basemaps.
- Added Google Photorealistic 3D Tiles to the 3D site view.
- Added local Google Maps API-key management.
- API keys are stored in browser `localStorage` and are excluded from project files and share links.
- Added terrain-height sampling and raycasting for positioning agents on Google 3D Tiles.
- Added tile-aware crowd occlusion and terrain placement.
- Added a manual **Reset height** action to repeat terrain sampling after tiles have loaded.
- Added camera-clearance handling for cinematic flights over Google terrain.
- Added direct links to Google Cloud billing reports, API traffic, quotas and pricing information.
- Added guidance explaining Google Maps Platform usage reporting and billing delays.

## Density Gradients

- Added **Uniform** and **Gradient** density modes for each zone.
- Added a linear gradient defined by two density points and a map direction.
- Added draggable gradient start and end handles.
- Added an Enter-to-apply workflow so the direction can be adjusted before pedestrians are rendered.
- Added configurable start and end distances and densities.
- Added weighted pedestrian placement based on the local density along the gradient.
- Added exact gradient integration across the actual zone geometry rather than assuming a rectangular area.
- Gradient calculations account for changing polygon width and excluded obstructions.
- Zone totals use the integrated density, while safety warnings use the maximum gradient density.

## Crowd Appearance And Orientation

- Added three people-colour modes: Neutral, By zone and Natural mix.
- Added separate head, upper-body and lower-body colouring.
- Added more natural skin, hair and clothing palettes.
- Added random pedestrian orientation when no target direction is selected.
- Added **Aim crowd**, allowing pedestrians in a zone to face a user-selected point.
- Added a draggable aim point that can be repositioned after creation.
- Added shared human-scale definitions for more consistent dimensions across 2D and standard 3D views.
- Improved 2D human symbols with distinct head and shoulder geometry.

## 3D Density Reference

- Retained the original procedurally generated **Simple** mode.
- Added an **Animated** mode using six animated GLB crowd presets.
- Added presets from 1 to 6 people per square metre.
- Standardized Single and Compare examples to a 3 m x 3 m reference area.
- Adjusted the number of people in each reference to match its selected density.
- Added Varied and Forward orientation options for Simple mode.
- Replaced obvious row placement with deterministic randomized distribution.
- Added calibrated scale and position corrections for animated presets 3 to 6.
- Improved camera framing and spacing in Single and Compare views.

## Sampling And Count Accuracy

- Increased the 2D visible-agent ceiling from approximately 15,000 to 200,000 agents per zone.
- Improved sampling for circles, concave polygons and polygons containing holes.
- Added reservoir and top-up sampling to reduce missing areas in large or irregular zones.
- Added weighted rejection sampling for gradient-density zones.
- Improved consistency between calculated totals and rendered pedestrian distribution.
- Preserved exact area-minus-obstruction calculations for zone capacity.

## Governing Standards

- Added standard-specific threshold markers to density sliders.
- Corrected the Green Guide threshold presentation so 4.70 is not confused with the former 4.75 marker.
- Simplified standard names and removed repeated threshold numbers from selection cards.
- Improved warning wording to distinguish the selected standard from its numeric limit.
- Gradient warnings now assess the maximum density against the selected standard.

## Drawing And Editing Workflow

- Improved circle and rectangle completion using Enter or a second click.
- Improved cancellation and cleanup when leaving drawing modes.
- Restored draggable zone geometry handles.
- Improved deletion so removed zones also disappear from the map.
- Added draggable gradient direction handles before confirmation.
- Added draggable crowd aim points.
- Prevented drawing instructions from trapping other map and 3D actions.
- Improved keyboard handling for Enter, Escape and Ctrl/Cmd+Z.

## Ruler Improvements

- The ruler now shows the distance already confirmed by clicks.
- Added a live preview of the distance to the next point.
- Added a projected total while positioning the next point.
- Corrected point and segment counting: two points equal one segment.
- Added explicit Done and Clear actions.
- The completed measurement remains visible after leaving ruler mode.
- Improved Escape behaviour so the user can reliably exit the ruler.

## Saving And Sharing

- Extended the share-link format to preserve gradient settings.
- Added persistence for people-colour mode, gradient direction, gradient values and crowd aim points.
- Added persistence for new 2D and 3D view settings where appropriate.
- Maintained backward compatibility with older project files and share links.
- Continued excluding the Google API key from saved projects and shared URLs.

## Help, Privacy And Attribution

- Expanded the About panel with a more complete feature inventory.
- Added explanations of density, area and gradient calculations.
- Added 2D and 3D navigation instructions.
- Added Google Maps Platform setup, usage and billing guidance.
- Clarified which features make network requests and which data remains local.
- Expanded map, satellite-tile, 3D-tile and human-model attribution.
- Repositioned map attribution controls to reduce interference with the working area.

## Distribution

- The core application continues to build as a single `crowd-count.html` file.
- Animated crowd GLB files are distributed as external assets because of their combined size.
- Added the dependencies required for exact polygon processing and streamed 3D Tiles.

## Compatibility Note

The existing v1.5.0 capabilities remain available, including polygon, circle and rectangle zones; obstructions; the base ruler; governing standards; indoor calibrated plans; Save/Open; share links; and the original Simple 3D density reference. The items above describe additions or substantial improvements rather than relisting those established features.
