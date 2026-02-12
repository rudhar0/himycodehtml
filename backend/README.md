# NeutralaJS Backend (Cross‑Platform)

Node.js (ESM) backend with Express + Socket.IO (WebSocket transport), automatic port selection/locking, startup platform validation, dependency auditing, and a single interactive build script.

## Requirements
- Node.js `>= 18` (see `backend/package.json`)

## What you have in this repo
- Backend server: `backend/src/server.js`
- Backend startup validator: `backend/src/utils/startup-validator.js`
- Port manager + lock + heartbeat: `backend/src/utils/port-manager.js` (writes `backend/.runtime/port.json` + `backend/.runtime/port.lock`)
- Build script (pkg + DMG + DEB + desktop bundle): `backend/scripts/build.js`
- Staged Node runtime (for no-global-Node launches): produced under `node-runtime/` by the build script
- Resource copying: `backend/scripts/build.js` copies `backend/resources/` into build outputs
- Dependency audit / pruning tool: `backend/scripts/deps-audit.js`
- Session registry for Socket.IO: `backend/src/sockets/session-registry.js`

## Install
```bash
cd backend
npm install
```

## Run (deterministic + no hardcoded port)
```bash
cd backend
npm run start
```

## Unified desktop dev start (recommended)
From `backend/`, this launches:
- Backend (reuses existing `backend/.runtime/port.json` when healthy)
- Frontend (Vite on `http://localhost:5173`)
- Neutralino shell (`neu run`)
- Runtime + toolchain checks
```powershell
cd backend
npm run neutrala:start
```

Optional:
- `NEUTRALA_BACKEND_MODE=dev` to run the backend via `nodemon`
- `NEUTRALA_RUNTIME_REQUIRED=true` to fail if Neutralino runtime is missing
- `NEUTRALA_RUNTIME_NO_NEU=true` to skip `neu update` (offline/manual runtime)

On startup the server:
- Validates platform + filesystem writability
- Optionally ensures Neutralino runtime pack is present when `NEUTRALA_RUNTIME_REQUIRED=true` or `NEUTRALA_RUNTIME_AUTO=true`
- Selects a port:
  - If `PORT` is set → validates and uses it (fails fast if unavailable)
  - Else → scans `PORT_RANGE` (default `3000-3999`) and binds the first free port
- Writes runtime state to `backend/.runtime/`:
  - `port.json` (selected port + PID)
  - `port.lock` (process lock)

## Dev
```bash
cd backend
npm run dev
```

## Desktop (NeutralinoJS)
Desktop launch behavior is implemented in `frontend/public/neutrala-bootstrap.js`:
- Reads `backend/.runtime/port.json` and pings `GET /api/health` to reuse an existing backend
- Otherwise starts the backend and waits for health before the UI renders
- Exposes multi-window helpers:
  - `window.neutrala.openWindow(url)`
  - `window.neutrala.openNewWindow()`

### Install `neu` (preferred: global)
```powershell
npm install -g @neutralinojs/neu
```

If PowerShell blocks scripts:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

### Scaffold a Neutralino app (official workflow reference)
```powershell
neu create neutrala-desktop
```
This repo already includes a Neutralino config template at `desktop/neutralino.config.json`.

### Run desktop in dev (hot reload)
1) Backend:
```powershell
cd backend
npm run dev
```
2) Frontend (Vite):
```powershell
cd frontend
npm run dev
```
3) Neutralino:
```powershell
cd desktop
neu update
node scripts/sync-neutralino-js.mjs
neu run
```

## Dependency audit / pruning
```bash
cd backend
npm run deps:audit
```

Apply safe fixes (conservative):
```bash
cd backend
npm run deps:fix
npm install
```

## Build (single interactive script)
```bash
cd backend
node scripts/build.js
```

Or:
```bash
cd backend
npm run neutrala:build
```

Outputs go to `backend/build/out/`:
- Windows → `.exe`
- macOS → `.dmg` (requires macOS `hdiutil`)
- Linux → `.deb` (built in pure Node; no `dpkg` required)

- Optional (prompted): `*-desktop-portable/` folder with `desktop/` (Neutralino) + `backend/` (pkg backend)

Notes:
- The build script bundles `backend/resources/` next to the produced artifact.
- It also stages a Node.js v18 runtime beside the artifact in `node-runtime/` (so no global Node is required even without `pkg`).
- JS source is “encrypted” via conservative minification (compression only) during staging.

## Neutralino runtime auto-download (backend/resources/neutrala-runtime)
The runtime manager ensures a Neutralino runtime exists under `backend/resources/neutrala-runtime/<platform>/`:
- Preferred: runs `neu update` (official Neutralino workflow) when `neu` is available
- Optional: download from a custom mirror via `NEUTRALA_RUNTIME_BASE_URL` / `NEUTRALA_RUNTIME_URL_*` (with SHA256 verification)
- Offline cache: archives are cached under `~/.neutrala/cache/runtime` (override with `NEUTRALA_RUNTIME_CACHE_DIR`).

Configure:
- `NEUTRALA_RUNTIME_VERSION` (optional; if set, attempted via `neu update --runtime-version <version>`)
- `NEUTRALA_RUNTIME_BASE_URL` (optional override; supports templates like `.../v{version}/` and filenames like `neutralinojs-v{version}-{platform}_{arch}.zip`)
- `NEUTRALA_RUNTIME_URL_WINDOWS` / `NEUTRALA_RUNTIME_URL_MAC` / `NEUTRALA_RUNTIME_URL_LINUX` (explicit override)
- `NEUTRALA_RUNTIME_SHA256_WINDOWS` / `NEUTRALA_RUNTIME_SHA256_MAC` / `NEUTRALA_RUNTIME_SHA256_LINUX` (optional; if missing the downloader attempts to fetch `*.sha256` siblings)
- `NEUTRALA_RUNTIME_SKIP_VERIFY=true` to bypass checksum verification
- `NEUTRALA_RUNTIME_REQUIRED=true` to fail backend startup if the runtime is missing (defaults to optional in dev)
- `NEUTRALA_RUNTIME_OFFLINE=true` to disallow network fetches and require cache/mirror

The runtime is installed under `backend/resources/neutrala-runtime/<platform>/` (or `build/out/resources/...` for packaged builds).

## Diagnostics
`backend/.runtime/diagnostics.json` is written by:
- `npm run neutrala:start`
- `npm run neutrala:build`
- `npm run neutrala:doctor`

Doctor:
```bash
cd backend
npm run neutrala:doctor
```

## Explicitly out of scope
Tracer / instrumentation logic is not modified by this setup work. If tracer issues appear at runtime, they are logged and the rest of the system continues.

## Windows notes (WebView2 + loopback)
For the best experience on Windows, install Microsoft WebView2 Runtime.
If you hit loopback issues in restricted environments, add a loopback exemption:
```powershell
CheckNetIsolation.exe LoopbackExempt -a -n="Microsoft.Win32WebViewHost_cw5n1h2txyewy"
```
