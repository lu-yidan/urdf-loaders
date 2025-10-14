# MuJoCo XML Viewer (THREE.js)

An extended viewer built on top of `urdf-loaders` to load and inspect MuJoCo XML models in the browser. It includes primitives, mesh loading (STL/OBJ), joint controls, collision visualization, and robust drag‑and‑drop for local folders.

## Features

- Render MuJoCo primitives: sphere, capsule, box
- Load meshes: STL and OBJ (via THREE `STLLoader`/`OBJLoader`)
- Camera + scene:
  - Global z‑up (MuJoCo) to y‑up (THREE) transform (−90° X)
  - Orbit, pan, zoom
- Joint interaction:
  - Auto‑detected hinge joints with per‑joint slider and number input
  - Degree/radian UI toggle with correct range handling from `<compiler angle>`
  - 3D joint handles: click a blue sphere and drag to adjust the joint
- Collision controls:
  - Show Collision (toggle collision geoms)
  - Collision only (hide visuals)
  - Render collisions as capsules (convert box collisions to capsules along the longest axis)
- Visual helpers:
  - Optional +90° X flip for certain OBJ/STL assets
  - Preserve camera view when toggling options
- Robust asset resolution:
  - `<include>` resolution with nested includes
  - `<compiler meshdir>` and relative path handling
  - Special handling for included `assets.xml` to resolve mesh base paths
  - Works for server‑hosted models and drag‑and‑dropped local folders
- Drag‑and‑drop local model folders:
  - Builds a virtual filesystem (blob URLs)
  - Temporary `fetch` override and `LoadingManager.setURLModifier` for asset paths
  - Automatically chooses the best XML root (prefers XMLs with `<worldbody>/<geom>`)
- Stable UI:
  - Collapsible sections (Example models / Control) with on‑title toggles (Hide/Show)
  - Two‑column model list
  - Current model indicator and loading hint

## Run locally

Requirements: Node.js 18+ and npm.

```bash
cd javascript
npm install
npm run start
# Open: http://localhost:9080/javascript/example/dev-bundle/mujoco.html
```

If you add new example pages, restart the dev server so Parcel rebuilds `dev-bundle/`.

## Usage

Open `mujoco.html` and pick a model from “Example models”, or drag a MuJoCo model folder into the page. When dragging a folder:

- The viewer scans for candidate XML files and picks the most likely root.
- Asset paths are rewritten to blob URLs so STL/OBJ files load correctly from the local folder.
- After loading completes, the fetch override is safely restored.

### UI controls

- Flip visual attachments (+90° X)
- Show Collision / Collision only
- Render collisions as capsules
- Use Radians
- Joint sliders and numeric inputs (ranges respect `<range>` and angle units)

## Coordinate systems

- MuJoCo uses z‑up; THREE.js uses y‑up. The whole scene is rotated −90° around X so that MuJoCo models appear correct in THREE.
- `quat` attributes from bodies and geoms are parsed as w‑x‑y‑z and applied in local space.

## Netlify Deployment

Important: We use two output folders during development/builds:

- `example/dev-bundle/`: development output used by `npm run start` (Parcel watch, hot‑reload, unminified). Not recommended for production.
- `example/bundle/`: production build used by `npm run build-examples` (minified/static). Recommended for deployment.

### Recommended: Build at deploy time (production)

1) Create `netlify.toml` in the repo root (already present) with production settings:

```toml
[build]
  base = "javascript"
  publish = "example/bundle"
  command = "npm ci && npm run build-examples"

[build.environment]
  NODE_VERSION = "18"

# Optional: allow direct deep-links under the example path
[[redirects]]
  from = "/javascript/example/*"
  to = "/javascript/example/bundle/:splat"
  status = 200
```

2) In Netlify:
   - New site from Git
   - Select branch: `lu_mujoco_dev`
   - Netlify reads `netlify.toml` automatically
   - On every push to `lu_mujoco_dev`, Netlify runs the command above and publishes `example/bundle`

`npm run build-examples` is defined in `javascript/package.json` and writes the production site to `javascript/example/bundle/`.

### Local verify before pushing (optional)

```bash
cd javascript
npm ci
npm run build-examples   # creates example/bundle
npx http-server example/bundle -p 8080  # open javascript/example/bundle/mujoco.html in a static server to verify
# If npx has network issues, use a mirror registry:
# npx --registry https://registry.npmmirror.com http-server example/bundle -p 8080
```
Open the host
```
http://localhost:8080/mujoco.html
```

### Development vs Production summary

- Local development: `npm run start` → open `http://localhost:9080/javascript/example/dev-bundle/mujoco.html`
- CI/Netlify deployment: `npm run build-examples` → publishes `javascript/example/bundle/`

## Known notes

- Large OBJ meshes can be slow to render—use collision toggles to inspect simplified geometry.
- When switching between drag‑and‑drop models and menu models, the viewer automatically clears any temporary URL mapping so subsequent models load from the server correctly.

## Credits

- Based on and inspired by `gkjohnson/urdf-loaders`
- Modifications by `lu-yidan/urdf-loaders` (Author: LU Yidan)


