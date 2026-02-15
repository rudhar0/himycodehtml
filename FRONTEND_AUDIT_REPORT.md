# Frontend Runtime Pipeline Forensic Analysis

## Structured Performance Diagnosis

```json
[
  {
    "stage": "API (useSocket)",
    "avg_latency_estimate": "50ms - 200ms per large chunk",
    "regression_risk": "Low",
    "root_cause": "Synchronous JSON.parse on main thread during chunk arrival.",
    "improvement_strategy": "Stream raw string chunks to Worker; perform JSON.parse in-worker."
  },
  {
    "stage": "Session Manager (Trace Storage)",
    "avg_latency_estimate": "100ms - 500ms (copying)",
    "regression_risk": "Medium",
    "root_cause": "Large array of objects in Zustand store causes memory pressure and GC spikes. structuredClone on 500+ steps is expensive.",
    "improvement_strategy": "Store trace in a Pooled Session Storage using SharedArrayBuffer or Transferable TypedArrays."
  },
  {
    "stage": "Execute (TraceProcessor)",
    "avg_latency_estimate": "200ms - 800ms (Post-load)",
    "regression_risk": "High",
    "root_cause": "Linear trace normalization on 500+ steps blocks main thread. structuredClone(raw) inside loop is the #1 CPU killer.",
    "improvement_strategy": "Move TraceProcessor to Persistent Worker Pool. Use single-pass incremental processing."
  },
  {
    "stage": "Compile (Layout Engine / PositionManager)",
    "avg_latency_estimate": "16ms - 150ms per step",
    "regression_risk": "High",
    "root_cause": "Rebuilding RelationManager from step 0 to N on jump. Synchronous graph layout on main thread causes frame drops (>16ms).",
    "improvement_strategy": "Implement DAG-based session scheduling. Persistent RelationManager in Worker with snapshotting."
  },
  {
    "stage": "Trace (Write Latency / Delta)",
    "avg_latency_estimate": "10ms",
    "regression_risk": "Low",
    "root_cause": "Main thread diffing of large position maps.",
    "improvement_strategy": "Compute deltas in-worker; transfer only changed elements back to main thread."
  }
]
```

## Identified Hot Path Bottlenecks

1.  **Main-Thread Gridlock**: `useVisualizationEngine`'s `useMemo` blocks the UI during layout.
2.  **Redundant File Operations (Visual)**: Virtual "file" operations (mapping addr2line results) are sync.
3.  **Memory Allocation Churn**: Excessive `structuredClone` calls create high pressure on the young generation heap.
4.  **Serialization Overhead**: `useMemo` deps check on `executionTrace` (array comparison).

---

## Refactor Strategy: Advanced Execution Graph Engine

I am moving to a **Persistent Worker Pool** architecture where the rendering thread (Main) only handles **Telemetry** and **GSAP Animations**, while the **Execution Engines** (Workers) handle the heavy lifting.

### Pipeline Model (DAG)
Nodes: `ProcessChunk -> NormalizeStep -> UpdateRelation -> CalculateLayout -> GenerateDelta`
Edges: Data dependencies (e.g., Layout requires Relation update).
