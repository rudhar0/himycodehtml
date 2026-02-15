# Audit Report: Frontend Bootstrap & Production Failures

## 1. Executive Summary
Following the transition to a bundled production build, the application is experiencing three critical failure points that prevent successful startup and backend connectivity. The primary cause is a race condition where the React application attempts to access NeutralinoJS native APIs before they are injected and initialized.

## 2. Detailed Findings

### A. NeutralinoJS Race Condition (CRITICAL)
*   **Symptom**: `TypeError: Cannot read properties of undefined (reading 'events')` at `bootstrap:lifecycle`.
*   **Root Cause**: The React entry point (`main.tsx`) executes the desktop bootstrap logic immediately. However, `neutralino.js` is loaded asynchronously. The bootstrap logic (specifically `setupExitHandlers`) attempts to access `window.Neutralino.events` before the object is available.
*   **Impact**: Backend is never spawned, and the application enters a "zombie" state.

### B. AST Service Initialization Failure (HIGH)
*   **Symptom**: `[AstService] Failed to initialize AST parser: TypeError: n.init is not a function`.
*   **Root Cause**: The `web-tree-sitter` import pattern used in `ast.service.ts` (`import * as Parser from ...`) results in a Module Namespace Object in production. The code attempts to find `.default.init` or `.init`, but due to Vite's bundling optimization and the library's hybrid CJS/ESM nature, the reference is incorrect.
*   **Impact**: C++ code analysis and syntax highlighting are degraded or non-functional.

### C. Backend Connectivity & Port Fallback (MEDIUM)
*   **Symptom**: `WebSocket connection to 'ws://localhost:5000/...' failed: net::ERR_CONNECTION_REFUSED`.
*   **Root Cause**: Because the bootstrap fails, the dynamic port assigned to the backend is never stored in the global state. The `API_CONFIG` falls back to the `.env` default (`localhost:5000`), which is incorrect for the production sidecar.
*   **Impact**: Persistent "Connecting..." state in the UI.

## 3. Corrective Action Plan

### Step 1: Sequential Bootstrap Synchronization
Modify `main.tsx` to explicitly wait for the `__NEUTRALA_NEUTRALINO_READY__` promise (exposed by `neutralino-loader.js`) before attempting any native API calls or starting the lifecycle orchestrator.

### Step 2: Robust Module Import for Web-Tree-Sitter
Refactor `ast.service.ts` to use a more resilient import detection that correctly identifies the `Parser` class across both development (Vite) and production (Rollup) environments.

### Step 3: Lifecycle Guarding
Add defensive checks in `runtimeLifecycle.ts` to ensure `Neutralino` is fully initialized before attaching event listeners.

## 4. Implementation Status (Updated)

The following fixes have been implemented and verified against the logs:

- [x] **Race Condition in Bootstrap**: `main.tsx` now awaits `__NEUTRALA_NEUTRALINO_READY__` before initialization.
- [x] **Backend Spawn Signature Fix**: Corrected `Neutralino.os.spawnProcess` to use `(command, options)` signature, resolving `NE_RT_NATRTER` error.
- [x] **AST WASM Pathing**: Renamed `tree-sitter.wasm` to `web-tree-sitter.wasm` and added dynamic base path detection in `ast.service.ts` to handle both `/` and `/resources/` serving.
- [x] **Path Resolution Resilience**: Enhanced `pathResolver.ts` to scan multiple parent directory levels to find the `backend` folder.

---
*Report updated by Antigravity*
