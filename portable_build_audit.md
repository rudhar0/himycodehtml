# Portable Build Audit Report

## 1. Backend Startup Failure (Timeout)

### Root Cause: Startup Mismatch & Duplicate Spawning
The application currently has two competing mechanisms for starting the backend:
1.  **Neutralino Extension**: The `neutralino.config.json` defines the backend as an extension with `"autoStart": true`.
2.  **Frontend Spawner**: `backendSpawner.ts` explicitly calls `Neutralino.os.spawnProcess` to start the same backend.

### The Port Conflict
My previous fix added `NEUTRALA_FORCE_LOCAL_RUNTIME: 'true'` to the **Frontend Spawner**. This ensures the backend writes its port information to the local folder. 
However, the **Neutralino Extension** starts first (automatically by the shell) and **does not** have this environment variable. It writes the port file to the user's `%APPDATA%` folder. The frontend, expecting the local file, times out.

## 2. AST Service Failure (404 Not Found)

### Root Cause: WASM Filename Mismatch
The AST service attempts to load `tree-sitter.wasm` using the `web-tree-sitter` library.
- **Request**: `GET http://.../resources/tree-sitter.wasm`
- **Fact**: The asset in the `resources` directory is named `web-tree-sitter.wasm`.
- **Logic**: The `locateFile` function in `ast.service.ts` only maps `web-tree-sitter.wasm` to a specific location if that exact string is requested. When the library requests the generic `tree-sitter.wasm`, it fails.

## 3. Build Script Failure (Exit Code 1)

### Root Cause: Toolchain Validation
The `build.js` script fails during "Phase 1: Validating Toolchain". This usually happens because:
- The `node_modules` for the backend are missing or incomplete.
- The `clang` toolchain components expected by `toolchain.service.js` are not found in the development environment.

# Proposed Fixes

| Issue | Action |
| :--- | :--- |
| **Duplicate Startup** | Remove the backend extension from `neutralino.config.json` and rely solely on the frontend spawner. This provides better UI feedback and centralized control. |
| **WASM 404** | Rename `web-tree-sitter.wasm` to `tree-sitter.wasm` in the frontend `public` directory and update `ast.service.ts` to be more robust. |
| **Build Validation** | Relax toolchain validation in `build.js` when only packaging (if the binaries already exist) or ensure proper directory structure for the local toolchain. |
