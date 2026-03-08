// frontend/src/ExecutionStructureBuilder.ts
// ============================================================================
// ExecutionStructureBuilder — Step annotation and condition tree building
//
// Provides two pure functions:
//   annotateStepsWithPlacementKeys(steps) — assigns stepKey + placementParentKey
//   buildConditionTree(steps)             — maps conditionId → ConditionNode
// ============================================================================

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
  if (steps.length && steps[0].stepKey) {
      return;
  }

  // First pass — assign globally-unique stepKey (FIX BUG 1: frame-qualified)
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    // Skip if already annotated
    if ((step as any).stepKey) continue;

    const frameId = String(step.frameId || 'unknown');
    step.stepKey = `${frameId}-step-${i}`;
    console.log('[STEPKEY assign]', step.stepKey, 'type:', step.eventType || step.type, 'conditionId:', step.conditionId);
  }

  // Build a lookup: conditionId → stepKey of its branch_taken event
  // (FIX BUG 2: use conditionId mapping, not last-branch heuristic)
  const branchTakenKeyByConditionId = new Map<string, string>();
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const eventType = String(step.eventType || step.type || '').toLowerCase().trim();
    if (eventType === 'branch_taken' || eventType === 'branch') {
      const conditionId = step.conditionId;
      if (conditionId) {
        // Only record the first branch_taken per conditionId
        if (!branchTakenKeyByConditionId.has(String(conditionId))) {
          branchTakenKeyByConditionId.set(String(conditionId), step.stepKey);
        }
      }
    }
  }

  // Second pass — assign placementParentKey via conditionId map
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    
    const conditionId = step.conditionId;
    if (conditionId) {
      const parentKey = branchTakenKeyByConditionId.get(String(conditionId));
      if (parentKey && parentKey !== step.stepKey) {
        // Verify the branch_taken step occurs before this step
        // We compare the step's own stepKey to know its index
        const myIndex = i;
        // Find the branch_taken step index by scanning (we store by stepKey)
        let branchIndex = -1;
        for (let j = 0; j < i; j++) {
          if (steps[j].stepKey === parentKey) {
            branchIndex = j;
            break;
          }
        }
        if (branchIndex >= 0 && branchIndex < myIndex) {
          step.placementParentKey = parentKey;
        } else {
          step.placementParentKey = null;
        }
      } else {
        step.placementParentKey = null;
      }
    } else {
      step.placementParentKey = null;
    }

    // Fallback: attach *_eval steps to the previous execution node
    if (!step.placementParentKey) {
      const eventType = String(step.eventType || step.type || '').toLowerCase().trim();

      if (
          eventType === 'condition_eval' ||
          eventType === 'loop_eval' ||
          eventType === 'switch_eval'
      ) {
          const prevStep = i > 0 ? steps[i - 1] : null;

          if (prevStep && prevStep.stepKey) {
              step.placementParentKey = prevStep.stepKey;
          }
      }
    }

    console.log('[STEPKEY]', step.stepKey, '→ placementParentKey:', step.placementParentKey);
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
    const eventType = String(step.eventType || step.type || '').toLowerCase().trim();
    if (eventType !== 'branch_taken' && eventType !== 'branch') continue;

    const conditionId = step.conditionId;
    if (!conditionId) continue;

    const key = String(conditionId);
    // Only record the first branch_taken per conditionId
    if (nodes.has(key)) continue;

    nodes.set(key, {
      conditionId: key,
      frameId: String(step.frameId || ''),
      takenBranchStepKey: step.stepKey ?? `${String(step.frameId || 'unknown')}-step-${i}`,
    });
  }

  return { nodes };
}
