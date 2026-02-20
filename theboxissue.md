# Architectural Audit & Diagnostic Report: Variable Initializers Rendering "Above" + Inconsistent Stacking/Growth

Target symptoms (as observed)
- Loop children overlap or drift horizontally.
- Variable initializer boxes sometimes render above other elements.
- Parent loop/function containers do not expand correctly.
- Some elements appear out of stacking order.
- Layout sometimes shifts during animations.

Scope of this report
- This is an **architectural audit + diagnostic analysis only**. No code changes or fixes are applied here.
- Codepaths audited: `frontend/src/components/canvas/layout/LayoutEngine.ts` -> `frontend/src/components/canvas/VisualizationCanvas.tsx` -> Konva elements in `frontend/src/components/canvas/elements/*` plus measurement utilities in `frontend/src/components/canvas/utils/resizeContainer.ts`.

---

## Summary
The "initializer renders above" and "stacking/growth inconsistent" issues are primarily produced by **layout cursor accounting gaps** and secondarily amplified by **Konva draw-order rules** and **measurement/animation timing**:

1) **Layout cursor does not advance for many step types** (including `var_assign` and `output`) in `LayoutEngine`. As a result, multiple elements get the same `y` (or later elements get a `y` that is *behind* what is already on screen), which visually presents as "jumping above" or "out of order".

2) **Loop containers don't advance the parent frame's lane cursor** due to a logic trap in `loop_start`, and `loop_end` never reconciles the parent's cursor to the loop's final height. After a loop completes, new elements can be placed at an older cursor position (higher up), appearing above previous content.

3) **React-Konva draw order is array/JSX order**, not `y` order. When two items overlap (same or close coordinates), the one rendered later appears "on top". Because `LayoutEngine` sorts children by step and `renderElement()` maps in array order, a later initializer can cover earlier boxes.

4) **Variable "declaration vs initializer" duplication is not reliably filtered**, so both boxes can remain visible. A key mismatch exists: `LayoutEngine` uses an empty string placeholder for declared values, while the renderer's duplicate filter looks for `undefined`.

5) **Container "growth" is computed two different ways** (LayoutEngine's own height math + imperative Konva resizing + some elements' internal `autoSize` state). During entrance animations (scale/opacity/y tweens), measurement may be skipped or may resize imperatively without synchronizing state, causing parents to "snap", appear too small, or revert on later re-renders.

---

## Root Causes

### RC1 - Lane/cursor accounting is incomplete (LayoutEngine)
In `frontend/src/components/canvas/layout/LayoutEngine.ts`, frames use lane-based positioning:
- `getNextCursorY(parent)` returns `parent.y + lanes.LOCALS.startY + lanes.LOCALS.usedHeight` whenever `parent.metadata.lanes` exists.
- `updateContainerHeights()` uses the **lane totals** (HEADER + PARAMS + LOCALS + RETURN) to size lane-aware parents, rather than scanning actual child bounds.

However, lane height increments are only applied for a small subset of element types:
- Lane increments exist for: `var_declare`, `call_site`, `function_return`, `conditional_start` (switch), and (intended) `loop_start`.
- Lane increments do **not** exist for: `var_assign` / `var_load`, `output`, `pointer_alias`, array reference creation (`array_create` / `array_declaration`), and several other event types.

Consequences
- **Overlaps / "render above"**: multiple children can share the same `y` because the cursor never moved.
- **Parents don't grow (layout-side)**: `updateContainerHeights()` trusts lane totals; if lane totals are wrong, parent `height` is wrong even if children visually exist.

### RC2 - Loop start never advances the parent lane (logic trap)
In `loop_start`, `activeLoops.set(loopId, ...)` is executed **before** the code checks whether we're "already in a loop":
- Immediately afterward, `getActiveLoopForFrame(frameId)` will find the loop that was just added (same `parentFrameId`).
- This makes the "only if not nested" check evaluate as nested **even for the first loop**, preventing `lane.usedHeight += loopElement.height + spacing` from ever running in typical cases.

Consequences
- The loop container is inserted into `ownerFrame.children`, but **the owner's lane cursor does not advance**.
- Post-loop elements can reuse the same cursor slot and appear "above" or overlapping the loop block.

### RC3 - Loop end does not reconcile parent cursor
`loop_end` marks loop completion and deletes the loop from `activeLoops`, but does not adjust the parent frame's lane cursor to account for the loop's final expanded height.

Consequences
- Anything laid out after a loop can be placed at a `y` that is effectively "pre-loop", creating the strongest form of the "initializer box appears above earlier elements" symptom.

### RC4 - Declaration vs initializer boxes are not reconciled consistently
Two overlapping mechanisms exist:
- Layout-side: `var_declare` creates `var-${frameId}-${name}-${stepIndex}` and increments lane. `var_assign` creates **another** `var-${frameId}-${name}-${stepIndex}` (different stepIndex) and does **not** increment lane.
- Render-side: `VisualizationCanvas.tsx` has `filterChildren()` that tries to remove duplicates when a "no-value box" and a "value box" are created in the same step.

Problem: In `LayoutEngine`, a declared variable uses `value: ""` (empty string), not `undefined`. The renderer's filter checks for `current.data?.value === undefined`, so the filter does not match the layout's "declared placeholder" representation.

Consequences
- Both boxes remain visible, and if the cursor is stale they can overlap.
- Even when they don't overlap, they can contribute to the perception of "double insertion" and inconsistent stacking.

### RC5 - Renderer draw order guarantees "wrong-looking" stacking when overlaps exist
Konva does not sort by `y`. It draws in tree order:
- Within a `Layer`, later JSX nodes are drawn later (visually on top).
- Within a parent element, children are mapped in the order returned by `filterChildren(children).map(...)`.
- `LayoutEngine.updateContainerHeights()` sorts child arrays by step (ascending), which makes later steps appear later in the array and therefore "on top" in overlaps.

Additionally, top-level rendering order in `VisualizationCanvas.tsx` is fixed:
1) main frame (`visibleLayout.mainFunction`)
2) function call frames (`visibleLayout.elements.filter(type==="function_call")`, sorted by `metadata.stackIndex`)
3) function call arrows
4) array panel
5) global panel
6) update arrows and array reference arrows

Consequences
- Any overlap between these groups will look like "stacking order is wrong" even when coordinates are "correct", because the z-order is chosen by render sequence, not spatial intent.

### RC6 - Parent growth uses mixed declarative + imperative sizing, with animation-time measurement gaps
Several container components both:
- accept `width/height` from layout, and
- call `resizeContainer()` (imperative mutation of Konva Rect sizes), and/or
- maintain their own `autoSize` React state based on `getClientRect()`.

Patterns found:
- `StackFrame.tsx` renders `<Rect name="main-bg" height={Math.max(height,80)} .../>` and also calls `resizeContainer(node, ...)` imperatively.
- `FunctionElement.tsx`, `LoopElement.tsx`, `ConditionElement.tsx` keep `autoSize` state (`totalWidth/totalHeight`) **and** call `resizeContainer(group, ...)` in animation `onFinish`.
- Measurement callbacks (`measureContent`) explicitly skip while `group.scaleX/scaleY < 0.05` (common during entrance animation), so `autoSize` may not update on first paint.

Consequences
- If an imperative resize happens but `autoSize` state doesn't update, a later re-render can revert `main-bg` to the stale `totalWidth/totalHeight` coming from state.
- Debounced `resizeAllContainers()` in `VisualizationCanvas.tsx` can resize slightly after layout changes, creating visible "snaps".
- Camera focus tweens (`new Konva.Tween({ node: stage, x, y })`) can make these snaps feel like global layout shifts.

---

## Why Initializers Appear Above Elements
This is not (primarily) a "Konva bug". It is a predictable outcome of **stale cursor + deterministic draw order**.

### The dominant mechanism: stale lane cursor makes `y` go "backwards"
Example scenario (common in traces):
1) A loop starts (`loop_start`) and is inserted into a frame's LOCALS lane, but the parent lane cursor is not advanced (RC2).
2) Many elements are rendered "inside" the loop container (variables, iterations), so visually the loop grows downward.
3) The loop ends (`loop_end`), but the parent lane cursor is not reconciled (RC3).
4) A variable initializer occurs after the loop (`var_assign`), and its `y` is computed from `getNextCursorY(ownerFrame)` which still points to the pre-loop cursor.

Result
- The initializer's absolute `y` can be **higher than content already visible**, so it appears "above" earlier elements in the frame.

### The overlap mechanism: cursor never advances for `var_assign` / `output`
Within the same frame (outside loops too):
- `var_assign` inserts a variable element at `getNextCursorY(ownerFrame)` but does not increment the lane cursor afterward.
- `output` inserts an element at `getNextCursorY(ownerFrame)` but does not increment the lane cursor afterward.

Result
- Multiple elements land on the same `y`. Whichever is rendered later in the children array is drawn "on top" (Konva order), so initializer boxes can visually cover outputs or prior boxes.

### The duplication mechanism: declaration + initializer both remain visible
Because the renderer's duplicate filter expects `undefined` but declarations use `""`, both the declared box and initialized box can remain.

Result
- "Initializer box" can look like it is "jumping above" because it is a second box, drawn later, and may overlap if cursor accounting is stale.

---

## Cursor Flow Issues

### Multiple cursor systems are used inconsistently
There are two competing vertical-flow strategies in `LayoutEngine`:
1) **Lane-based** (`metadata.lanes.LOCALS.usedHeight`), used for frames like `main` and `function_call`.
2) **Last-child based** (fallback in `getNextCursorY()` when no lanes exist).

When these interact (e.g., loops inside lane-based frames), any missed lane increments become "cursor resets" at boundaries:
- Inside the loop, stacking appears to work because the loop container uses the last-child strategy.
- Outside the loop, the parent frame reverts to the lane strategy, which never advanced to account for the loop's growth.

### "Cursor reset" moments to watch (high probability)
- Immediately after `loop_end` for a loop that contains any significant content.
- After any `output` event (since it doesn't advance the lane).
- After any `var_assign` that is rendered as a new element (since it doesn't advance the lane).
- After pointer/array events that insert visible elements but don't advance the lane.

### Parent selection is inconsistent across step types (drift risk)
Some step types are loop-aware (variables), while others are not (e.g., `output`):
- Loop-aware steps choose `parentId` as the active loop container / iteration container.
- Non-loop-aware steps attach to the frame, even if they occurred during a loop iteration.

Impact
- The same runtime "block" can render partly inside a loop box and partly outside it, causing perceived horizontal drift and broken vertical stacking.

---

## Render Order Issues

### Konva draw order is structural, not spatial
- Later siblings in a `Layer` draw on top of earlier siblings.
- Later children in a `Group` draw on top of earlier children.

Therefore, any coordinate overlap becomes a z-order problem:
- "Initializer above" often means "initializer rendered later at the same `y`".

### No pre-render spatial sorting exists
In `VisualizationCanvas.tsx`, children are rendered in their array order; there is no sort by `y` before rendering. The only explicit sort observed is for top-level function frames, sorted by `metadata.stackIndex`.

### Keys/IDs amplify remount and ordering effects
`LayoutEngine` assigns IDs with step suffixes for many elements (`...-${stepIndex}`), and `VisualizationCanvas` uses `key={id}`.

Impact
- Boxes representing "the same variable across time" are treated as distinct nodes.
- Remounting makes animations and measurement more sensitive, and makes stacking appear non-deterministic when coupled with cursor bugs.

---

## Parent Sizing Issues

### Layout-side parent heights can be wrong (lane totals are trusted)
For lane-aware parents, `updateContainerHeights()` uses only lane totals. If lane totals don't include loops/outputs/assignments, the parent's `height` is wrong even if children exist.

Downstream effects
- Camera focusing and arrow positioning can be wrong because they use layout `height`.
- Elements can appear "outside" parents if the parent background uses the (wrong) layout height and the auto-resize pass is skipped/delayed.

### Render-side parent visuals can flicker or revert (state vs imperative mismatch)
Containers that mix `autoSize` state and imperative `resizeContainer()` are vulnerable to:
- resize occurring during/after entrance animation without corresponding state update
- later re-renders resetting `<Rect name="main-bg" width/height={totalWidth/totalHeight}>` back to stale values

This matches the observed "sometimes it grows, sometimes it doesn't" behavior.

---

## Animation Timing Effects

### Entrance animation scale/opacity/y tweaks interact with measurement
- Many container elements animate from `scaleX/scaleY ~= 0.01` to `1` and temporarily offset `y`.
- Component-level measurement (`measureContent`) often early-returns while `scale < 0.05`.
- `VisualizationCanvas.tsx` runs a debounced `resizeAllContainers(layer, ...)` after step/layout changes, which may measure at different phases of the animation than component-level measurement.

Impact
- Containers can be measured when "not ready", or measured imperatively but later re-rendered back.
- Users see "layout shifts" as backgrounds snap to new sizes or as stage focus tweens run concurrently.

### Camera focus tweens can disguise root layout bugs
The stage is tweened to focus "new/updated" elements each step. If an element is incorrectly placed at a high `y` (cursor reset), focus will jump there, making the problem feel like a global layout drift.

---

## Verified Causes vs Possible Causes

### Verified (directly supported by current code)
1) Lane cursor increments are missing for `var_assign`/`var_load` and `output` in `LayoutEngine`.
2) `loop_start`'s "not nested in another loop" check is defeated by setting `activeLoops` before calling `getActiveLoopForFrame()`.
3) `loop_end` does not reconcile the parent frame's lane cursor to include the loop's final height.
4) Renderer duplicate suppression for declaration->initializer relies on `value === undefined`, but `var_declare` uses `value: ""`, preventing suppression from triggering.
5) Renderer stacking is strictly structural (JSX/array order); there is no global z-index policy beyond top-level ordering and function frame sorting.
6) Container sizing mixes declarative props (`width/height` or `autoSize`) with imperative resizing (`resizeContainer`), and some measurement is skipped during scale animations.

### Possible / needs runtime confirmation (very plausible, but requires trace + runtime observation)
1) Tracer step ordering sometimes emits `var_assign` far away from `var_declare`, increasing duplicate boxes and making initializer "jump" effects more obvious.
2) Some step types that occur inside loops (e.g., `output`, pointer/array events) should likely attach to the loop container but currently attach to the frame, producing horizontal drift.
3) Measurement differences across zoom/pan states if any component's `getClientRect({ skipTransform: false })` is used to drive local dimensions (could over-grow when the stage is scaled).
4) Any store-driven re-renders (hover, active states, loop toggle mode switches) that re-apply stale `autoSize` values can cause parents to revert after an imperative resize.

---

## Recommended Fix Strategy (high-level only)
No fixes are implemented here; this is a strategy outline for a safe diagnostic/fix sequence.

1) Make cursor/height accounting authoritative and complete
   - Ensure every layout insertion that creates a visible box advances the correct cursor (lane or last-child), including `var_assign`, `output`, pointer/array visuals, and loop containers.
   - Fix loop boundary accounting so the parent cursor reflects the loop's final occupied height when the loop ends.

2) Reconcile "declaration + initializer" into a single identity model
   - Decide whether variables are "timeline objects" (new node per step) or "stateful objects" (same node updated).
   - Align renderer filtering/reconciliation rules with the layout's representation of "no value yet" (empty string vs undefined vs null).

3) Establish an explicit layering policy
   - Decide which categories must always be on top (arrows, overlays) and which must respect spatial stacking within a frame.
   - Avoid relying on accidental insertion order when overlaps happen; overlaps should become rare once cursor is correct, but a clear policy reduces surprises.

4) Unify container sizing to one source of truth
   - Prefer either: (a) purely declarative sizes driven by React state, or (b) purely imperative Konva resizing, but avoid mixing without synchronization.
   - Ensure any post-animation resize updates whatever state ultimately controls the `<Rect name="main-bg" ...>` props.

5) Add diagnostic instrumentation (temporary)
   - Log per-step lane cursor values and each inserted element's `y` and height.
   - In dev mode, assert monotonic `y` ordering for siblings inside a lane-aware container unless explicitly allowed (e.g., overlays).



