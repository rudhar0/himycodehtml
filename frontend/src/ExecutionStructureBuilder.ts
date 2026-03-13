// frontend/src/ExecutionStructureBuilder.ts
// ============================================================================
// ExecutionStructureBuilder — Step annotation and condition tree building
//
// Provides two pure functions:
//   annotateStepsWithPlacementKeys(steps) — assigns stepKey + placementParentKey
//   buildConditionTree(steps)             — maps conditionId → ConditionNode
// ============================================================================

const STEPKEY_DEBUG = false;

export interface ConditionNode {
  conditionId: string;
  frameId: string;
  takenBranchStepKey: string;
}

export interface ConditionTree {
  nodes: Map<string, ConditionNode>;
}

/**
 * Annotates every step with a globally-unique stepKey and a placementParentKey.
 *
 * stepKey format: "${frameId}-step-${index}"
 *   This guarantees uniqueness even in recursive frames.
 *   Example: "main-0-step-7", "factorial-11-step-9", "factorial-22-step-18"
 *
 * placementParentKey: the stepKey of the branch_taken step whose conditionId
 *   matches this step's conditionId, and which occurred BEFORE this step.
 *   Lookup is by conditionId, not by "last branch" — this correctly handles
 *   nested conditions (inner body linked to inner branch_taken, not outer).
 *
 * Mutates steps in-place.
 */
export function annotateStepsWithPlacementKeys(steps: any[]): void {
  // Prevent StepKey reassignment
 if (steps.every((s: any) => s.stepKey)) {
  return;
}

  // First pass — assign globally-unique stepKey (FIX BUG 1: frame-qualified)
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    // Skip if already annotated
    if ((step as any).stepKey) continue;

    const frameId = String(step.frameId || "unknown");
    step.stepKey = `${frameId}-step-${i}`;
    if (STEPKEY_DEBUG) {
      console.log(
        "[STEPKEY assign]",
        step.stepKey,
        "type:",
        step.eventType || step.type,
        "conditionId:",
        step.conditionId,
      );
    }
  }

  // Build a lookup: conditionId → stepKey of its branch_taken event
  // (FIX BUG 2: use conditionId mapping, not last-branch heuristic)
 // Build lookup: conditionId → first body stepKey
const bodyStartKeyByConditionId = new Map<string, string>();

for (let i = 0; i < steps.length; i++) {
  const step = steps[i];
  const eventType = String(step.eventType || step.type || "")
    .toLowerCase()
    .trim();

  if (eventType === "branch_taken" || eventType === "branch") {
    const conditionId = step.conditionId;
    const nextStep = steps[i + 1];

    if (conditionId && nextStep) {
      bodyStartKeyByConditionId.set(String(conditionId), nextStep.stepKey);
    }
  }

  // Handle loops similarly to track their body start
  if (eventType === "loop_start" || eventType === "loop") {
    const loopId = step.loopId || step.id; // Use id as fallback for loopId
    const nextStep = steps[i + 1];

    if (loopId && nextStep) {
      bodyStartKeyByConditionId.set(`loop-${loopId}`, nextStep.stepKey);
    }
  }
}

  // Second pass — assign placementParentKey via conditionId map
  // Second pass — assign placementParentKey via conditionId map
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const conditionId = step.conditionId;
    const eventType = String(step.eventType || step.type || "")
      .toLowerCase()
      .trim();
    const loopId = step.loopId;

    if (conditionId) {
      const parentKey = bodyStartKeyByConditionId.get(String(conditionId));
      // ... existing condition logic ...
      if (
        (eventType === "branch_taken" || eventType === "branch") &&
        parentKey === steps[i + 1]?.stepKey
      ) {
        step.placementParentKey = null;
      } else if (parentKey && parentKey !== step.stepKey) {
        step.placementParentKey = parentKey;
      } else {
        step.placementParentKey = null;
      }
    } else if (loopId) {
      const parentKey = bodyStartKeyByConditionId.get(`loop-${loopId}`);
      
      // loop_start steps should not parent themselves
      if (eventType === "loop_start" && parentKey === steps[i + 1]?.stepKey) {
        step.placementParentKey = null;
      } else if (parentKey && parentKey !== step.stepKey) {
        step.placementParentKey = parentKey;
      } else {
        step.placementParentKey = null;
      }
    } else {
      step.placementParentKey = null;
    }

    if (STEPKEY_DEBUG) {
      console.log(
        "[STEPKEY]",
        step.stepKey,
        "→ placementParentKey:",
        step.placementParentKey,
        "conditionId:",
        step.conditionId,
      );
    }
  }
}

/**
 * Builds a ConditionTree mapping conditionId → ConditionNode.
 * Each node records the first branch_taken event for that conditionId.
 *
 * Pure function — does not mutate steps.
 */
export function buildConditionTree(steps: any[]): ConditionTree {
  const nodes = new Map<string, ConditionNode>();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const eventType = String(step.eventType || step.type || "")
      .toLowerCase()
      .trim();
    if (eventType !== "branch_taken" && eventType !== "branch") continue;

    const conditionId = step.conditionId;
    if (!conditionId) continue;

    const key = String(conditionId);
    // Only record the first branch_taken per conditionId
    if (nodes.has(key)) continue;

    nodes.set(key, {
      conditionId: key,
      frameId: String(step.frameId || ""),
      takenBranchStepKey:
        step.stepKey ?? `${String(step.frameId || "unknown")}-step-${i}`,
    });
  }

  return { nodes };
}
