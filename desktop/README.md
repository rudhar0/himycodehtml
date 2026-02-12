# Neutrala Desktop (NeutralinoJS)

This folder contains the Neutralino configuration template used by the desktop build.

## Install `neu` (preferred)
```powershell
npm install -g @neutralinojs/neu
```

If PowerShell blocks scripts:
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

## Run (dev)
Recommended one-liner (from `backend/`):
```powershell
cd backend
npm run neutrala:start
```

1) Start backend (auto-port + lock):
```powershell
cd backend
npm run dev
```

2) Start frontend (Vite):
```powershell
cd frontend
npm run dev
```

3) Run Neutralino:
```powershell
cd desktop
neu update
neu run
```

If you want the one-liner (also downloads `neutralino.js` into `frontend/public/` for Vite dev):
```powershell
cd desktop
npm run dev:desktop
```

## How the UI finds the backend
The frontend loads `public/neutrala-bootstrap.js` (via `frontend/index.html`) which:
- Reads `backend/.runtime/port.json`
- Calls `GET /api/health`
- Reuses the backend port if healthy, otherwise starts the backend and waits until healthy

The resolved base URL is exposed as:
- `globalThis.__NEUTRALA_API_URL`
- `globalThis.__NEUTRALA_SOCKET_URL`

## `nativeAllowList`
The config template enables:
```json
[
  "app.",
  "os.",
  "filesystem.",
  "debug.log"
]
```
