# Condition Rendering Verification Report

## ✅ 1. Lifecycle Timeline (Ground Truth)

The following timeline traces a single `if (TRUE)` condition from event generation to canvas rendering.

| Phase | Component | Action | Result |
| :--- | :--- | :--- | :--- |
| **Capture** | `instrumentation-tracer` | `cc_eval` event (ID: 100) | Raw event with result and expression. |
| **Expansion** | `traceProcessor.ts` | Step N generated | Filtered and assigned logical `id: 56`. |
| **Logic (Step N)** | `LayoutEngine.ts` | `processControlStep` | Creates `condition_caller` (type). Attached to **Frame**. |
| **Render (Step N)** | `VisualizationCanvas` | `renderElement` | Renders `ConditionCallerForParent` (Evaluation Bubble). |
| **Capture** | `instrumentation-tracer` | `branch_taken` event (ID: 101) | Raw event indicating TRUE branch. |
| **Expansion** | `traceProcessor.ts` | Step N+1 generated | Assigned logical `id: 57`. |
| **Logic (Step N+1)** | `LayoutEngine.ts` | `appendControlCaller` | Creates `condition` (role: caller). Attached to **Group**. |
| **Logic (Step N+1)** | `LayoutEngine.ts` | `createControlBody` | Creates `condition` (role: body). Attached to **Caller**. |
| **Render (Step N+1)** | `VisualizationCanvas` | `renderElement` | Renders `ControlNodeElement` (Decision Box). |
| **Render (Step N+1)** | `VisualizationCanvas` | `renderElement` (Body) | **SKIPPED** (returns `null`). |

---

## ✅ 2. Layout Tree Snapshot (Expected vs Actual)

### Expected Tree
```text
Frame (Main)
└── ConditionGroup
    ├── BranchCaller (If)
    │   └── BranchBody
    │       └── Variable (x)
    └── Arrow (Caller -> Body)
```

### Actual Tree
```text
Frame (Main)
├── ConditionCaller (Evaluation Point)
├── ConditionGroup (Role: Group -> Renders Null)
│   └── BranchCaller (Role: Caller -> Renders Box)
│       └── BranchBody (Role: Body -> Renders Null)
│           └── Variable (x)  <-- Improperly parented in virtual render
└── ControlArrow (Source: Caller, Target: Body)
```

**Verification:** The `body` node exists in the memory-resident layout tree but is explicitly omitted during the React reconciliation phase.

---

## ✅ 3. Caller Duplication Analysis
**Status:** ❗ Confirmed Redundancy

*   **Why two callers?** The pipeline treats "Evaluating the condition" and "Decision node in flow" as two separate semantic actions.
    *   `condition_caller` (Step N) acts as a placeholder inside the code frame.
    *   `condition` (Step N+1) acts as the interactive node in the right-flow diagram.
*   **Conflict:** Both attempts to represent the "start" of the condition. They occupy different coordinate spaces (Frame vs Group) but visually compete for the user's attention.

---

## ✅ 4. Coordinate System & Offset Analysis
**Conflict detected in `VisualizationCanvas.tsx` (L1319):**
```typescript
<Group x={-x} y={-y - controlBodyOffset}>
  {getControlBodyRenderableChildren(callerBody).map(...)}
</Group>
```

*   **Mechanism:** Children of the body are layouted with absolute coordinates calculate in the Right-Flow space.
*   **The Error:** By applying a negative offset of the caller's position (`-x`), the children are translated exactly back into the Frame's horizontal coordinate space.
*   **Impact:** This is why variable blocks appear floating inside the parent function/main frame instead of alongside the condition box.

---

## ✅ 5. Arrow Resolution Timeline

1.  **Creation:** Arrows are pushed to `visualLayout.controlArrows` during the `LayoutEngine.processStep` execution for Step N+1.
2.  **Origin Selection:** `resolveCallerOriginElement` runs.
    *   **Success Path:** Finds Step N's `condition_caller` because it was the most recently added "renderable" child of the Frame.
    *   **Failure Path (Else-If):** If Step N and Step N-X are separated by too many internal evaluation events, the 3-step window in `resolveIfGroupId` expires. A new group is created, its member list is empty, and it defaults to the Frame as origin.
3.  **Timing Validation:** Arrows are created *after* the target elements exist in the `elementHistory` but *before* the canvas render pass, ensuring data availability.

---

## ✅ 6. Step Integrity Verification

| Check | Result | Explanation |
| :--- | :--- | :--- |
| **Step order preserved** | ✅ Passed | Frontend `processedSteps` maintains relative order of the backend trace. |
| **Structural steps filtered** | ⚠️ Warning | `traceProcessor.ts` skips "non-visual" events. In complex logic, this could shrink the "3-step window" used for group resolution. |
| **Empty steps real or visual** | 🖼️ Visual | "Empty" steps are usually Step N+1 (branch taken) where the body container is hidden, making the transition feel like a pause. |
| **Step ID divergence** | ❗ Confirmed | Backend `stepIndex` vs Frontend `id` differs due to filtering. `LayoutEngine` is safe because it uses internal array indices. |

---

## ✅ 7. Root Cause Confidence Rating

| Cause | Confidence | Notes |
| :--- | :---: | :--- |
| **Virtual Render Offset Error** | 💎 100% | The `-x` transform in `VisualizationCanvas` is mathematically proven to displace children. |
| **Explicit `null` Body Render** | 💎 100% | L1283 of `VisualizationCanvas` is the direct cause of missing containers. |
| **Group Resolution Window** | 🟠 80% | The 3-step recency check is the likely cause of broken `else-if` chains. |
| **Missing `triggerStepId`** | 🟡 40% | While missing, the system uses element ID history as a robust fallback. |

---

## 🏁 Final Verification Verdict
The primary failure is a **Render-Pass Sabotage**. The `LayoutEngine` is correctly building a complex tree with bodies and children. However, the `VisualizationCanvas` component is attempting to "flatten" this hierarchy via manual child rendering and coordinate inversion, which breaks both the visual containers and the spatial positioning of all conditional logic.
