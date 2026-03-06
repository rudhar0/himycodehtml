# EXECUTION_STRUCTURE_BUILDER_IMPLEMENTATION.md

---

## Overview

The **ExecutionStructureBuilder (ESB)** is a deterministic execution tree pipeline that runs in **parallel** with the existing trace pipeline. It does **not** replace any existing code — it is fully additive.

```
InstrumentationTracer.generateTrace()
         │
         ├──→ [EXISTING] socket.emit(CODE_TRACE_CHUNK)   → traceProcessor → LayoutEngine
         │
         └──→ [NEW]  executionStructureBuilder.buildGraph()
                        └── socket.emit(EXECUTION_STRUCTURE_GRAPH)
                                └── ExecutionStructureStore.load()
```

---

## Files Created / Modified

| Action   | File                                                              |
|----------|-------------------------------------------------------------------|
| **NEW**  | `backend/src/services/execution-structure-builder.service.js`     |
| **NEW**  | `frontend/src/engine/executionStructureBuilder.ts`                |
| **NEW**  | `frontend/src/socket/executionStructure.socket.ts`                |
| append   | `backend/src/constants/events.js`                                 |
| append   | `backend/src/sockets/index.js`                                    |
| append   | `frontend/src/engine/index.ts`                                    |

---

## Node Schema

```ts
interface ESBNode {
  nodeId:      string;          // Globally unique: "esb-function-0"
  type:        ESBNodeType;     // See types below
  label:       string;          // Human-readable description
  frameId:     string | null;   // Which call frame this belongs to
  conditionId: string | null;   // Which condition owns this (if any)
  parentId:    string | null;   // Parent node ID
  children:    string[];        // Child node IDs
  depth:       number;          // Structural depth (not scopeDepth)
  pathId:      string;          // Control-flow path e.g. "main.cond_X.true"
  stepStart:   number;          // First step index contained in this node
  stepEnd:     number | null;   // Last step index (null = still open)
  meta:        Record<string, any>; // Extra data (value, dims, etc.)
}
```

### Node Types

| Type        | Created On                               |
|-------------|------------------------------------------|
| `program`   | Always — root of the entire tree         |
| `function`  | `func_enter` (with `isFunctionEntry`)    |
| `condition` | `condition_eval`, `conditional_start`    |
| `branch`    | `branch_taken`, `conditional_branch`     |
| `loop`      | `loop_start`                             |
| `loop_body` | `loop_body_start`                        |
| `return`    | `return`                                 |
| `variable`  | `var`, `var_declare`, `assignment`, `arg_bind` |
| `array`     | `array_declaration`, `array_initialization`, `array_assignment` |
| `pointer`   | `heap_alloc`, `pointer_alias`, `pointer_write`, `pointer_deref` |
| `output`    | `output`                                 |
| `input`     | `input` (includes `scanf`)               |
| `call`      | `call_site`, `function_call`             |
| `statement` | All other events                         |

---

## ExecutionGraph Structure

```json
{
  "nodes": [ ...ESBNode[] ],
  "nodeMap": { "nodeId": ESBNode },
  "stepToNode": { "0": "esb-program-0", "1": "esb-function-0" },
  "paths": [
    { "pathId": "main", "segments": ["main"] },
    { "pathId": "main.fn_main-0", "segments": ["main", "fn_main-0"] }
  ],
  "metadata": {
    "totalNodes": 42,
    "totalPaths": 8,
    "totalSteps": 1024,
    "builtAt": 1709567890123
  }
}
```

### Key Invariants

- `stepToNode[N]` maps **every** step index `N` to a node ID
- `nodeMap[id]` is an O(1) lookup — no array scanning needed
- `pathId` uses `.` segments; branching appends `true`/`false`/`case_X`
- `depth` is structural tree depth — independent of `scopeDepth`

---

## Path System

Path IDs encode the *control-flow route* to any statement:

| Scenario                    | Path ID                          |
|-----------------------------|----------------------------------|
| Top-level main code         | `main.fn_main-0`                 |
| Inside first `if` true branch | `main.fn_main-0.cond_X.true`   |
| Inside first `if` else branch | `main.fn_main-0.cond_X.false`  |
| Inside a `for` loop, iter 1 | `main.fn_main-0.loop_L1.iter1`  |
| Inside switch case "foo"    | `main.fn_main-0.cond_X.case_foo`|
| Inside recursive `fact(2)`  | `main.fn_main-0.fn_factorial-1` |

All paths are stored in `graph.paths[]` and are deduplicated.

---

## Tree Algorithm (Pseudo-code)

```
nodeStack = [programNode]

for each step:
  evType = step.eventType

  if func_enter:
      node = createNode(FUNCTION, frameId)
      attach(node, peek())
      push(node, frameId)

  elif func_exit:
      while peek().frameId == frameId:
          close(peek()); pop()

  elif condition_eval | conditional_start:
      node = createNode(CONDITION, conditionId)
      attach(node, peek())
      push(node, conditionId)

  elif branch_taken | conditional_branch:
      close any open BRANCH for same conditionId
      node = createNode(BRANCH, branchType)
      attach(node, condNode)
      push(node)

  elif loop_start:
      node = createNode(LOOP, loopId)
      push(node)

  elif loop_body_start:
      close prev iteration body
      node = createNode(LOOP_BODY, iterN)
      push(node)

  elif loop_end:
      close LOOP_BODY + LOOP nodes for loopId

  elif return:
      leaf = createNode(RETURN)
      attach(leaf, peek())
      close active BRANCH nodes (early return)

  elif block_exit | scope_exit:
      close nodes deeper than current scopeDepth

  else:
      leafNode = createNode(resolveType(evType))
      attach(leafNode, peek())

  stepToNode[step.stepIndex] = currentNode.nodeId
```

**Complexity:** O(N) — single pass over steps with an explicit stack. No recursion.

---

## Socket Integration

### Backend (Server → Client)

Event name: `execution:structure:graph`

```js
// Emitted in backend/src/sockets/index.js
// AFTER existing CODE_TRACE_CHUNK emit — non-blocking, non-breaking
const esbGraph = executionStructureBuilder.buildGraph(traceResult.steps);
socket.emit(SOCKET_EVENTS.EXECUTION_STRUCTURE_GRAPH, { graph: esbGraph });
```

If the ESB build throws, the error is caught and logged — **it does NOT affect existing trace delivery**.

### Frontend (Client registration)

```ts
import { registerExecutionStructureListener } from './socket/executionStructure.socket';

// Call once after socket is connected, alongside your existing listeners:
registerExecutionStructureListener(socket);

// On cleanup / disconnect:
// unregisterExecutionStructureListener(socket);
```

---

## Frontend API

```ts
import { ExecutionStructureStore } from './engine';

// Get the node that owns step 42:
const node = ExecutionStructureStore.getNodeForStep(42);

// Get all children of a node:
const children = ExecutionStructureStore.getChildren(node.nodeId);

// Get the parent:
const parent = ExecutionStructureStore.getParent(node.nodeId);

// Get its control-flow path:
const path = ExecutionStructureStore.getPath(node.nodeId);

// Debug: compare with LayoutEngine's resolved parent
ExecutionStructureStore.compareWithLayoutEngine(stepIndex, layoutParentId);
// → logs [ESB MISMATCH] if they differ
```

---

## Debugging

Enable verbose logs by setting:

```
# Backend
ESB_DEBUG=true node server.js

# Frontend (auto-enabled in Vite dev mode via import.meta.env.DEV)
```

Log prefixes:

| Prefix           | Meaning                                    |
|------------------|--------------------------------------------|
| `[ESB NODE CREATE]` | A structural node was opened           |
| `[ESB NODE ATTACH]` | A leaf node was attached to a parent   |
| `[ESB NODE CLOSE]`  | A node was closed (stepEnd set)        |
| `[ESB PATH CREATE]` | A new path ID was registered           |
| `[ESB MISMATCH]`    | ESB parent differs from LayoutEngine   |
| `[ESB] Graph built` | Summary after each build               |
| `[ESB Socket]`      | Frontend listener events               |

---

## Performance

| Metric                    | Target    | Notes                                    |
|---------------------------|-----------|------------------------------------------|
| Time complexity           | O(N)      | Single pass, explicit stack              |
| 5 000 steps               | < 20 ms   | No recursion, no deep array scanning     |
| Memory per node           | ~200 B    | Only stores IDs, not step copies         |
| stepToNode map (5 000)    | ~40 KB    | Integer → string mapping                 |
| Network overhead          | **Zero**  | Graph built on **frontend** — wait...    |

> [!NOTE]
> Currently the graph is built on the **backend** and sent over socket. For very large traces (10 000+ steps) you may move `buildGraph()` to run client-side on the already-received steps instead, eliminating transport overhead entirely.

---

## Migration Plan (Phase Reference)

| Phase | Description                                                     | Status  |
|-------|-----------------------------------------------------------------|---------|
| A     | Build graph in parallel; expose `stepToNode` for inspection     | ✅ Done  |
| B     | Use ESB in `LayoutEngine` for variables only; keep conditions on old system | Future |
| C     | Full cutover: `resolvePlacementParent` uses `stepToNode`        | Future  |

---

## Edge Cases Handled

| Scenario                             | Handling                                                      |
|--------------------------------------|---------------------------------------------------------------|
| Recursion (same function, many frames) | Each `func_enter` creates a unique node keyed by `frameId`  |
| Nested conditions                    | Each `condition_eval` pushes a new CONDITION node onto stack  |
| Single-line `if` (no braces)         | `branch_taken` creates a BRANCH node even without `block_enter` |
| Multiple sequential function calls   | Both attach to the same parent (current stack top)            |
| Early `return` inside branch         | Return node created; active BRANCH nodes are closed           |
| Missing `block_enter` / `block_exit` | Fallback: use `scopeDepth` to close nodes deeper than current |
| `scanf` / input                      | Handled as `input` leaf nodes                                 |
| Arrays                               | `array_declaration`, `array_assignment` create ARRAY leaves   |
| Pointer operations                   | All pointer event types create POINTER leaves                 |
| Output (`cout`, `printf`)            | Creates OUTPUT leaves                                         |
