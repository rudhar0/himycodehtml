# CodeViz Runtime Diagnostic Report

## Environment Summary

| Component | Detected / Resolved Value |
| :--- | :--- |
| **Detected OS** | Windows (win32) |
| **Runtime mode** | NeutralinoJS + Node.js (sidecar) |
| **Build mode** | Development / Portable Packaging |
| **Neutralino version** | 6.5.0 (from config) |
| **Node version** | 18.20.8 (bundled) |
| **Toolchain version** | LLVM/Clang 18.1.8 |

---

## Frontend Diagnostics

### Asset Loading (Check: `file:///` vs `http://`)
*   **Status**: ❌ **FAIL**
*   **Detected values**: `base: './'` in `vite.config.ts`, `url: '/index.html'` in `neutralino.config.json`.
*   **Root Cause**: When served via `file://` in a Neutralino window, WebView2 applies strict origin policies. While `base: './'` handles relative paths for script/CSS tags, it does not resolve **CORS** for the backend API or dynamic worker loading if `workerBase` is incorrectly set.
*   **Fix Hint**: Ensure `Neutralino.config.cli.resourcesPath` and `base` are perfectly aligned. Use Neutralino's built-in server (e.g., `http://localhost:port`) instead of `file://` to bypass the `file://` origin restriction if possible, OR add `--disable-web-security` (not recommended) or configure `CheckNetIsolation` (done in installer).

### Socket.io Connectivity
*   **Status**: ⚠️ **WARNING**
*   **Detected values**: Origin `http://localhost:5173` allowed in `cors.config.js`.
*   **Root Cause**: Neutralino chooses a **random port** (port: 0) for the frontend. The backend's `cors.config.js` only allows a hardcoded list of ports (5173, 5174, 3000). Since the Neutralino frontend port is dynamic, it is blocked by CORS.
*   **Fix Hint**: Modify `cors.config.js` to allow a broader range or implement a dynamic CORS allowance based on the `port.json` detected by the bootstrap.

---

## Backend Diagnostics

### Port Portability & `port.json`
*   **Status**: ❌ **FAIL** (Reliability Issue)
*   **Detected values**: `port.json` written to `.runtime/` in `backend`.
*   **Root Cause**: `port-manager.js` writes `port.json` after the server starts listening, but `neutrala-bootstrap.js` in the frontend might read it **before** it is atomically flushed or while the backend is still in its startup grace period.
*   **Fix Hint**: Use `writeJsonAtomic` (already implemented) but increase the polling interval and health-check timeout in `neutrala-bootstrap.js`.

### API Health
*   **Status**: ✅ **PASS**
*   **Expected**: `/api/health` returns `{ status: 'ok' }`.
*   **Verification**: `server.js` mounts routes correctly and the health route is defined in `routes/index.js`.

---

## Desktop Runtime Diagnostics

### Neutralino Bootstrap Reliability
*   **Status**: ⚠️ **WARNING**
*   **Detected values**: `NL_PATH` resolution via `Neutralino.os.getEnv`.
*   **Root Cause**: `neutrala-bootstrap.js` relies on `NL_PATH` to find the `appDir`. In some environments (e.g., macOS DMG or specific Windows portable setups), `NL_PATH` might point to a temporary folder or the binary itself, leading to the incorrect `backendDir` calculation (it currently tries `..` and `../..`).
*   **Fix Hint**: Hardcode a more robust relative structure or use `Neutralino.app.getPath()` if available.

### Backend Spawn Command
*   **Status**: ✅ **PASS**
*   **Logic**: Uses `cmd /c "start "" /B ..."` on Windows for background execution.
*   **Resolution**: Correctly handles both packaged `.exe` (sidecar) and `node src/server.js` (dev mode).

---

## Toolchain Diagnostics

### Clang Location & Include Paths
*   **Status**: ✅ **PASS**
*   **Detected**: `resources/toolchain/windows/bin/clang++.exe`.
*   **Include Paths**: `-nostdinc` and `-isystem` used to isolate the bundled headers. This is a high-quality implementation.
*   **Fix Hint**: Ensure `LD_LIBRARY_PATH` and `DYLD_LIBRARY_PATH` are set on POSIX to avoid loading host system libraries.

### Windows Runtime (DLLs)
*   **Status**: ⚠️ **WARNING**
*   **Finding**: `stageRuntimeDependencies` is called in `instrumentation-tracer.service.js`, but if the binary is executed via `shell: true` (which it is), the search path might skip the local directory if the working directory isn't set exactly to the binary location during certain spawn conditions.

---

## Animation Pipeline Diagnostics

### Step Event Normalization
*   **Status**: ❌ **FAIL**
*   **Observed Errors**: `arg_bind`, `expression_eval`, `branch_taken` unsupported.
*   **Explanation**: The `instrumentation-tracer.service.js` produces these raw events, but the `convertToSteps` logic does not map them to the `StepType` enum defined in `execution-step.model.js`. Specifically:
    1.  `arg_bind` and `expression_eval` are missing from the `StepType` constant.
    2.  `branch_taken` is present in the enum but may be emitted with incorrect casing or missing required `animation` metadata.
*   **Fix Hint**: Update `execution-step.model.js` to include the missing types and update `convertToSteps` in the tracer to normalize these events before emitting them to the frontend.

---

## Build Packaging Diagnostics

### Icon Embedding
*   **Status**: ⚠️ **WARNING**
*   **Windows**: `build.js` uses NSIS and `CreateShortCut`. It correctly sets the icon for the shortcut, but if the `app.ico` is missing from the `resources` folder at build time, the installer builds without errors but the icon defaults to the Neutralino logo.
*   **macOS/Linux**: `build.js` lacks an `.app` bundle generator (only `.sh` portable) and `.desktop` generator. Icons will not show in Docks/Menus on these platforms.

---

## Root Cause Summary

1.  **CORS/Dynamic Port Intersection**: The frontend runs on a random port, but the backend only whitelist's development ports (5173/3000).
2.  **Event Type Mismatch**: The instrumentation engine generates beginner-level events (`arg_bind`, etc.) that the frontend animation engine doesn't recognize yet.
3.  **Bootstrap Path Fragility**: `NL_PATH`-based relative pathing fails if the application is launched from a symlink or specific OS-mounted volume.

---

## Fix Recommendation Priority

1.  **Critical**: Update `backend/src/config/cors.config.js` to allow dynamic origins or the specific Neutralino origin.
2.  **High**: Map `arg_bind`, `expression_eval`, and `branch_taken` to their respective frontend animation handlers.
3.  **High**: Ensure `port.json` is flushed and verified before the frontend attempts to mount.
4.  **Medium**: Add native `.app` and `.desktop` bundle logic to `build.js` for cross-platform icon support.

---

## Machine Readable Output

```json
{
  "detectedProblems": [
    "CORS_BLOCKED_DYNAMIC_PORT",
    "UNSUPPORTED_STEP_TYPES_ANIMATION",
    "BOOTSTRAP_PATH_RESOLUTION_FRAGILITY",
    "ASSET_PATH_MISMATCH_FILE_PROTOCOL"
  ],
  "severity": "CRITICAL",
  "suspectedRootCause": "Intersection of Neutralino's dynamic frontend port and backend's static CORS whitelist, combined with an unfinished event normalization layer in the tracer service.",
  "recommendedFixTargets": [
    "backend/src/config/cors.config.js",
    "backend/src/models/execution-step.model.js",
    "backend/src/services/instrumentation-tracer.service.js",
    "frontend/public/neutrala-bootstrap.js"
  ]
}
```
