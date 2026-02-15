// src/engine/index.ts
// ============================================================================
// Barrel export for the engine modules
// ============================================================================

export { processRawTrace, normalizeStepType, MAX_TRACE_STEPS } from './traceProcessor';
export type { ProcessedTrace } from './traceProcessor';

export { RelationManager } from './relation';
export type { RelationNode, RelationNodeType, RelationTree } from './relation';

export { PositionManager } from './position';
export type { ElementPosition, PositionDelta } from './position';

export { CameraManager } from './camera';
export type { CameraTransform, FocusOptions } from './camera';

export { AnimationController } from './animationController';
export type { AnimationTarget } from './animationController';
