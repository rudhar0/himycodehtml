# CodeViz Visualization Audit Report

## Executive Summary

This audit targets the **current** CodeViz visualization engine used by the main UI: `frontend/src/components/layout/CanvasPanel.tsx` → `frontend/src/components/canvas/VisualizationCanvas.tsx` (React + `react-konva` + Zustand stores + `LayoutEngine`).

The largest, cross-cutting root causes behind the reported failures are:

1. **Coordinate-system inconsistencies (absolute vs relative)** between `LayoutEngine` output and `VisualizationCanvas.renderElement()` nesting, producing drift and children “escaping” their containers.
2. **Header/body offset mismatches** (renderer subtracts hard-coded header offsets that don’t match component internals), making parent backgrounds appear not to grow and pushing children into unexpected world positions.
3. **Loop control desynchronization**:
   - `toggleMode` changes don’t trigger canvas re-layout (canvas does not subscribe to `useLoopStore()`).
   - loop “active” state is only synced opportunistically inside layout calculation and is not reconstructed on step jumps.
4. **Camera auto-focus forward-motion detection is broken by effect ordering**, so “moving forward” is often computed as false and focus doesn’t run.
5. **Layering/z-index control is ineffective** because many Konva node IDs include a `-step-*` suffix, while code searches by layout IDs; plus `zIndex()` is used as a “weight” rather than a sibling index.
6. **Performance scales poorly** due to per-step layout replay (`0..currentStep` every render) plus deep cloning/stringifying in the canvas and forced remounts via step-based React keys.

All recommended fixes below are **safe and non-architectural**: localized renderer/layout corrections, store subscription fixes, deterministic transforms/IDs, and low-risk perf improvements (no framework/library swaps, no Konva replacement, no Redux/Zustand removal).

## Rendering Pipeline Overview

### Active render path (ground truth)

- The visualization mounted in the main layout is `VisualizationCanvas` (not the legacy `KonvaWrapper`):
  - `frontend/src/components/layout/CanvasPanel.tsx` renders `<VisualizationCanvas />`.
- Legacy/parallel implementations exist in the repo and are a risk if mounted simultaneously:
  - `frontend/src/components/sidebar/KonvaWrapper.tsx`
  - `frontend/src/hooks/useExecutionTrace.ts`
  - `frontend/src/services/protocol-adapter.ts`

### End-to-end pipeline (socket → store → layout → Konva)

1. **Socket.io events**
   - `frontend/src/api/socket.service.ts` connects and forwards socket events to local listeners.
   - The main UI mounts `frontend/src/hooks/useSocket.ts` (via `frontend/src/App.tsx`), which subscribes to:
     - `code:trace:chunk` (buffers chunks)
     - `code:trace:complete` (finalizes trace)

2. **Trace normalization**
   - On `code:trace:complete`, `useSocket.ts` calls:
     - `frontend/src/engine/traceProcessor.ts` → `processRawTrace(receivedChunks, MAX_TRACE_STEPS)`
   - `processRawTrace()`:
     - flattens chunk payloads to a single ordered step list
     - expands `internalEvents` into steps
     - normalizes `eventType/type` and maps unknown types without silently collapsing to `line_execution`
     - accumulates a full `MemoryState` snapshot per step (via `structuredClone`)

3. **Trace → Zustand execution store**
   - `useExecutionStore.setTrace(trace)` (`frontend/src/store/slices/executionSlice.ts`) stores:
     - `executionTrace` (with `steps[]`)
     - `totalSteps`, `currentStep`, `currentState`
     - `needsCanvasRebuild = true` on set/jumps/backwards

4. **Step changes → layout recomputation**
   - `VisualizationCanvas.tsx` selects:
     - `executionTrace`, `currentStep`, and `getCurrentStep()` (for `state`)
   - Layout is computed via `useMemo`:
     - `LayoutEngine.calculateLayout(executionTrace, currentStep, width, height)` (`VisualizationCanvas.tsx:108-118`)
   - `LayoutEngine.calculateLayout()` clears internal caches and replays **all steps 0..currentStep** every render (`LayoutEngine.ts:415+`, `:452+`, `:470+`).

5. **Layout → visible layout → Konva nodes**
   - `visibleLayout` filters elements based on `birthStep/stepId <= currentStep`.
   - `renderElement(layoutElement)` maps each element to a React component backed by Konva nodes.
   - Konva Stage transform is controlled by Zustand canvas store:
     - `scaleX/scaleY = zoom`
     - `x/y = position` (`VisualizationCanvas.tsx:1212+`)

6. **Commit-time effects**
   - `VisualizationCanvas.tsx` runs effects that:
     - snapshot previous element data (deep cloning)
     - update “previous step”
     - attempt z-index ordering imperatively
     - tween camera focus by imperatively moving the Stage (Konva.Tween)

### Pipeline diagram (ASCII)

```
Backend trace stream
   │
   ▼
socket.service.ts (event forward)
   │
   ▼
useSocket.ts (buffer chunks; finalize on complete)
   │
   ▼
traceProcessor.ts (processRawTrace: normalize + MemoryState)
   │
   ▼
Zustand executionSlice (setTrace/currentStep/currentState)
   │
   ▼
VisualizationCanvas.tsx
  - fullLayout useMemo → LayoutEngine.calculateLayout()
  - visibleLayout filter
  - renderElement() → react-konva nodes
  - Stage transform from canvasSlice (zoom/position)
   │
   ▼
Konva draw (Stage/Layer/Groups)
```

### State mutation hotspots (risk points)

- Loop store writes inside layout calculation (side effects in compute stage):
  - `LayoutEngine.ts:1110+`, `:1206+`, `:1399+`
- Memoized layout object mutation in `handleInputSubmit()`:
  - `VisualizationCanvas.tsx:449+`
- Imperative stage tween while stage transform is also controlled declaratively by props/store:
  - `VisualizationCanvas.tsx:285+`, `:315+`, `:344+`
- Imperative `zIndex()` that likely doesn’t find any nodes due to ID mismatches:
  - `VisualizationCanvas.tsx:241-250`

## Parent Overflow & Layout Issues

### What “clipping” likely is in this system

Konva `Group`s **do not clip children by default**. In this codebase, most “clipping” reports map to one of:

1. **Viewport clipping**: the HTML container is `overflow: hidden` (`VisualizationCanvas.tsx` wrapper style) so content outside the viewport is clipped even if world coordinates are correct.
2. **Occlusion**: parent “background” rect is not the thing clipping; rather, later-drawn siblings overlap and visually hide parts of content.
3. **Bad coordinates**: children are rendered outside the parent background because of double transforms or mismatched body offsets (most common).

### Layout height growth vs render offsets

`LayoutEngine.updateContainerHeights()` tries to size containers to include children (`LayoutEngine.ts:1663+`). This is only correct if:

- child x/y are in the same coordinate system as the parent (world coordinates), and
- the render layer places children at those exact world coordinates.

In practice, container growth appears “broken” because renderer offsets and child coordinate systems do not match:

- Loop children are rendered with `relativeY = child.y - parent.y - SPACING.HEADER_HEIGHT` (40) (`VisualizationCanvas.tsx:928+`), but `LoopElement`’s header/body spacing is not 40 (header is 70 and body begins at `HEADER_HEIGHT + 10` in `LoopElement.tsx`).
- Struct/Class children subtract 40 (via `SPACING.HEADER_HEIGHT`) but body begins at 30 in `StructView.tsx`/`ClassView.tsx`.

This creates systematic drift where children appear too high/low relative to their parent background, which looks like “parent didn’t grow”.

### Fixed vs dynamic dimensions

- Stage `width/height` are fixed to the container bounds (`VisualizationCanvas.tsx:1212+`).
- The world can extend beyond viewport via stage `position` and `zoom`, but the *container* still clips out-of-viewport content.
- Layout uses fixed base widths for key containers (e.g., main/function width constants in `LayoutEngine.ts`), which is OK for MVP, but height must be consistent with how children are placed.

### Safe correction strategy

1. **Normalize header/body offsets** (renderer-side):
   - Define a single “body offset Y” per container type/subtype (FunctionElement 55, LoopElement 80, Struct/Class 30, Switch 35, Case 28, etc.) and use it for child wrapping everywhere.
2. **Ensure no render path uses “wrapper Group translate + render at absolute x/y”**:
   - This pattern doubles displacement and makes parent sizing look wrong.
3. **Use `LayoutEngine.validateLayout()` output** (already present) to confirm post-fix children fit within parents (dev mode).

## Child Hierarchy & Coordinate Problems

### Coordinate convention currently in use (mostly)

Most `LayoutElement` positions are treated as **world coordinates** (absolute) in `LayoutEngine` and are rendered directly into the Stage’s world space.

`VisualizationCanvas.renderElement()` then attempts to *also* support hierarchical nesting by:

- wrapping children in relative `<Group x={child.x - parent.x} y={child.y - parent.y - offset}>`
- passing `{...child, x: 0, y: 0}` into `renderElement()` (this is the correct pattern and is used in several cases)

However, this pattern is not applied consistently, and some layout nodes are created with “relative-ish” coordinates.

### High-confidence bug: double translation for global panel children

Global panel children are rendered as:

- `<Group key={child.id} x={child.x} y={child.y}> {renderElement(child)} </Group>` (`VisualizationCanvas.tsx:1355+`)

Because `renderElement(child)` typically renders its own Konva Group at `x={child.x}` / `y={child.y}`, this becomes **double translation**.

Expected consistent approach (as used elsewhere): translate once (relative wrapper), then render with child at (0,0).

### High-confidence bug: expanded loop iteration containers mix absolute/relative coordinates

When `toggleMode` is off (expanded mode), `LayoutEngine` creates an “iteration container”:

- `x: 20` (relative intent) (`LayoutEngine.ts:1185`)
- `y: this.getNextCursorY(loopElement)` (absolute in practice) (`LayoutEngine.ts:1186`)

Meanwhile, variables inside loops are positioned using the loop element’s absolute x and cursor y (even when pushed into the iteration container):

- var declare/assign paths use `x = loopElement.x + 20` and `y = getNextCursorY(loopElement)` (`LayoutEngine.ts:704+`, `:812+`)
- the variable is then pushed into `iterationElement.children` (`LayoutEngine.ts:746-747`, `:865-866`)

In render, iteration children are treated as absolute and converted to relative by subtraction (`VisualizationCanvas.tsx:894+`), but because the iteration container itself is partially relative, this yields drift (large incorrect relativeX/relativeY).

### Transform inheritance and “double displacement”

Any time both of these happen, drift will occur:

1. A wrapper `<Group x/y>` translates the coordinate system, **and**
2. The child component is still rendered at an absolute `x/y` rather than at `0/0`.

This is the dominant pattern behind “child elements rendering outside hierarchy”.

### Safe correction strategy

1. **Enforce world coordinates in layout**:
   - iteration containers must have absolute x/y (e.g., `x = loopElement.x + 20`, not `20`)
   - when in expanded mode, cursoring (`getNextCursorY`) should be based on the iteration container (not the loop container)
2. **Enforce relative rendering in the canvas**:
   - in every container case, render children via a single wrapper Group translation and then render the child at (0,0)
3. **Audit all container cases for correct body offsets** (see Parent/Layout section) to prevent systematic vertical drift.

## Loop Toggle & Skip Logic Failures

### Symptoms explained

- Toggle mode (“UPDATE” vs “CREATE”) changes the UI state but often does not change the canvas layout.
- Skip loop is disabled in the toolbar even when a loop is visibly active.
- Skip sometimes jumps to unexpected steps depending on whether the skip was triggered from the loop element vs the toolbar.

### Root causes

#### 1) Canvas is not reactive to loop toggle mode

`LayoutEngine` reads `toggleMode` from the loop store during layout computation:

- `useLoopStore.getState().toggleMode` (`LayoutEngine.ts:778+`, `:1175+`)

But `VisualizationCanvas.tsx` does not subscribe to `useLoopStore()` at all. Therefore:

- toggling `toggleMode` updates store
- `VisualizationCanvas` does not rerender
- `fullLayout` `useMemo` does not recompute

Result: “toggle not working” until some other state change causes rerender (step change, resize, etc.).

#### 2) Loop store “activeLoops” is not reconstructed on step jumps

Loop controls use `useLoopStore.getCurrentLoopInfo()` and `canSkipLoop()` to enable/disable skip (`frontend/src/components/controls/LoopControls.tsx`).

However, `loopSlice.activeLoops` is only mutated when layout sees certain loop events at the current step, via side effects inside layout calculation:

- `enterLoop(...)` (`LayoutEngine.ts:1110+`) only when `stepIndex === currentStep`
- `updateLoopIteration(...)` (`LayoutEngine.ts:1206+`) same condition
- `exitLoop(...)` (`LayoutEngine.ts:1399+`) same condition

If the user scrubs/jumps into the middle of a loop body, the current step may not be a `loop_start` event, so `activeLoops` remains empty even though the visualization shows loop containers.

#### 3) Skip uses two different data sources

- In-canvas skip button:
  - `LoopElement.onSkip()` calls `jumpToStep(data.endStep)` (`VisualizationCanvas.tsx:944+`)
  - depends on `loopElement.data.endStep` computed by a lookahead scan (`LayoutEngine.ts:1079+`)
- Toolbar skip:
  - `loopSlice.skipCurrentLoop()` depends on `activeLoops[].endStepIndex` (`loopSlice.ts`)
  - and uses a “skip 90% of remaining duration” heuristic rather than “jump to end”

These will diverge whenever loop store context is stale or missing.

### Safe correction strategies

1. **Make toggleMode part of the canvas inputs**:
   - subscribe to `toggleMode` in `VisualizationCanvas.tsx` and include it in layout memo dependencies.
2. **Make loop control state derived from `executionTrace + currentStep`**:
   - safest non-architectural option: compute “current loop context” in `LoopControls.tsx` by scanning nearby steps (or by using a precomputed map), rather than relying on layout side effects.
3. **Unify skip semantics**:
   - pick one behavior (jump-to-end vs jump-most-of-way) and ensure both in-canvas and toolbar share the same source-of-truth for `endStep`.
4. **Remove store writes from layout calculation**:
   - keep `LayoutEngine.calculateLayout()` pure and update loop store from a React effect after layout commit (prevents hard-to-debug desync).

## Camera & Transform Issues

### Current camera model (as coded)

- Stage transform is controlled by Zustand canvas store (`canvasSlice.ts`):
  - `zoom` → `Stage.scaleX/scaleY`
  - `position` → `Stage.x/y` (`VisualizationCanvas.tsx:1212+`)
- Mouse wheel zoom updates `zoom` and adjusts `position` to keep the pointer anchored (`VisualizationCanvas.tsx:389+`).
- Panning uses Konva stage dragging when `dragMode` is enabled, updating `position` on drag move/end (`VisualizationCanvas.tsx:1221+`).
- Auto-focus uses `getFocusPosition()` (world → stage position) and `Konva.Tween` to animate the stage.

### Correct coordinate flow (world vs screen)

In this setup, with Stage transform `(position, zoom)`:

- **World → Screen**: `screen = world * zoom + position`
- **Focus** wants to choose `position` so that a world-space target center maps to (roughly) the viewport center:
  - `position.x = viewportCenterX - targetCenterX * zoom`
  - `position.y = viewportCenterY - targetCenterY * zoom`

`getFocusPosition()` implements this form but with biased centers (0.4, 0.6) (`frontend/src/utils/camera.ts`).

### Why camera often “does not move”

`VisualizationCanvas.tsx` uses `prevStepRef.current` to decide whether we are “moving forward”:

- `prevStepRef.current = currentStep` is updated in an effect (`VisualizationCanvas.tsx:233`)
- the focus effect runs later and computes:
  - `movingForward = prevStepRef.current < currentStep` (`VisualizationCanvas.tsx:274`)

Because effects run in declaration order, `prevStepRef.current` has already been set to `currentStep` before the focus effect runs on the same commit, causing:

- `movingForward` to be **false**
- the focus candidate filter to ignore new elements (`VisualizationCanvas.tsx:299`)

This is a direct, mechanical explanation for “camera not moving correctly”.

### Additional risks: imperative tween + declarative transform

Auto-focus uses `new Konva.Tween({ node: stage, x, y, ... })` (`VisualizationCanvas.tsx:285+`, `:315+`, `:344+`), but Stage `x/y` are also controlled by React props from store. If React rerenders during the tween (wheel, drag, step effects), the tween and props can fight, producing snapping/jitter.

### Safe correction strategy

1. Fix previous-step tracking:
   - compute `movingForward` using a locally captured previous step (ref updated after focus), or update `prevStepRef` at the end of the focus effect.
2. Make focus a pure “store update”:
   - safest: compute target position and set store position directly (or tween a separate “camera position” state) rather than imperatively tweening the Stage node while also controlling it via props.
3. Decide whether biased centering (0.4/0.6) is intentional:
   - if yes, document and keep consistent; if no, default to true center (0.5/0.5).

## Infinite Canvas Behavior Analysis

### Why it feels bounded today

Even though the Stage can be panned without explicit clamping, the “infinite workspace” experience is limited by how the grid/background are drawn:

- The grid is generated only for the current viewport dimensions:
  - vertical lines: `0..dimensions.width`
  - horizontal lines: `0..dimensions.height` (`VisualizationCanvas.tsx:1236+`)
- As you pan away from the origin, you move off the pre-generated grid area and see empty space.

Additionally, the outer HTML container is `overflow: hidden`, so anything outside the viewport is clipped (this is correct for a viewport, but it amplifies the “bounded” feeling if camera/pan/focus is inconsistent).

### How “infinite canvas” should behave (conceptually)

- World space is unbounded.
- Viewport is bounded.
- Background/grid should be rendered based on the **current viewport bounds in world space**, not fixed at the origin.

### Safe fix strategy (no framework changes)

1. Compute the visible world bounds using the current stage transform:
   - `worldLeft = -position.x / zoom`
   - `worldTop  = -position.y / zoom`
   - `worldRight = worldLeft + viewportWidth/zoom`
   - `worldBottom = worldTop + viewportHeight/zoom`
2. Render grid lines for a padded world range `[worldLeft - pad, worldRight + pad]` and similarly for Y.
3. Keep the number of lines proportional to viewport size (constant-time per frame) rather than proportional to pan distance.

## Layering & Z-Index Problems

### What’s happening today

Layering in Konva is primarily determined by:

1. **Which `Layer` a node is in**, then
2. **Sibling order within that layer**, then
3. Any explicit reordering calls (`moveToTop`, `zIndex`, etc.).

In `VisualizationCanvas.tsx`, most elements are rendered into a single `<Layer ref={layerRef}>`, so sibling order is dominated by React render order and mount/remount behavior.

### High-confidence issues

1. **Node ID mismatch breaks imperative ordering**
   - Many components set Konva IDs as `${id}-step-${stepNumber || 0}`:
     - `frontend/src/components/canvas/elements/FunctionElement.tsx:217`
     - `frontend/src/components/canvas/elements/LoopElement.tsx:246`
     - `frontend/src/components/canvas/elements/VariableBox.tsx:329`
     - `frontend/src/components/canvas/elements/ConditionElement.tsx:237`
   - The z-index effect looks up nodes by `el.id` (layout id) (`VisualizationCanvas.tsx:241-248`), so it likely finds nothing.

2. **Konva `zIndex()` is misused as a “z weight”**
   - Code computes `zIndex = BASE_FUNCTION_Z + stackIndex*STACK_Z_STEP` (`VisualizationCanvas.tsx:245`) as if it were a z-depth.
   - In Konva, `zIndex` is the child index among siblings; large values are not meaningful when there are fewer siblings, and repeated calls can scramble ordering.

3. **Step-based React keys destabilize ordering**
   - Many nodes use `key={`${id}-${stepId}`}` which encourages remounts across step changes, changing insertion order and therefore draw order.

### Safe correction strategy

1. **Stabilize Konva IDs**
   - Use the layout element `id` as the Konva node `id` (no step suffix).
   - If step needs to be represented, use `name`, metadata, or a separate attribute instead.
2. **Stabilize keys**
   - Use `key={id}` for persistent elements; use flags (`isNew/isUpdated`) to drive animations rather than remounts.
3. **Prefer declarative layering**
   - If overlays must always be on top, render them later in the JSX (or put them in their own Konva `Layer`).
4. **If imperative ordering is required**
   - Apply a single deterministic ordering pass once per layout commit (e.g., “function_call frames sorted by stackIndex”), using `moveToTop()` or stable `zIndex()` indices based on a sorted list, not weighted numbers.

## Performance Bottlenecks

### Primary bottleneck: layout replay per step

`LayoutEngine.calculateLayout()` replays **all steps from 0 to `currentStep`** every time the layout is computed (`LayoutEngine.ts:470+`). It also clears and rebuilds internal maps every time (`LayoutEngine.ts:452+`).

Implications:

- Per-render cost is O(currentStep).
- Stepping sequentially through N steps trends toward O(N²) total work over a session.
- Jumping to step N is O(N) even if the user only wants the final layout.

### Secondary bottlenecks: deep cloning + deep comparisons in the canvas

`VisualizationCanvas.tsx` performs expensive work per commit:

- Snapshot previous element data:
  - clones `el.data` via `structuredClone` for each visible element (`VisualizationCanvas.tsx:217+`)
- Detect “updated” elements:
  - compares `JSON.stringify(prev.data)` vs `JSON.stringify(element.data)` for each element (`VisualizationCanvas.tsx:173-200`)

Both scale with the number of elements on screen and the size of their `data` payloads.

### Konva node churn

Step-based keys (`key={`${id}-${stepId}`}`) cause remounts across steps, which:

- increases React work
- creates/destroys Konva nodes
- disrupts z-order
- can cause animation resets that look like drift

### Safe optimization ladder (incremental)

1. **Stop forcing remounts** where not needed:
   - prefer `key={id}` for stable identity
2. **Replace deep stringify diffs**:
   - compare only relevant fields, or add a cheap `dataVersion`/`updatedAtStep` on layout elements
3. **Reduce cloning volume**:
   - snapshot only fields needed for animation decisions, not entire `data` objects
4. **Avoid redundant imperative redraw calls**:
   - only call `layer.batchDraw()` when actual ordering changes occur
5. **Memoize layout by step (optional, still non-architectural)**
   - cache `Layout` per `(currentStep, viewport dims, toggleMode)`; invalidate on trace reload or toggle changes

## Redux & Socket Synchronization Risks

### “Redux store” vs actual implementation

The active visualization pipeline uses **Zustand** stores (`frontend/src/store/slices/*`), not Redux. A Redux Toolkit slice exists (`frontend/src/store/debugSlice.ts`), but it is not part of the primary `VisualizationCanvas` pipeline described here.

This matters because:

- the renderer and layout engine assume they can imperatively read/write store state via `useXStore.getState()`
- mixing Redux and Zustand concepts can lead to false assumptions about reactivity and selector-driven renders

### Multiple trace ingestion paths (race/desync risk)

The repo contains multiple ways to ingest traces:

- Active: `frontend/src/hooks/useSocket.ts` (mounted by `frontend/src/App.tsx`)
- Also present:
  - `frontend/src/hooks/useExecutionTrace.ts` subscribes to trace events and calls `setTrace()` on chunk arrival
  - `frontend/src/services/protocol-adapter.ts` listens to trace events and re-emits step updates

If more than one of these is mounted, symptoms can include:

- duplicate `setTrace()` calls
- currentStep resets mid-session
- inconsistent step counts and “laggy” recomputes due to duplicate work

### Store writes during layout calculation

`LayoutEngine.calculateLayout()` writes to `loopSlice` during layout replay (`LayoutEngine.ts:1110+`, `:1206+`, `:1399+`). This is a synchronization hazard because:

- layout may be recomputed for reasons unrelated to stepping (resize, theme changes, etc.)
- loop store may update out of phase with the actual displayed step (especially on jumps)
- loop controls can become stale or incorrect

### Safe mitigation

1. Ensure only one trace ingestion pathway is used in production UI (prefer `useSocket.ts`).
2. Make loop-control state derived from `executionTrace + currentStep` and updated deterministically from a React effect (not inside layout compute).
3. Avoid mutating memoized layout objects in event handlers; treat layout as immutable output and store interactive state elsewhere (execution store or local state).

## Root Causes vs Symptoms Table

| Symptom (reported) | Most likely root cause(s) | Evidence (file:line) | Safe fix direction |
|---|---|---|---|
| Parent containers not growing / clipping | Header/body offset mismatches + coordinate drift; viewport `overflow:hidden` | `VisualizationCanvas.tsx:1090`, `LoopElement.tsx` header/body, `StructView.tsx` body | Unify body offsets; normalize child rendering; confirm occlusion vs true clipping |
| Children render outside hierarchy | Double translation in renderer; mixed absolute/relative in layout (iteration) | `VisualizationCanvas.tsx:1355+`, `LayoutEngine.ts:1185-1186` | Render children via relative wrapper + `{x:0,y:0}`; enforce absolute world coords in layout |
| Loop toggle not working | Canvas not subscribed to `toggleMode` | `LayoutEngine.ts:778+`, no `useLoopStore()` in `VisualizationCanvas.tsx` | Subscribe to `toggleMode` in canvas; include in layout memo deps |
| Skip/expand/loop UI inconsistent | Loop store not reconstructed on jumps; store updates only at stepIndex==currentStep | `LayoutEngine.ts:1110+`, `loopSlice.ts` | Derive loop context from trace+step or sync deterministically after layout |
| Camera not moving correctly | prevStepRef updated before focus effect; movingForward false | `VisualizationCanvas.tsx:233` then `:274` | Update prev ref after focus; compute movingForward from captured previous |
| Infinite canvas feels limited | Grid drawn only for current viewport size | `VisualizationCanvas.tsx:1236+` | Grid based on viewport world bounds; render repeating grid tiles |
| Layering issues (nodes above overlays) | Node ID mismatch breaks ordering; `zIndex()` misuse; remount churn | `FunctionElement.tsx:217`, `VisualizationCanvas.tsx:241-250` | Stable IDs/keys; declarative ordering; separate layers if needed |
| Rendering drift / inconsistencies | Mixed coordinate conventions + hard-coded offsets + remount keys | `LayoutEngine.ts` iteration coords, `VisualizationCanvas.tsx` per-type offsets | Enforce world coords; centralize offsets; use stable keys |
| Slow rendering & step lag | O(step) layout replay + deep clone/stringify per commit + remount churn | `LayoutEngine.ts:470+`, `VisualizationCanvas.tsx:173+`, `:217+` | Reduce remounts; replace stringify diffs; reduce cloning; optional step cache |

## Safe Fix Strategies (Non-architectural)

Below are safe, incremental fixes that address root causes without changing the overall architecture.

1. **Fix camera forward-motion detection**
   - Change: update `prevStepRef` after the focus effect uses it (or compute from a local captured previous step).
   - Why: fixes “camera doesn’t move” directly.
   - Risk: low.
   - Validate: step forward through a trace and confirm focus triggers on new elements; step backward should not trigger forward-focus rules.

2. **Make loop toggle reactive in the canvas**
   - Change: subscribe to `useLoopStore((s) => s.toggleMode)` in `VisualizationCanvas.tsx` and include it in `fullLayout` `useMemo` deps.
   - Why: fixes “toggle doesn’t work until I step”.
   - Risk: low.
   - Validate: toggle during an active loop without stepping; confirm expanded vs collapsed behavior changes immediately.

3. **Remove any “double translate” render patterns**
   - Change: do not wrap a child in `<Group x={child.x} y={child.y}>` and also render it at `x={child.x} y={child.y}` inside `renderElement()`.
   - Why: removes the most direct cause of hierarchy breaks.
   - Risk: low-medium.
   - Validate: global panel children, switch/case children, and any special panels.

4. **Centralize body/header offsets**
   - Change: replace hard-coded `-40`, `-55`, `-25`, etc. with a single per-element-type body offset map used consistently.
   - Why: prevents systemic drift and “parent background not containing children”.
   - Risk: medium (touches many element cases).
   - Validate: loop containers, function frames, struct/class, condition/switch/case.

5. **Fix expanded loop iteration layout coordinates**
   - Change: make iteration container x/y absolute (world coordinates) and place children using the iteration container’s cursor, not the loop container’s cursor.
   - Why: fixes expanded-mode drift and out-of-container rendering.
   - Risk: medium.
   - Validate: expanded mode on a 3–5 iteration loop; verify children remain inside loop and iteration separators stack correctly.

6. **Stabilize Konva node IDs + React keys**
   - Change: use layout `id` as Konva node `id` (no `-step-*` suffix), and prefer `key={id}` for stable identity.
   - Why: restores `findOne()` targeting, enables deterministic ordering, and reduces remount churn.
   - Risk: medium (animations relying on remount may need adjustment).
   - Validate: z-order logic, highlight/update animations, and absence of duplicate IDs on screen.

7. **Reduce per-step deep cloning and stringify diffs**
   - Change: avoid `JSON.stringify` diffing for all elements; snapshot only necessary fields; consider a cheap `updatedAtStep` marker.
   - Why: reduces lag on large traces.
   - Risk: low-medium (must preserve “updated” detection correctness).
   - Validate: profiling on 300–1000 steps; confirm updated elements still highlight/focus properly.

8. **Remove store updates from `LayoutEngine.calculateLayout()`**
   - Change: move loop store synchronization into a React effect that runs after layout is computed, or derive loop context directly from trace+step in controls.
   - Why: reduces desync and prevents compute-stage side effects.
   - Risk: medium.
   - Validate: scrub/jump into loops and confirm toolbar skip state remains correct.

## Debugging Checklist

Use this checklist to confirm root causes and validate fixes safely.

1. **Confirm which visualization implementation is mounted**
   - Verify `CanvasPanel.tsx` is rendering `VisualizationCanvas.tsx`.
   - Ensure legacy `KonvaWrapper.tsx` is not mounted in the same screen.

2. **Log Stage transform per step**
   - On step changes, log `stage.x()`, `stage.y()`, `stage.scaleX()` and the store’s `position/zoom`.
   - Confirm Stage props reflect the store and don’t fight with tweens.

3. **Detect double translation**
   - Pick a visible element and temporarily render its x/y as on-canvas text.
   - If an element’s displayed position is roughly 2× its layout x/y, a wrapper Group is translating and the child still renders at absolute x/y.

4. **Validate header/body offsets**
   - For each container type (function/loop/struct/class/switch/case), confirm:
     - background header height in the component
     - body start Y in the component
     - renderer’s subtraction offset for child positioning
   - Any mismatch should be treated as a drift bug.

5. **Use `LayoutEngine.validateLayout()` warnings**
   - Run in dev mode and watch for “child exceeds parent” warnings (`LayoutEngine.ts:1610+`).
   - Correlate warnings to on-screen overflow/occlusion.

6. **Repro loop UI desync**
   - Scrub into the middle of a loop (TimelineScrubber).
   - Confirm whether toolbar loop controls reflect loop activity; if not, loop context is not derived correctly.

7. **Perf profiling**
   - Measure:
     - time in `LayoutEngine.calculateLayout()`
     - time in `elementAnimationStates` building
     - number of mounted Konva nodes per step
   - Large spikes usually indicate layout replay or deep stringify/clone.

## Refactor Priority Plan

This is an ordered plan that keeps the architecture intact but stabilizes correctness first, then performance.

1. **Correctness: camera + toggle**
   - Fix `prevStepRef`/focus effect ordering (camera movement).
   - Subscribe to `toggleMode` in `VisualizationCanvas` so expanded/collapsed loops update immediately.

2. **Correctness: coordinate unification**
   - Eliminate double translation render paths (global panel and any others).
   - Make iteration container coordinates fully world-absolute and route loop children placement to the correct parent (iteration vs loop).
   - Centralize body offsets per container type/subtype; remove scattered hard-coded offsets.

3. **Stability: IDs, keys, layering**
   - Remove `-step-*` suffixing from Konva node `id` (use stable layout IDs).
   - Switch to stable React keys where remount is not explicitly required.
   - Replace ineffective `zIndex()` effect with deterministic declarative ordering (or separate layers if needed).

4. **Performance: reduce per-step work**
   - Remove `JSON.stringify` diffing for all elements; use explicit update signals or targeted comparisons.
   - Reduce cloning volume in previous-state snapshots.
   - If still needed, add a simple per-step layout cache keyed by `(step, viewport, toggleMode)` and invalidate on trace reload.
