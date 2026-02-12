# FRONTEND AUDIT REPORT

## 1️⃣ Full Folder Structure Map (frontend/src)

| Folder | Purpose | Status |
| :--- | :--- | :--- |
| `adapters/` | Transforms backend step types to frontend actions. | **CRITICAL** |
| `animations/` | GSAP-based animation engine and sequence managers. | **LEGACY / PARTIAL** |
| `api/` | Real implementations of Socket.io and Axios services. | **CRITICAL** |
| `assets/` | Static media assets. | **SAFE** |
| `canvas/` | Original attempt at canvas managers. Not used by current UI. | **SAFE TO DELETE** |
| `components/canvas/` | Active visualization engine (Konva components + Layout). | **CRITICAL** |
| `components/editor/` | Monaco Editor integration and file loaders. | **CRITICAL** |
| `components/layout/` | Main application shell, panels, and splitters. | **CRITICAL** |
| `config/` | Environment and component-specific configurations. | **CRITICAL** |
| `constants/` | Shared enums, event names, and default values. | **CRITICAL** |
| `hooks/` | Business logic hooks (useSocket, useAnimationController). | **CRITICAL** |
| `services/` | Wrappers around `src/api` for compatibility. | **DUPLICATE** |
| `store/` | Zustand stores/slices for state management. | **CRITICAL** |
| `types/` | TypeScript interfaces and type definitions. | **CRITICAL** |
| `utils/` | Shared helper functions and camera math. | **CRITICAL / REFACTOR** |

> [!WARNING]
> **Duplicate Services**: The `src/services` folder currently contains re-exports of `src/api`. This creates confusion in imports.
> **Dead Canvas Logic**: `src/canvas/Managers/CanvasStateManager.ts` and its related files are never instantiated in the current `VisualizationCanvas.tsx` pipeline.

## 2️⃣ Import Graph & Dependency Flow

### Core Data Flow
1. **Entry**: `main.tsx` calls `__NEUTRALA_BOOTSTRAP__` (from `neutrala-bootstrap.js`) to resolve Backend URL.
2. **Bootstrap**: Sets `globalThis.__NEUTRALA_API_URL` and `socketUrl`.
3. **Mount**: `App.tsx` calls `useSocket.connect()`.
4. **Ingestion**: `socketService` receives `code:trace:chunk` events.
5. **Normalization**: `useSocket.ts` performs heavy normalization (cloning, type mapping, memory state reconstruction).
6. **State**: `executionSlice.ts` stores the `executionTrace`.
7. **Playback**: `executionSlice` uses a `setInterval` to advance `currentStep`.
8. **Visualization**: `VisualizationCanvas.tsx` detects `currentStep` change.
9. **Layout**: `LayoutEngine.ts` RECALCULATES the entire layout up to `currentStep`.
10. **Render**: `react-konva` components (`VariableBox`, `StackFrame`) render the layout elements.
11. **Local Animation**: `VariableBox.tsx` triggers a `Konva.Tween` entry animation if `isNew` is true.

### Mutation Points
- **Normalization Point**: `useSocket.ts` is the primary place where raw backend data is mutated into frontend-friendly structures.
- **Animation Point**: `useAnimationController.ts` exists but seems detached from the actual Konva rendering in `VisualizationCanvas.tsx`, leading to "animation fail" symptoms (race conditions between GSAP and React state).

## 3️⃣ Dead Code Detection

| File / Component | Recommendation | Reasoning |
| :--- | :--- | :--- |
| `src/gcc.service.js` | **SAFE_DELETE** | Replaced by backend API calls. |
| `src/services/api.service.ts` | **SAFE_DELETE** | Empty file. |
| `src/services/socket.service.ts` | **SAFE_DELETE** | Simple re-export. Point imports to `src/api`. |
| `src/canvas/managers/*` | **SAFE_DELETE** | Entire directory is unused by the `LayoutEngine` pipeline. |
| `src/canvas/core/*` | **SAFE_DELETE** | Base classes for unused managers. |
| `src/store/debugSlice.ts` | **REVIEW_REQUIRED** | Check if internal debug tools still use this. |

## 4️⃣ Step Processing Pipeline Audit

### Trace Flow
`Raw Socket Event` → `useSocket.ts` (Normalization) → `Redux (executionSlice)` → `LayoutEngine (calculateLayout)` → `VisualizationCanvas (Render)`

### Identified Issues
- **Unsupported Step Types**: Many backend types (like `pointer_deref`, `heap_free`) are normalized to `line_execution` or `var`, losing semantic depth in the visualization.
- **Missing Animation Handlers**: The `AnimationEngine.ts` is almost entirely bypassed by `VisualizationCanvas.tsx` which uses local `useEffect` tweens.
- **Step Data Shape Mismatch**: Backend sends `addr`, frontend expects `address`. Backend sends `eventType`, frontend expects `type`. Normalization is reactive and brittle.
- **Silent Fallbacks**: `normalizeStepType` defaults to `line_execution` for unknown types, masking backend instrumentation bugs.

> [!IMPORTANT]
> **Why Animation Fails**: The system is fighting itself. `LayoutEngine` is a **stateless** re-calculation of the world, while `Konva` animations are **stateful** transitions. When `LayoutEngine` shifts an element by 1 pixel due to a new neighbor, it breaks the ongoing GSAP transition which doesn't know about the LayoutEngine's decision.

## 5️⃣ Performance Audit

| Issue | Severity | Impact |
| :--- | :--- | :--- |
| **Linear Layout Re-calculation** | **CRITICAL** | O(N) calculation per frame where N = current step index. Large traces will lag severely. |
| **Excess Redux Re-renders** | **HIGH** | `VisualizationCanvas` listens to the entire `executionTrace` object. Any slice update triggers a full heavy re-parse. |
| **JSON.parse/stringify Loops** | **MEDIUM** | In `useSocket.ts` and `LayoutEngine.ts`, deep cloning steps per frame kills GC performance. |
| **Unmemoized Selectors** | **MEDIUM** | `getCurrentStep` in `VisualizationCanvas` is a function call on every render. |
| **Heavy Console Logging** | **LOW** | Thousands of `[Step X] Type: ...` logs saturate the devtools buffer. |

## 6️⃣ Neutralino Integration Check

- **Bootstrap**: `neutrala-bootstrap.js` correctly handles port detection via `.runtime/port.json`.
- **URL Injection**: `window.__NEUTRALA_API_URL` is used correctly in `api.config.ts`.
- **Mode Switching**: The system handles both `file://` (packaged) and `http://` (dev) transparently.
- **API Base URL**: Injected during `main.tsx` before React mount. This is safe.

## 7️⃣ Cleanup Plan (Phased)

### LEVEL 1 – Immediate Safe Deletes
- Remove `src/canvas/` entirely.
- Remove `src/gcc.service.js`.
- Remove `src/services/api.service.ts`.
- Update all imports of `socketService` to `@api/socket.service`.

### LEVEL 2 – Architecture Simplification
- Consolidate `useSocket.ts` normalization into a separate `TraceProcessor.ts` worker.
- Move `LayoutEngine.ts` to `src/engine/layout/`.

### LEVEL 3 – State Refactor
- Implement **Incremental Layout Update**. Instead of recalculating 1..N, calculate only the delta for step N against step N-1.
- Move `executionTrace` out of the main reactive loop; keep a reference and only react to `currentStep`.

### LEVEL 4 – Performance Optimization
- Replace `JSON.parse(JSON.stringify)` with a shallow merge or specific cloner for step metadata.
- Implement `requestAnimationFrame` batching for `LayoutEngine`.

## 8️⃣ Relation / Position / Camera Architecture Plan

### Proposed Files (`src/engine/`)
- `relation.ts`: Maintains an Element Tree. Tracks which `Variable` belongs to which `StackFrame`. Handles "Pointer → Variable" links.
- `position.ts`: Takes the `Relation` tree and produces X/Y coordinates. This is the **Layout Engine**.
- `camera.ts`: Manages the viewport. Handles `lerp` transitions between focus points.

### Why the current system fails
The current `LayoutEngine` tries to do all three in a single 1600-line file. It calculates relations (who is parent) at the same time it calculates pixels. 

### Integration
1. `Redux` sends "Step Forward".
2. `RelationManager` updates the Logical Tree.
3. `PositionManager` updates the coordinate map.
4. `CameraManager` calculates the target focus.
5. `VisualizationCanvas` simply looks up `PositionManager.get(elementId)`.

## 9️⃣ Optimization Strategy for Demo (2 Days Left)

1. **Fake the "Smoothness"**: Use `Konva.Easings.StrongEaseOut` for ALL variable updates. It covers up jitter.
2. **Limit Trace Size**: Hard-limit backend to 500 steps. This avoids the `O(N)` layout lag.
3. **Disable Heavy Logs**: Comment out all `console.log` in `useSocket.ts` and `LayoutEngine.ts`.
4. **Stabilize Step IDs**: Ensure `id` for elements is fixed to `var-${address}`. Do not use `step.id` as part of the element ID if the element persists across steps.

---

**FINAL ARCHITECTURE RISK SCORE: 8/10** (High risk of lag and jitter on medium traces)
**DEMO READINESS SCORE: 6/10** (Functionally working, but visually unstable under load)
