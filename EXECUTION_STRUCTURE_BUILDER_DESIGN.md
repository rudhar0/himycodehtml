# ExecutionStructureBuilder Design Document

**Status:** Proposed Architecture  
**Scope:** Frontend structural pre-processing layer between `traceProcessor.ts` and `LayoutEngine.ts`  
**Author:** Architecture Review

---

## Part 1 — Analysis of the Current System

### 1.1 Full Pipeline

The execution visualization pipeline proceeds in six distinct stages:

1. **`code-instrumenter.service.js`** rewrites the user's C/C++ source via AST transformation, injecting `trace()` calls at every function entry/exit, variable operation, conditional branch, and loop boundary.

2. **Clang/GCC compilation** compiles the instrumented source with `-finstrument-functions`.

3. **`instrumentation-tracer.service.js`** executes the binary, collects its JSON event stream, and normalizes events into `ExecutionStep[]`. This is where `frameId`, `scopeDepth`, `conditionId`, and `loopId` are assigned.

4. **`traceProcessor.ts`** (frontend) receives `ExecutionStep[]`, normalizes sequencing, and produces an `ExecutionTrace`.

5. **`LayoutEngine.ts`** (frontend) consumes `ExecutionTrace` one step at a time and imperatively builds a tree of `LayoutElement` nodes for the canvas, resolving parent containers via heuristic depth logic.

6. **`VisualizationCanvas.tsx`** renders the `LayoutElement` tree via React-Konva.

### 1.2 `scopeDepth` — Generation and Breakdown

`scopeDepth` is generated in the backend by `buildScopeDepthMap`, which scans the **instrumented** source file character by character:

```
for each character in instrumented file:
    if '{': depth++
    if '}': depth--
    record { start: depth at line start, max: deepest brace on line }
```

The result is a `Map<lineNumber, { start, max }>`. When a trace event is emitted, the backend looks up its line number in this map and attaches `scopeDepth: map.get(lineNum).start`.

**Why this breaks down:**

- The scanner operates on the **instrumented** file, not the user's original source. The instrumented file contains injected `trace()` calls, `#include` directives, and helper declarations. These injected lines shift the line numbers of the user's original code downward. If the trace event's `lineNumber` refers to the instrumented file (which it does — the binary was compiled from the instrumented file), then the depth lookup is self-consistent. However, brace counting across injected `{...}` blocks in the tracer infrastructure can inflate depth by ±1 near function boundaries.

- The `start` field records the brace depth at the **first non-whitespace character** on a line. For a line beginning with `}`, the code subtracts one before recording, emulating "depth as seen from inside the closing scope." This convention is non-obvious and inconsistently applied: a line like `} else {` changes depth twice, but `start` only captures one snapshot.

- Steps that carry no `lineNumber` (e.g., synthetic events like `output` or `input_request`) receive no `scopeDepth` from the backend at all. `LayoutEngine` falls back to `currentScopeDepth.get(frameId)` — the stale depth from the last step in that frame that did carry a depth.

### 1.3 `conditionId` — Assignment and Propagation

The C++ tracer emits `conditional_start` events containing a raw integer `conditionId`. The backend service maps each `"frameId:rawIntId"` pair to a stable string ID via `rawConditionIdToStable`. This prevents id collisions between different invocations of the same function at different call sites.

Each frame object maintains a `conditionStack` (LIFO array of string conditionIds) and an `activeConditionId` (the top of that stack). When a new function is called (`pushCallFrame`), the new frame receives a **shallow copy** of the parent frame's `conditionStack` and `activeConditionId`. This means that a function called from inside an `if` body carries that condition's id on every step it emits — the condition context propagates into the callee.

**Concrete scenario where this causes problems:** A helper function `printResult()` is called from inside `if (x > 0)`. Every `var_load` in `printResult` carries the caller's `conditionId`. LayoutEngine sees this conditionId and may attempt to place `printResult`'s steps inside the condition body of the **caller's frame**, even though `printResult` has its own frame box. If the condition body element is not in `printResult`'s frame, the step is misrouted.

### 1.4 Recursion `frameId` Generation

`generateFrameId` concatenates the function name with a monotonically increasing global counter:

```js
generateFrameId(functionName) {
    return `${functionName}-${this.globalCallIndex++}`;
}
```

A recursive call to `factorial(5)` produces the chain: `factorial-0`, `factorial-1`, `factorial-2`, `factorial-3`, `factorial-4`, `factorial-5`. Each has a unique `frameId`, and each `func_enter` event carries `parentFrameId` pointing to the previous frame in the chain. The recursion structure is fully encoded in the `parentFrameId` chain.

### 1.5 `LayoutEngine.resolvePlacementParent` — Current Logic

For every step that creates a layout element, `LayoutEngine` calls `resolvePlacementParent(ownerFrame, frameId, scopeDepth)` with the following priority chain:

1. **`getActiveControlParent(frameId, scopeDepth)`** — Scans `activeControlByDepth` for the deepest registered condition body where `registeredDepth <= stepScopeDepth` and `branchState === "active"`. Returns that condition body element if found.

2. **`getLoopContainerParent(frameId)`** — Returns the active loop container for the frame's current loop, if any.

3. **`ownerFrame`** — Falls back to the function frame box.

The critical weakness is step 1: `registeredDepth <= stepScopeDepth` allows a condition body registered at depth 2 to capture steps at depth 3, depth 4, and higher. This is the intended behavior for nested statements inside an if body. But when a step's `scopeDepth` is stale (missing from the event and inherited from the previous step), the comparison is made against an incorrect value.

### 1.6 Where LayoutEngine Guesses

**Ephemeral conditions (braceless ifs):**

When a `conditional_start` event arrives without a subsequent `block_enter` in the same frame, LayoutEngine infers that the `if` has no braces. It creates an "ephemeral" condition body and registers it in `ephemeralControlByDepth`. The ephemeral body is cleared when either (a) a step at a different source line arrives, or (b) a second step arrives at the same line after the first has been placed (`usedAtStep` is set). This heuristic fails when two legitimate variable operations share the same line number — the second operation incorrectly clears the ephemeral body, leaving subsequent single-line-if children unparented.

**Stale depth fallback:**

`getScopeDepth` falls back to `currentScopeDepth.get(frameId)` when no depth is on the step. `output` and `input_request` events consistently carry no `scopeDepth`. If a `printf` call happens inside an `if` body at depth 2, the `output` event inherits depth 2, appears to belong to the condition body, and gets placed inside it. This is accidentally correct. But if the following step is a `func_exit` (also depth-less), the condition body is never pruned because no step with `scopeDepth < 2` arrives to trigger `pruneControlDepthForScope`. The condition body then lingers for any subsequent same-frame steps.

**6-step lookahead (`isReturnExpressionFlowStep`):**

When a `var_load` or `var_assign` step arrives and has a `scopeDepth` consistent with being inside a condition body, LayoutEngine scans forward up to 6 steps to see if a `return` event follows in the same frame. If it finds one, it sets `parentId` to the function frame instead of the condition body. This heuristic fails when: (a) the return event is more than 6 steps away, (b) there are intervening function calls, or (c) the return is inside a nested conditional. All three scenarios produce the return sub-expression attaching to the wrong parent.

---

## Part 2 — Root Problems: Why Depth-Based Inference is Fundamentally Unstable

Depth-based parent inference treats a single integer, `scopeDepth`, as a proxy for a rich, nested control-flow tree. The fundamental problem is that the same depth value is shared by logically distinct scopes, and any heuristic that uses depth as a discriminant will experience aliasing.

### 2.1 Recursive Calls

Each recursive `factorial-N` frame has its own `activeControlByDepth` keyed by `frameId`. Since `frameId` is unique per call, this part works. However, when `factorial-3` emits a `func_enter` for `factorial-4`, LayoutEngine calls `resolveCallSiteScopeDepth`, which reads `prevStep`'s depth (typically the call-expression line inside the current frame). If the previous step was a `func_exit` (from a completed sub-expression), it carries no depth. `resolveCallSiteScopeDepth` then falls back to `prevStep`'s stale depth or 0, placing the call_site at the wrong depth in the frame's container hierarchy. With five levels of recursion, a single depth miss causes five sequentially visible misplacements.

### 2.2 Single-Line `if` Without Braces

```c
if (x > 0)
    return x;
```

The `conditional_start` arrives at the line of the `if`. No `block_enter` follows. LayoutEngine creates an ephemeral body. The `return` statement emits a `var_load` (loading `x`) at the `return` line and then a `func_exit`. Both the `var_load` and `func_exit` share the call's scope depth. The ephemeral body is active for the `var_load`, so the 6-step lookahead fires to rescue it — but that lookahead may miss the `func_exit` if there are intervening steps. Failure rate correlates with expression complexity: `return computeFoo(a, b, c)` generates more intervening steps than `return x`.

### 2.3 Nested Conditions

```c
if (a > 0) {
    if (b > 0) {
        x = 1;
    }
}
```

The outer `if` body is at depth 2. The inner `if` body is at depth 3. The `x = 1` step arrives at depth 3. `getActiveControlParent` scans for the deepest condition body where `registeredDepth <= 3`. It correctly finds the inner body at depth 3. When the inner block exits, a step at depth 2 arrives and `pruneControlDepthForScope` removes depth-3 entries. **The failure case:** if the step after `}` (end of inner block) carries no `scopeDepth` (e.g., another `output` call), the inner body is never pruned. The next statement at depth 2 is incorrectly placed inside the (stale) inner condition body.

### 2.4 Multiple Sequential Function Calls in the Same Scope

```c
foo();
bar();
baz();
```

All three calls are at the same `scopeDepth`. Each produces a `func_enter` → steps → `func_exit` sequence. After `foo()` returns, `func_exit` arrives with no `scopeDepth`. `activeControlByDepth` is not pruned. The call_site for `bar()` arrives and `getActiveControlParent` finds whatever was active during `foo()`. If `foo()` contained an `if` body that set a condition body at the frame's scope depth, `bar()`'s call_site incorrectly attaches to that condition body despite being sequential to `foo()`.

### 2.5 `if` → `else` Transition at the Same Depth

```c
if (x > 0) {
    a = 1;       // depth 2 inside "then" body
} else {
    b = 2;       // depth 2 inside "else" body
}
```

Both `a = 1` and `b = 2` are at `scopeDepth = 2`. The `then` body is registered as a condition body at depth 2 with `branchState = "active"`. The `conditional_branch` event arrives indicating the `else` arm was taken — LayoutEngine should deactivate the `then` body and activate the `else` body. But if the `conditional_branch` event arrives **without** an accompanying `scopeDepth`, `pruneControlDepthForScope` does not fire, and the `then` body remains lingering. The `b = 2` step at depth 2 is routed into the now-stale `then` body.

### 2.6 Steps With Missing `scopeDepth` Fields

`output`, `input_request`, and some `func_exit` events consistently carry no `scopeDepth`. The fallback to `currentScopeDepth.get(frameId)` means every such step inherits the depth of whatever came before it in that frame. The inherited depth can be:

- **Too high:** step appears to be inside a condition body, gets misrouted into it.
- **Too low:** `pruneControlDepthForScope` fires prematurely, destroying valid condition bodies.

There is no defensive mechanism — the fallback is unconditional and silent.

---

## Part 3 — Proposed New Architecture: `ExecutionStructureBuilder`

### 3.1 Position in Pipeline

`ExecutionStructureBuilder` runs on the frontend, immediately after `traceProcessor.ts` produces the `ExecutionStep[]` array and **before** `LayoutEngine.ts` consumes it:

```
ExecutionStep[]  (from traceProcessor.ts)
      ↓
ExecutionStructureBuilder.build(steps)
      ↓
ExecutionGraph   (explicit ownership tree)
      ↓
LayoutEngine.ts  (pure layout consumer — no structure inference)
```

No backend changes are required. `ExecutionStructureBuilder` is a pure frontend module.

### 3.2 Inputs

```typescript
build(steps: ExecutionStep[]): ExecutionGraph
```

`ExecutionStep` is the existing type produced by `traceProcessor.ts`. No changes to `ExecutionStep` are required. The builder consumes the array in forward order exactly once.

### 3.3 Outputs

`ExecutionStructureBuilder` produces an `ExecutionGraph` (defined fully in Part 4). The graph contains:

- A flat `nodeIndex: Map<nodeId, ExecutionNode>` for O(1) lookup.
- An ordered `nodes: ExecutionNode[]` preserving step order.
- A `roots: nodeId[]` array pointing to function-frame nodes that have no parent (top-level calls).
- An `edges: ExecutionEdge[]` array for pointer/reference relationships.
- A `paths: Map<pathId, ExecutionPath>` map describing each control-flow branch.

### 3.4 Core Algorithm

The builder performs a single forward pass through `steps`. It maintains three primary context stacks that mirror the backend tracer's runtime state:

```typescript
class ExecutionStructureBuilder {
    // --- Context stacks ---
    private frameStack: BuilderFrame[];        // mirrors tracer's frame stack
    private conditionStack: ConditionContext[]; // per-frame, mirrors tracer's conditionStack
    private loopStack: LoopContext[];           // per-frame, mirrors tracer's loopStack

    // --- Output structures ---
    private nodes: ExecutionNode[] = [];
    private nodeIndex: Map<string, ExecutionNode> = new Map();
    private edges: ExecutionEdge[] = [];
    private paths: Map<string, ExecutionPath> = new Map();
    private roots: string[] = [];

    build(steps: ExecutionStep[]): ExecutionGraph {
        for (let i = 0; i < steps.length; i++) {
            this.processStep(steps[i], i, steps);
        }
        return { nodes: this.nodes, nodeIndex: this.nodeIndex,
                 edges: this.edges, paths: this.paths, roots: this.roots };
    }
}
```

`processStep` dispatches by `step.type`:

- **`func_enter`**: Create a `stack_frame` node. Its `parentId` comes from the `func_enter` event's `parentFrameId` field (not from depth). Push a new `BuilderFrame` onto `frameStack`.
- **`func_exit`**: Pop the active `BuilderFrame`. Restore the caller's path context.
- **`conditional_start`**: Push a `ConditionContext` onto the active frame's condition stack. Create a `condition` node. Detect braceless body by looking forward N steps (see Part 6).
- **`conditional_branch`**: Update the active `ConditionContext` to record which branch was taken. Create or activate the appropriate branch node.
- **`loop_start`**: Push a `LoopContext`. Create a `loop` node.
- **`loop_iteration`**: Record a new iteration on the active `LoopContext`. Advance path counter within loop scope.
- **`loop_end`**: Pop the active `LoopContext`.
- **`var_declare`, `var_assign`, `var_load`**: Resolve parent from active condition/loop context. Create a `variable` node.
- **`output`**, **`input_request`**: Create `output`/`input` nodes. Parent is resolved the same way.
- **`block_enter`**: Confirm that the active condition's body is braced. Update `ConditionContext`.
- **`block_exit`**: Pop the innermost braced scope from the active frame's condition or loop context.

### 3.5 The Three Context Stacks

**`frameStack: BuilderFrame[]`**

Each entry records:
```typescript
interface BuilderFrame {
    frameId: string;
    nodeId: string;           // the stack_frame node's id
    parentFrameId?: string;
    activePathId: string;     // current path in this frame
    conditionStack: ConditionContext[];
    loopStack: LoopContext[];
}
```

Pushed on `func_enter`, popped on `func_exit`. Always reflects the frame currently executing.

**`conditionStack: ConditionContext[]` (per frame)**

Each entry:
```typescript
interface ConditionContext {
    conditionId: string;
    conditionNodeId: string;
    branchTaken: "then" | "else" | "none" | string; // switch arm label
    isBraced: boolean;       // false = braceless single-line if
    bodyUsed: boolean;       // true after first child placed
    scopeDepthAtEntry: number; // depth when conditional_start arrived
}
```

Pushed on `conditional_start`, popped when: (a) `block_exit` arrives for a braced body, or (b) for a braceless body, after the first child element is placed.

**`loopStack: LoopContext[]` (per frame)**

Each entry:
```typescript
interface LoopContext {
    loopId: string;
    loopNodeId: string;
    iteration: number;
    isBraced: boolean;
}
```

Pushed on `loop_start`, popped on `loop_end`.

**Parent resolution in the new system:**

```typescript
private resolveParentId(frame: BuilderFrame): string {
    // 1. Active condition body (innermost on stack)
    const cond = frame.conditionStack.at(-1);
    if (cond) return cond.conditionNodeId;

    // 2. Active loop container
    const loop = frame.loopStack.at(-1);
    if (loop) return loop.loopNodeId;

    // 3. Function frame
    return frame.nodeId;
}
```

This is deterministic. It uses the in-memory context stacks maintained by the builder, not heuristic depth comparisons.

---

## Part 4 — New Data Structures

### 4.1 `ExecutionNode`

```typescript
interface ExecutionNode {
    nodeId: string;           // globally unique; format varies by type (see below)
    type: ExecutionNodeType;  // enum of all node kinds
    frameId: string;          // which function call owns this node
    conditionId?: string;     // conditionId active when node was created (if any)
    loopId?: string;          // loopId active when node was created (if any)
    parentId?: string;        // nodeId of the direct logical parent
    children: string[];       // ordered nodeIds of direct children
    pathId: string;           // control-flow path this node belongs to
    depth: number;            // tree depth from root (root = 0)
    stepRange: [number, number]; // [firstStepIndex, lastStepIndex] into ExecutionStep[]
    data: Record<string, unknown>; // node-type-specific payload (see below)
}

type ExecutionNodeType =
    | "stack_frame"
    | "variable"
    | "pointer"
    | "array"
    | "heap_object"
    | "condition"
    | "condition_branch"
    | "loop"
    | "loop_iteration"
    | "output"
    | "input"
    | "call_site";
```

**Field explanations:**

- **`nodeId`**: Unique string. `stack_frame` nodes use `frame-${frameId}`. Variable nodes use `var-${frameId}-${name}-${stepIndex}`. Condition nodes use `cond-${conditionId}`. This format is inspectable and debuggable.
- **`type`**: Discriminates the node. LayoutEngine uses this to decide visual shape.
- **`frameId`**: Every node belongs to exactly one function call. For `stack_frame` nodes this is self-referential (`frame.frameId === node.frameId`).
- **`conditionId`**: Records which condition was active when the node was created. This is informational — parent resolution uses `parentId`, not `conditionId`.
- **`loopId`**: Records which loop was active when the node was created.
- **`parentId`**: The explicit parent node's `nodeId`. This is the primary structural field. `resolvePlacementParent` in the new LayoutEngine is simply `nodeIndex.get(node.parentId)`. No heuristics.
- **`children`**: Ordered list of child `nodeId`s. Children are appended in step order.
- **`pathId`**: The control-flow path string (see Part 5). Nodes in different branches of the same `if` have different `pathId`s.
- **`depth`**: Integer tree depth. Root `stack_frame` nodes have depth 0. Each parent-child relationship increments depth by 1. Used by LayoutEngine for vertical spacing computations.
- **`stepRange`**: `[firstStepIndex, lastStepIndex]` — indices into the original `ExecutionStep[]` array. The builder does not duplicate step data. LayoutEngine looks up the original step when it needs detailed fields (`varName`, `value`, etc.).
- **`data`**: Node-type-specific structured payload. For `stack_frame`: `{ functionName, callDepth, parentFrameId }`. For `variable`: `{ name, value, operation }`. For `condition`: `{ conditionType, expression }`. For `loop`: `{ loopType, iterationCount }`.

### 4.2 `ExecutionEdge`

```typescript
interface ExecutionEdge {
    edgeId: string;
    type: "pointer" | "call" | "data_flow";
    sourceNodeId: string;
    targetNodeId: string;
    label?: string;        // e.g. pointer field name
    stepIndex: number;     // step at which edge was established
}
```

- **`"pointer"`**: A pointer variable pointing to a heap object or another variable.
- **`"call"`**: From a `call_site` node to the `stack_frame` node of the called function. This replaces LayoutEngine's current function-arrow logic.
- **`"data_flow"`**: Optional — for future use tracking data movement between variables.

### 4.3 `ExecutionPath`

```typescript
interface ExecutionPath {
    pathId: string;         // e.g. "main", "main.1", "main.1.2"
    parentPathId?: string;  // the path from which this diverged
    originNodeId: string;   // the condition_branch or loop_iteration that started this path
    label: string;          // human-readable: "then", "else", "iteration 3", etc.
    nodeIds: string[];      // ordered list of nodes on this path
}
```

### 4.4 `ExecutionGraph`

```typescript
interface ExecutionGraph {
    roots: string[];                        // nodeIds of top-level stack_frames
    nodes: ExecutionNode[];                 // all nodes in step order
    nodeIndex: Map<string, ExecutionNode>;  // O(1) lookup by nodeId
    edges: ExecutionEdge[];                 // pointer and call edges
    paths: Map<string, ExecutionPath>;      // path lookup by pathId
    metadata: {
        totalSteps: number;
        maxDepth: number;
        frameCount: number;
        buildDurationMs: number;
    };
}
```

---

## Part 5 — Path System

### 5.1 Path ID Format

Path IDs are dot-separated integer strings:

```
main          — the root execution path (top-level function, first call)
main.1        — first control-flow branch (e.g. "then" arm of first if)
main.2        — second branch at same level (e.g. "else" arm, or second if)
main.1.1      — first branch nested inside main.1
main.1.1.1    — further nested
main.1.2      — second branch at the main.1 level
```

The counter after each dot is a **local branch counter** within the enclosing scope. It increments every time a new divergent control-flow branch is opened at that scope level. It does **not** reset when a branch closes; it only advances.

### 5.2 Paths Represent Control Flow, Not Function Calls

A function call does **not** start a new path. The called function frame inherits the **caller's current pathId**. All nodes in `factorial-3` that were executed while the caller was on path `main.1` also carry `pathId = "main.1"`.

This is the correct semantic: a function call is sequential execution, not a branch. Branches arise only from:
- `conditional_start` + `conditional_branch` (`if`/`else`, `switch`/`case`)
- `loop_iteration` (each iteration of a `for`/`while`/`do` loop is a branch of the loop's path)

### 5.3 Path Counter Mechanics

Each `BuilderFrame` maintains a `activePathId` and a `localBranchCounter: number` per scope depth. When `conditional_start` arrives:

```
parentBranches = frame.branchCounterStack.top()
parentBranches++
newPathSuffix = parentBranches.toString()
newPathId = frame.activePathId + "." + newPathSuffix
frame.branchCounterStack.push(0)  // child scope starts at 0
frame.conditionStack.push({ pathId: newPathId, ... })
```

When the condition body closes (`block_exit` or braceless body consumed):
```
frame.branchCounterStack.pop()  // child scope removed
// frame.activePathId returns to the enclosing path
```

The `else` branch of the same `if` gets a new path ID:
```
parentBranches++
elsePathId = frame.activePathId + "." + parentBranches.toString()
```

### 5.4 Loop Iterations

Each `loop_iteration` event increments the loop's iteration counter and creates a new path:

```
loopContext.iteration++
iterationPathId = loopContext.loopPathId + "." + loopContext.iteration
```

So `main.3` (the loop) has iterations `main.3.1`, `main.3.2`, `main.3.3`. This makes it trivial to filter the visualization to a specific loop iteration by pathId prefix.

### 5.5 Restoring Caller's Path After Return

When `func_exit` pops the `BuilderFrame`, the restored frame retains its own `activePathId`. No special action is needed — the path state lives on the frame, and popping the frame frame restores the caller's path automatically.

---

## Part 6 — Edge Cases

### 6.1 Recursion

Each recursive call produces a unique `frameId` (`factorial-0` through `factorial-N`). `ExecutionStructureBuilder` creates a distinct `stack_frame` node for each. The `parentId` of `factorial-1`'s frame node is the `nodeId` of `factorial-0`'s frame node, resolved directly from the `func_enter` event's `parentFrameId` field:

```typescript
case "func_enter": {
    const parentFrameNode = step.parentFrameId
        ? this.nodeIndex.get(`frame-${step.parentFrameId}`)
        : undefined;
    const node: ExecutionNode = {
        nodeId: `frame-${step.frameId}`,
        type: "stack_frame",
        parentId: parentFrameNode?.nodeId,
        ...
    };
}
```

No depth arithmetic. The recursion chain is a linked list of `stack_frame` nodes connected by explicit `parentId` references, with `"call"` edges in `ExecutionEdge[]` for arrow rendering.

### 6.2 Multiple Sequential Function Calls in Same Scope

```c
foo();    // produces frame-foo-0
bar();    // produces frame-bar-1
baz();    // produces frame-baz-2
```

All three `func_enter` events carry the same `parentFrameId` (the caller's frameId). All three resulting `stack_frame` nodes have the same `parentId` (the caller's frame node). Their `call_site` nodes are children of the same parent node. Sequential calls never interfere with each other because state is not accumulated — each `func_enter` is processed independently, and the caller's context stacks are unaffected by the callee's execution.

### 6.3 Single-Line `if` Without Braces

When `conditional_start` arrives, the builder performs a bounded forward look:

```typescript
private detectBracedBody(steps: ExecutionStep[], fromIndex: number, frameId: string): boolean {
    const LOOKAHEAD = 8;
    for (let i = fromIndex + 1; i < Math.min(fromIndex + LOOKAHEAD, steps.length); i++) {
        const s = steps[i];
        if (s.frameId !== frameId) continue;      // skip steps from other frames
        if (s.type === "block_enter") return true;
        if (s.type === "func_exit") return false;  // body ended without braces
        if (s.type === "var_declare" || s.type === "var_assign"
            || s.type === "output" || s.type === "input_request") {
            return false;  // a statement before block_enter → braceless
        }
    }
    return false; // default: assume braceless if unsure
}
```

This look-forward is bounded at parse time (before any dynamic state) and only examines step types — no depth arithmetic. For a braceless body, the builder sets `isBraced: false` on the `ConditionContext` and pops it after the **first child node** is placed. This is explicit and predictable.

If `block_enter` is missing for reasons other than bracelessness (instrumentation failure), the condition body still gets popped after one child. This is a graceful degradation: the child that belonged inside the condition gets it; subsequent steps fall to the frame. No lingering.

### 6.4 Nested Conditions

```c
if (a > 0) {          // pathId: main.1 (then), main.2 (else)
    if (b > 0) {      // pathId: main.1.1 (then), main.1.2 (else)
        x = 1;        // pathId: main.1.1
    }
    y = 2;            // pathId: main.1
}
```

The inner condition pushes a second `ConditionContext` onto the frame's `conditionStack`. `resolveParentId` returns `conditionStack.at(-1)` — always the innermost. When `block_exit` pops the inner condition, the outer condition is again the top of stack. `y = 2` then correctly resolves to the outer condition body. Path IDs nest naturally by construction.

### 6.5 Early Returns

When `func_exit` arrives, all nodes emitted **after** this point in the same `frameId` are impossible by definition (the frame has returned). The builder pops the `BuilderFrame` on `func_exit`. Any subsequent step carrying the same `frameId` (which should not happen) would find no active frame and fall to a degenerate root node — not to any condition body.

### 6.6 Multiple Return Sub-Expressions

```c
return computeFoo(a, b) + x;
```

This line emits: `var_load` (a), `var_load` (b), `func_enter` (computeFoo), ..., `func_exit` (computeFoo), `var_load` (x), then `func_exit` (the returning function). The `var_load` steps arrive while the caller's frame is still active. The active `ConditionContext` (if the return is inside an `if`) would normally capture them. The builder avoids this with an **explicit return annotation**: when `func_exit` is detected to be immediately following (within N steps in the same frame) a set of `var_load`/`var_assign` steps, those steps are tagged during the look-forward and their `parentId` is set to the function frame node, not the condition node. This is identical in spirit to the current 6-step lookahead but is applied at build time, not render time. Since the builder has already assigned `parentId` before LayoutEngine runs, LayoutEngine does not need to second-guess it.

As a simpler alternative: track a `pendingReturnSteps` set per frame. When `func_exit` is processed, retroactively reassign the `parentId` of the last N nodes in the frame (those on the return line) to the frame node. This retroactive correction is feasible because the builder processes all steps before LayoutEngine runs.

### 6.7 Missing `block_enter`/`block_exit`

If `block_enter` never arrives after `conditional_start`, the braceless detection (Part 6.3) handles it. If `block_exit` never arrives (instrumentation gap mid-trace), the `ConditionContext` remains on the stack. The builder detects this at `func_exit`: any remaining condition contexts on the frame are forcibly popped. Nodes already assigned to those condition bodies retain their `parentId` — no corruption. Future steps (in sibling or parent frames) are unaffected because the frame's context stack is discarded with the frame.

---

## Part 7 — Performance Impact

### 7.1 Time Complexity

`ExecutionStructureBuilder.build()` performs a single forward pass through `steps`. Each step is processed in amortized O(1) time:

- `conditionStack.at(-1)` and `loopStack.at(-1)` are O(1) array tail operations.
- `nodeIndex.set()` and `nodeIndex.get()` on a `Map` are O(1) amortized.
- The bounded look-forward for braceless detection (8 steps) is O(1) per `conditional_start`.

Total time complexity: **O(n)** where n = number of steps.

The current LayoutEngine is also O(n) in the number of steps, but its constant factor is higher due to: scanning `activeControlByDepth` (which may have multiple entries), running `isReturnExpressionFlowStep` (up to 6 steps per `var_load`), and maintaining multiple parallel maps. The builder's constant factor is lower.

### 7.2 Memory

Each `ExecutionNode` carries approximately:
- 8 string fields (average 20 chars each = ~160 bytes)
- `children: string[]` (amortized ~3 entries × 20 chars = ~60 bytes)
- `data: Record` (type-dependent, average ~100 bytes)
- Total: **~320 bytes per node**

Node count is bounded by step count, because the builder creates at most one node per step. At 1,000 steps: ~320 KB. At 10,000 steps: ~3.2 MB. The `nodeIndex` Map adds ~50 bytes of overhead per entry (V8 Map internals). At 10,000 steps: additional ~500 KB. These figures are well within browser memory budgets for a developer tool.

The original `ExecutionStep[]` is retained (not duplicated) — `stepRange` stores indices, not copies.

### 7.3 Latency Before First Render

Benchmark estimates (single-threaded on a modern browser, M1-class or equivalent x86):

| Trace size (steps) | Build time estimate | Notes |
|--------------------|--------------------|------------------------------------|
| 1,000              | 1–3 ms             | Negligible                         |
| 5,000              | 5–15 ms            | Imperceptible to user              |
| 10,000             | 10–30 ms           | Still within a single animation frame |
| 50,000             | 50–150 ms          | Noticeable; mitigation needed      |
| 100,000+           | 100–300 ms         | Must use Web Worker                |

For typical C/C++ educational programs (< 10,000 steps), no mitigation is needed. The build completes within one frame before the first paint.

### 7.4 Main Thread Mitigation

For large traces, `ExecutionStructureBuilder` can be moved to a Web Worker without any API changes:

```typescript
// worker.ts
self.onmessage = (e: MessageEvent<ExecutionStep[]>) => {
    const graph = ExecutionStructureBuilder.build(e.data);
    self.postMessage(graph);
};
```

The `ExecutionGraph` is transferable as a plain object (no non-serializable members). The `nodeIndex` Map must be reconstructed on the main thread from the transferred `nodes` array (one pass, O(n)).

Alternatively, the builder can process steps in **chunks of 500**, yielding to the event loop with `setTimeout(0)` between chunks. This enables progressive rendering: LayoutEngine can begin consuming the partial graph immediately while the builder continues. The first visible frames appear within milliseconds.

---

## Part 8 — Trace Transfer Overhead

### 8.1 No Backend Changes Required

`ExecutionStructureBuilder` operates entirely on the frontend. It consumes the existing `ExecutionStep[]` produced by `traceProcessor.ts`. No changes to the backend API, the event format, or the network transfer protocol are required.

### 8.2 No Additional Network Data

The `ExecutionGraph` is built in-browser from data already transferred. Network payload size is unchanged. The backend continues to emit the same JSON event stream.

### 8.3 `stepRange` Replaces Data Duplication

Instead of copying fields from `ExecutionStep` into `ExecutionNode.data`, the builder stores `stepRange: [firstStepIndex, lastStepIndex]`. LayoutEngine retrieves the original step when type-specific fields are needed:

```typescript
const step = executionSteps[node.stepRange[0]];
const varName = step.variableName;
const value = step.value;
```

This design means `ExecutionNode.data` is a thin overlay of derived or aggregated fields (e.g., `iterationCount` on a `loop` node), not a copy of raw step data.

### 8.4 Serialization Cost

`nodeIndex` is an in-memory `Map` — it is never serialized to JSON or transferred over the network. It is reconstructed from the `nodes` array each time. If the `ExecutionGraph` is transferred to/from a Web Worker, only the `nodes` array (plain objects), `edges` array, and `roots` array need transfer. The `nodeIndex` is rebuilt on the receiving end in one O(n) pass.

### 8.5 Estimated Memory Overhead Per 1,000 Steps

| Component                  | Overhead per 1,000 steps |
|----------------------------|--------------------------|
| `ExecutionNode[]`          | ~320 KB                  |
| `nodeIndex` Map            | ~50 KB                   |
| `ExecutionEdge[]`          | ~10 KB (edges are sparse)|
| `ExecutionPath` Map        | ~5 KB                    |
| **Total**                  | **~385 KB**              |

The pre-existing `ExecutionStep[]` at 1,000 steps is approximately 200–400 KB depending on field richness. The `ExecutionGraph` adds a comparable overhead (< 2× the step array size).

---

## Part 9 — Benefits of the New Architecture

### 9.1 Deterministic Parent-Child Ownership

The current system resolves `parentId` by scanning `activeControlByDepth` with a depth comparison at render time. The result depends on which steps happened to carry valid `scopeDepth` values, which condition bodies happened to have been pruned, and which frame happened to be current when the heuristics fired.

The new system assigns `parentId` during the build pass using the explicit context stacks. The `conditionStack.at(-1)` determines the parent. This is deterministic: given the same `ExecutionStep[]`, the builder always produces the same `ExecutionGraph`. There are no timing-sensitive or order-sensitive heuristics.

### 9.2 Elimination of Container Drift and Stale-Depth Bugs

"Container drift" is the current system's failure mode where elements slide into the wrong parent because a stale `scopeDepth` prevented pruning. Since the new system does not use `scopeDepth` for parent resolution at all (it uses the explicit context stacks, maintained by the builder's own event processing), stale depth values cannot cause container drift. The `scopeDepth` field remains available on nodes for LayoutEngine to use for visual indentation, but structural ownership is divorced from it entirely.

### 9.3 No Ephemeral Condition Tracking

The current system's `ephemeralControlByDepth` and `usedAtStep` mechanism is eliminated. Braceless `if` bodies are detected once at build time, and their `ConditionContext` is popped after the first child is placed. The LayoutEngine never needs to manage ephemeral state.

### 9.4 No 6-Step Lookahead

`isReturnExpressionFlowStep` and all associated lookahead logic are eliminated from LayoutEngine. Return sub-expression reassignment is handled at build time by the retroactive correction described in Part 6.6. LayoutEngine becomes a stateless layout engine, not a structural interpreter.

### 9.5 Stable Recursion Rendering

Each recursive frame node has an explicit `parentId` pointing to its caller's frame node. LayoutEngine can traverse the `parentId` chain to compute nesting depth deterministically. It can also pre-compute the total recursion depth from the `ExecutionGraph` metadata and scale `FUNCTION_VERTICAL_SPACING` accordingly before placing any element — something impossible in the current reactive system.

### 9.6 LayoutEngine Becomes a Pure Layout Consumer

After this change, LayoutEngine's only responsibilities are:

1. Traverse `ExecutionGraph.nodes` in order.
2. Create a `LayoutElement` for each `ExecutionNode`.
3. Assign canvas coordinates based on `node.parentId`, `node.depth`, and `node.type`.
4. Draw edges from `ExecutionGraph.edges`.

All structural decisions (who is whose parent, which branch was taken, which scope a variable belongs to) are resolved before LayoutEngine runs. This is a clean separation of concerns: structure is computed once; layout is computed independently.

### 9.7 Debuggability

The `ExecutionGraph` is a plain JSON-serializable object. During development, `JSON.stringify(graph.nodes.slice(0, 50))` produces a human-readable ownership tree. The `pathId` on each node immediately identifies which control-flow branch it belongs to. Bugs in parent assignment are visible by inspecting the graph before any rendering occurs — no need to reproduce visual glitches.

### 9.8 Better Support for Complex Control Flow

The path system (Part 5) handles switch-case fanout, loops-in-recursion, and nested if-in-loop-in-if correctly by construction. Path IDs are compositional: `main.2.3.1` unambiguously identifies the first branch nested inside the third iteration of the second branch of the main path. LayoutEngine can use `pathId` to group and color-code branches visually without any additional bookkeeping.

---

## Part 10 — Migration Plan

### Phase 1 — Implement `ExecutionStructureBuilder` in Isolation

Create `src/services/execution-structure-builder.ts` as a standalone module that exports:

```typescript
export class ExecutionStructureBuilder {
    static build(steps: ExecutionStep[]): ExecutionGraph;
}
```

The module has no dependencies on LayoutEngine, traceProcessor, or the canvas store. It imports only the `ExecutionStep` type from `traceProcessor.ts`. All types defined in Part 4 (`ExecutionNode`, `ExecutionEdge`, `ExecutionGraph`, etc.) are co-located in `src/types/execution-graph.ts`.

Write unit tests covering:
- Simple sequential function calls
- Recursive `factorial(5)` — verify `parentId` chain
- `if`/`else` with braced bodies — verify path IDs
- Braceless single-line `if` — verify condition context pops after one child
- `for` loop with 3 iterations — verify iteration path IDs
- Nested `if` inside `while` — verify combined path ID structure

### Phase 2 — Feature Flag `USE_EXECUTION_GRAPH`

Add a boolean `useExecutionGraph: boolean` to the canvas Zustand store (or environment configuration):

```typescript
// canvasStore.ts
useExecutionGraph: false,  // default: off
```

In `VisualizationCanvas.tsx`, after `traceProcessor.ts` produces `steps`:

```typescript
const graph = useExecutionGraph
    ? ExecutionStructureBuilder.build(steps)
    : null;
```

Pass `graph` (or `null`) down to LayoutEngine. LayoutEngine ignores `graph` when it is `null` and uses its existing heuristic path.

### Phase 3 — Parallel Comparison

With `useExecutionGraph: true` (but LayoutEngine still using heuristics), run both systems simultaneously on the same trace and log discrepancies:

```typescript
if (graph) {
    for (const node of graph.nodes) {
        const legacyParentId = LayoutEngine.getLegacyParentId(node.stepRange[0]);
        if (legacyParentId !== node.parentId) {
            console.warn("GRAPH_MISMATCH", {
                stepIndex: node.stepRange[0],
                graphParentId: node.parentId,
                legacyParentId,
            });
        }
    }
}
```

Run the test case suite from Phase 1 in the browser with real traces. Collect discrepancy logs. Each discrepancy is either a bug in `ExecutionStructureBuilder` or confirmation that the legacy heuristic was wrong. Resolve discrepancies by examining the trace events surrounding the mismatch.

### Phase 4 — Switch LayoutEngine to Consume `ExecutionGraph`

Replace `resolvePlacementParent` in LayoutEngine with a graph lookup:

```typescript
private static resolvePlacementParent(node: ExecutionNode): LayoutElement {
    if (this.graph && node.parentId) {
        const parentNode = this.graph.nodeIndex.get(node.parentId);
        return this.elementIndex.get(parentNode.nodeId) ?? this.rootElement;
    }
    // legacy fallback
    return this.legacyResolvePlacementParent(...);
}
```

This is non-breaking: `legacyResolvePlacementParent` remains operational when `graph` is null.

Over subsequent PRs, migrate leaf-level parent queries one node type at a time, confirming correct rendering at each step. Order of migration:

1. `variable` nodes (lowest risk — most numerous, easiest to verify)
2. `output` and `input` nodes (currently stale-depth prone)
3. `condition` and `condition_branch` nodes
4. `loop` and `loop_iteration` nodes
5. `stack_frame` and `call_site` nodes (highest risk — affect overall layout)

### Phase 5 — Remove Deprecated Heuristic Code Paths

Once all node types are resolved via `ExecutionGraph`, remove:

- `activeControlByDepth` and all uses
- `ephemeralControlByDepth` and all uses
- `pruneControlDepthForScope`
- `getActiveControlParent`
- `isReturnExpressionFlowStep`
- `resolveCallSiteScopeDepth`
- `resolveBranchActivationDepth`
- `currentScopeDepth` (the stale-depth cache)
- The `legacyResolvePlacementParent` fallback branch

The feature flag `useExecutionGraph` is removed and replaced with unconditional graph usage.

### Phase 6 — Parity Definition and Test Cases

"Parity" is defined as: for every test trace, every `LayoutElement`'s `parentId` matches the `parentId` assigned by `ExecutionStructureBuilder`, and the visual output is correct by inspection.

Required test traces for parity sign-off:

| Test case | Key behaviors exercised |
|-----------|------------------------|
| `recursive_fibonacci(6)` | Recursion chain, multiple `parentFrameId` levels, return sub-expressions |
| `nested_if_else_if` | Nested conditions, else-if chains, path ID nesting |
| `switch_with_fallthrough` | Switch arm detection, fallthrough (no `block_exit` between cases) |
| `while_loop_with_break` | Loop iterations, early exit (break before `loop_end`) |
| `pointer_and_heap` | Heap allocation, pointer edges, `pointer` and `heap_object` nodes |
| `braceless_single_if_chain` | Multiple sequential braceless ifs, no interference |
| `printf_in_condition` | `output` steps inside `if` body, stale-depth pattern |

Each test trace is run with both systems in parallel (Phase 3 mode). Zero discrepancies in the comparison log is the parity threshold.

---

*End of document.*
