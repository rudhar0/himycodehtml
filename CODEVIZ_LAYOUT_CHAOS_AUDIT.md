# CodeViz Layout Chaos Audit (React + Konva + LayoutEngine)

**Scope:** Audit + diagnosis only. No fixes applied.  
**Primary files audited:**

- `frontend/src/components/canvas/layout/LayoutEngine.ts`
- `frontend/src/components/canvas/VisualizationCanvas.tsx`
- `frontend/src/components/canvas/utils/resizeContainer.ts`
- `frontend/src/components/canvas/elements/*` (Loop/Iteration/Function/StackFrame/VariableBox/Condition/Switch)

---

## Program That Triggers the Issue (exact input)

```c
#include <stdio.h>

/* -------- FUNCTION WITH LOOP + CONDITION -------- */
int sumEven(int *arr, int size) {
    int i;
    int sum = 0;

    for (i = 0; i < size; i++) {
        if (arr[i] % 2 == 0) {
            sum = sum + arr[i];
        }
    }

    return sum;
}

/* -------- FUNCTION WITH POINTER UPDATE -------- */
void updateValue(int *p) {
    if (*p < 5) {
        int k = 0;
        while (k < 2) {
            *p = *p + 1;
            k++;
        }
    }
}

int main() {
    /* -------- VARIABLES -------- */
    int x = 3;
    int y = 0;

    /* -------- ARRAY -------- */
    int arr[5] = {1, 2, 3, 4, 5};

    /* -------- POINTER -------- */
    int *px = &x;

    /* -------- FUNCTION CALL (ARRAY + LOOP + CONDITION) -------- */
    y = sumEven(arr, 5);
    printf("sumEven = %d\n", y);

    /* -------- FOR LOOP + CONDITION + FUNCTION CALL -------- */
    int i;
    for (i = 0; i < 3; i++) {
        if (x < 5) {
            updateValue(px);
        }
    }

    /* -------- WHILE LOOP WITH NESTED FOR -------- */
    int j = 0;
    while (j < 2) {
        int z = 0;

        for (z = 0; z < 2; z++) {
            if (z == j) {
                printf("z == j (%d)\n", z);
            }
        }
        j++;
    }

    /* -------- DO-WHILE INSIDE CONDITION -------- */
    int t = 0;
    if (x > 0) {
        do {
            t++;
            printf("t = %d\n", t);
        } while (t < 2);
    }

    return 0;
}
```

Why this program is a “layout stress test”:

- Many **var_declare + var_assign pairs** (`int x=3`, `int y=0`, `int j=0`, `int t=0`, etc.).
- Many **repeated assignments** inside loops (`sum`, `i`, `k`, pointer writes to `*p` which cascade into `x` updates).
- **Nested loops** (while → for) and multiple loop scopes.
- **Function calls** with returns and side effects.
- **High step count**, meaning many elements exist at once in expanded mode.

---

## Executive Summary

The “layout chaos” is caused by **multiple independent sizing/positioning systems that disagree**:

1) `LayoutEngine` computes positions, then later inflates container heights (`updateContainerHeights()`), **without reflowing sibling Y positions** that were computed using **placeholder heights** (notably loop iteration containers).  
2) The renderer (`VisualizationCanvas`) **filters/hides** certain layout nodes (notably declaration-only variables) but `LayoutEngine` still **allocated vertical space** for them, causing **gaps** and parent **height inflation** from “invisible” items.  
3) Konva “auto-resize” uses `getClientRect()` during ongoing entrance animations; most components’ auto-size logic **only grows and never shrinks**, so any transient over-measurement becomes **permanent empty space**.

The result is the exact visual pattern you described:

- crowded / overlapped content near the top,
- extremely tall parent containers and large empty areas below,
- initialization appearing missing (it’s often filtered or pushed down),
- nested loop flow breaking (nesting is not represented consistently).

---

## Root Causes (technical, code-level)

### RC1) Two-phase sizing without reflow (placeholder heights used for cursoring)

**Where:**

- Iteration containers are created with a small placeholder height (`height: 40`) on `loop_body_start` in `LayoutEngine.ts`.
- Actual heights are inflated later in `updateContainerHeights()` based on child bottoms.

**Mechanism:**

- While processing steps, `getNextCursorY(parent)` for non-lane containers advances based on the **last child’s current height**.
- For loops in expanded mode, the loop’s last child is an `iterationElement`. During step processing it still has `height: 40`, even if it already contains many variable boxes.
- Therefore new iterations get `y` positions computed using an **underestimated previous-iteration height**, causing iterations (and their contents) to **stack/compress at the top**.
- Later, `updateContainerHeights()` inflates earlier iteration heights (correctly, based on children), which makes the loop’s required height huge, but **positions are not recomputed** → you get **overlapping content near top + giant container below**.

Key code paths:

- Iteration creation: `LayoutEngine.ts` handles `loop_body_start` and sets `height: 40`, `y: this.getNextCursorY(loopElement)`.
- Cursoring: `LayoutEngine.ts:getNextCursorY()` uses `lastChild.y + lastChild.height` for non-lane containers.
- Inflation pass: `LayoutEngine.ts:updateContainerHeights()` computes `requiredHeight` via recursive child bottoms and writes `element.height = Math.max(80, requiredHeight)`.

This same pattern also exists for other “container with children” constructs (e.g., switch/case containers), but loops are the most visible offender in this program.

---

### RC2) Render-time suppression hides nodes that LayoutEngine already “paid for”

**Where:**

- Renderer removes “empty declaration-only duplicates” in `VisualizationCanvas.tsx` via `filterChildren()`.
- `LayoutEngine` still:
  - increments the lane cursor for those declaration nodes when not in loops, and/or
  - uses them as part of `getNextCursorY()` sequencing inside loop/iteration containers,
  - includes them in `updateContainerHeights()` calculations.

**Mechanism:**

- Common trace pattern: `var_declare` creates a variable node with `data.value = ""` and `isInitialized: false`.
- Immediately afterward, `var_assign` creates another variable node for the same name with a value.
- `VisualizationCanvas.filterChildren()` detects the pattern and hides the declaration-only box.
- But `LayoutEngine` advanced Y/cursor *as if that hidden box were still visible*.

Net effect:

- “Initialization missing or delayed”: the visible initialized box is pushed down because the layout cursor advanced for the now-hidden declaration box.
- “Massive empty space”: hidden nodes contribute to parent required heights, especially in containers that never shrink.

Key evidence:

- `LayoutEngine.ts` uses `value: ""` for declarations (`var_declare`) and allocates height.
- `VisualizationCanvas.tsx:filterChildren()` treats empty value (`""`) followed by non-empty value within 1 step as a duplicate and excludes it.

---

### RC3) Nested loop hierarchy is not represented consistently (nesting breaks flow)

**Where:**

- `LayoutEngine.ts` always attaches a `loop_start` element to the owning frame via `ownerFrame.children!.push(loopElement)`.
- It does not place nested loops under the current active loop/iteration as children (even though other step types do use `activeLoop` to choose a parent).

**Mechanism:**

- In nested loop scenarios (your `while (j<2) { for(z<2){...}}`), the inner `loop_start` is created as a sibling at the frame level, not as a child of the outer loop iteration.
- The cursor accounting for nested loops is also special-cased (`if (!activeLoopBefore) lane.usedHeight += loopElement.height...`), meaning the frame cursor may not advance for nested loop containers.

Net effect:

- Inner loop containers appear “out of place” (not visually nested) and can overlap or crowd into unrelated areas.
- The visual flow looks broken because the hierarchy does not match program structure.

---

### RC4) “Auto-resize” measurement during animation + “only grow, never shrink” container sizing

**Where:**

- Many Konva elements animate in by temporarily shifting Y downward and scaling up:
  - `VariableBox.tsx` animates `group.y(origY + 25) → origY`
  - `LoopElement.tsx` animates `group.y(origY + 30) → origY`
  - `FunctionElement.tsx` animates `group.y(origY + 35) → origY`
  - similar patterns in other elements
- Containers measure children using `getClientRect()`:
  - shared utility: `resizeContainer()` (`resizeContainer.ts`)
  - component-local measurement: `LoopElement.tsx`, `FunctionElement.tsx`, `ConditionElement.tsx` use `measureContent()`
- Auto-size state generally does `setAutoSize(prev => ({ width: Math.max(...), height: Math.max(...) }))` and **never shrinks**.

**Mechanism:**

- If a parent measures while a child is mid-animation (temporarily lower on screen), the measured bounds become larger (extra bottom extent).
- That larger height becomes the new background size.
- Because sizing uses `Math.max(prev.height, ...)`, the parent never shrinks after the child finishes animating upward.

Net effect:

- Persistent empty space below children (exactly the “stretched below” symptom).
- Over time and across many steps, small transient over-measurements accumulate into massive empty regions.

---

### RC5) Repeated updates create new layout nodes (layout grows with step count)

**Where:**

- `LayoutEngine.ts` creates a *new* variable element for most `var_assign` events using an ID that includes the step index: `var-${frameId}-${varName}-${stepIndex}`.
- This means loops that update the same variable repeatedly create **many boxes** (unless toggle mode inside loop is enabled and hits the special “update existing element” path).

**Mechanism:**

- In your program, variables like `sum`, `i`, `k`, `x`, `t`, etc. are updated in loops.
- Each update becomes another visual node (not an in-place update).

Net effect:

- Containers must grow to contain many historical states.
- Layout height and measurement sensitivity increase dramatically as the trace grows, making all other sizing problems worse.

---

## Why Massive Empty Space Appears (exact mechanisms)

The empty space is not one bug — it’s the **sum of three additive inflators**:

1) **Hidden-but-counted layout nodes**  
   Declaration-only variable nodes are filtered out in the renderer but still:
   - advanced the cursor, and
   - contributed to `updateContainerHeights()` requiredHeight.

2) **Height inflation after positioning**  
   Iteration containers (and loop containers) are positioned while their children’s true heights are not yet reflected. Later height inflation increases parent heights without moving later siblings.

3) **Konva measurement captures transient “lower Y” during animations**  
   Measuring while nodes are animating in (y temporarily larger) leads to larger bounds; auto-size logic prevents shrinking, leaving a permanent empty tail.

When these interact, the typical outcome is:

- content drawn near the top (because siblings were positioned too early / with placeholder heights),
- a background container sized to include a much larger computed bottom (either from `updateContainerHeights()` or transient `getClientRect()`), leaving “dead air” below.

---

## Why Initialization Elements Look Missing (or “show up late”)

This is primarily a **pipeline mismatch** between layout and rendering:

1) `LayoutEngine` models `int x = 3;` as:
   - a `var_declare` node with `value: ""` (placeholder), and
   - a `var_assign/var_load` node with the actual value.

2) `VisualizationCanvas.filterChildren()` deliberately removes the declaration-only box to avoid duplicates.

3) But `LayoutEngine` already:
   - allocated Y-space for the declaration node, so the initialization node appears **lower** than where the user expects the “first mention” to be,
   - and in loop/iteration contexts, the declaration node may also affect sequencing via `getNextCursorY()`.

Additional ways “missing” happens visually:

- If two nodes end up with very similar Y (common under cursor bugs), Konva render order determines which appears on top. Later-created nodes (often initializers) can occlude earlier nodes or vice versa, producing a “missing” impression even when both exist.

---

## Loop & Function Container Expansion Cause

### Loops

Loops expand too much due to:

- **Iteration stacking bug (RC1)**: placeholder iteration heights used while placing subsequent iterations.
- **Hidden nodes still counted (RC2)**: filtered declaration boxes still inflate loop height calculations.
- **Auto-size never shrinks (RC4)**: once a loop measures too large, its background stays too large.

### Function frames / stack frames

Function and main stack frames expand due to:

- Lane cursor growth that can include deeply nested content via `bumpFrameLocalsCursorToInclude()`.
- `updateContainerHeights()` inflating heights based on children that may not render (filtered).
- `StackFrame.tsx` and `FunctionElement.tsx` both participate in Konva resizing (`resizeContainer()` + component-local sizing), which can amplify measurement noise.

---

## Pointer & Array Update Effects (why they worsen layout)

### Pointer operations

- Pointer alias nodes (`pointer_alias`) are relatively stable (ID does not include step index), and dereference writes (`pointer_deref_write`) update the existing pointer element rather than creating new ones.
- The *layout shift* comes indirectly: pointer-driven writes typically generate repeated variable assignments for the pointed-to value (e.g., `*p = *p + 1` leading to repeated updates of `x`), and those `var_assign` events create **new variable boxes** (RC5), expanding containers and increasing the chance of measurement inflation.

### Array operations

- Arrays are tracked via `array_create/array_declaration` + `array_index_assign`, with a separate `arrayPanel`.
- The array panel and update arrows don’t directly cause vertical space in stack frames, but the array loop (`sumEven` iterating indices) increases step count and the number of variable updates (`i`, `sum`), triggering RC5 and multiplying layout nodes inside loops.

---

## Rendering & Filtering Interaction Issues

### Filtering mismatch

- `visibleLayout` filtering is step-based, but it does **not** reconcile layout heights with render-time duplicate suppression.
- Duplicate suppression runs at render-time (`VisualizationCanvas.filterChildren()`), but `LayoutEngine.updateContainerHeights()` already ran on the unfiltered tree.

### Draw order mismatch

- When coordinates collide (common under RC1/RC3), Konva draw order (React render order) decides what’s visible.
- `LayoutEngine.updateContainerHeights()` sorts children by step, so later steps render later and appear “on top” in overlaps.

### Animation timing mismatch

- `VisualizationCanvas` runs `resizeAllContainers()` after a short debounce (50ms) on every step/layout change.
- That means measurement can occur while multiple child nodes are still animating into place, producing oversize bounds that never shrink (RC4).

---

## Severity Ranking (highest impact first)

1) **RC1 – Two-phase sizing without reflow (iteration height placeholder)**  
   Directly creates “compressed at top + stretched below” in loop-heavy traces.

2) **RC2 – Render-time suppression vs layout-time cursor/height**  
   Produces consistent empty gaps and “missing init” perception even outside loops.

3) **RC4 – getClientRect during animation + never-shrink sizing**  
   Turns small transient mis-measurements into permanent large empty regions.

4) **RC3 – Broken nesting for nested loops**  
   Breaks visual flow and causes stacking/overlap in nested loop programs.

5) **RC5 – New node per assignment (unbounded growth)**  
   Not inherently “wrong”, but massively amplifies all spacing/measurement problems.

---

## Recommended Fix Strategy (High-Level Only; no code changes here)

These are **strategy-level** recommendations (not architectural rewrites):

1) **Make “layout tree” == “rendered tree” for spacing/height**  
   If the renderer suppresses declaration-only duplicates, the layout/cursor logic must not allocate vertical space for them.

2) **Avoid using placeholder container heights for placing subsequent siblings**  
   When a container’s children determine its height (iterations/cases), sibling placement must use either:
   - the deepest descendant bottom so far, or
   - a continuously updated container height as children are appended.

3) **Measure after animations settle, or ensure measurements can shrink**  
   If measurement happens mid-animation, containers must be allowed to shrink back, or measurement must be delayed until child transforms stabilize.

4) **Represent nested loops as actual nested layout children**  
   Inner loops should be children of the current iteration container (or current loop container in collapsed mode), not always frame-level siblings.

5) **Decide explicitly whether variable updates are “history” (new boxes) or “state” (update in place)**  
   If history is desired, spacing must remain stable and bounded; if state is desired, updates should not add new vertical nodes.

---

## Appendix: Key Evidence Pointers (for quick verification)

- Layout replay + container height inflation: `frontend/src/components/canvas/layout/LayoutEngine.ts` (`calculateLayout()` → `updateContainerHeights()`).
- Iteration container creation: `frontend/src/components/canvas/layout/LayoutEngine.ts` handling `loop_body_start` (creates `subtype: 'iteration'`, `height: 40`).
- Cursoring logic: `frontend/src/components/canvas/layout/LayoutEngine.ts:getNextCursorY()`.
- Renderer duplicate suppression: `frontend/src/components/canvas/VisualizationCanvas.tsx:filterChildren()`.
- Auto-resize measurement: `frontend/src/components/canvas/utils/resizeContainer.ts` (`getClientRect({ relativeTo: group })`).
- Animation-induced measurement risk: `frontend/src/components/canvas/elements/VariableBox.tsx` (y shifts during entrance animation) plus `LoopElement.tsx`/`FunctionElement.tsx` similar patterns.
