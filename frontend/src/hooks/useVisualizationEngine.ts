// src/hooks/useVisualizationEngine.ts
// ============================================================================
// useVisualizationEngine — Incremental step update hook
//
// Wires the new engine modules (RelationManager, PositionManager,
// CameraManager, AnimationController) into a single hook that
// VisualizationCanvas.tsx can consume.
//
// Key performance win: on each step change, only the DELTA is computed
// and returned. Full rebuilds only happen on trace load or large jumps.
// ============================================================================

import { useRef, useMemo, useCallback } from 'react';
import { useExecutionStore } from '@store/slices/executionSlice';
import { RelationManager } from '../engine/relation';
import { PositionManager, type ElementPosition, type PositionDelta } from '../engine/position';
import { CameraManager, type CameraTransform } from '../engine/camera';
import { AnimationController, type AnimationTarget } from '../engine/animationController';

// ---------------------------------------------------------------------------
// Hook return type
// ---------------------------------------------------------------------------

export interface VisualizationEngineState {
  /** All current element positions */
  positions: Map<string, ElementPosition>;
  /** Delta since last step (null on first render or full rebuild) */
  delta: PositionDelta | null;
  /** Animation targets derived from the delta */
  animationTargets: AnimationTarget[];
  /** Current camera transform */
  cameraTransform: CameraTransform;
  /** Whether the camera is still lerping */
  isCameraAnimating: boolean;
  /** Manual camera controls */
  setZoom: (scale: number) => void;
  pan: (dx: number, dy: number) => void;
  fitToScreen: () => void;
  /** Force a full rebuild (e.g. after a large step jump) */
  rebuild: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVisualizationEngine(
  canvasWidth: number,
  canvasHeight: number,
): VisualizationEngineState {
  // Persistent engine instances (survive re-renders)
  const relationRef = useRef(new RelationManager());
  const positionRef = useRef(new PositionManager());
  const cameraRef = useRef(new CameraManager());
  const animControllerRef = useRef(new AnimationController());

  // Previous state for delta calculation
  const prevStepRef = useRef<number>(-1);
  const prevPositionsRef = useRef<Map<string, ElementPosition>>(new Map());
  const builtTraceIdRef = useRef<string | null>(null);

  // Store subscriptions
  const executionTrace = useExecutionStore((s) => s.executionTrace);
  const currentStep = useExecutionStore((s) => s.currentStep);
  const needsCanvasRebuild = useExecutionStore((s) => s.needsCanvasRebuild);
  const markCanvasRebuildComplete = useExecutionStore(
    (s) => s.markCanvasRebuildComplete,
  );

  // Update viewport on canvas resize
  cameraRef.current.setViewport(canvasWidth, canvasHeight);

  // -----------------------------------------------------------------------
  // Compute positions (memoised on step + trace identity)
  // -----------------------------------------------------------------------
  const { positions, delta, animationTargets } = useMemo(() => {
    const relation = relationRef.current;
    const position = positionRef.current;
    const camera = cameraRef.current;
    const animator = animControllerRef.current;

    if (!executionTrace || executionTrace.steps.length === 0) {
      return {
        positions: new Map<string, ElementPosition>(),
        delta: null as PositionDelta | null,
        animationTargets: [] as AnimationTarget[],
      };
    }

    // ── Full rebuild? ──
    const traceId = `trace-${executionTrace.totalSteps}`;
    const isNewTrace = traceId !== builtTraceIdRef.current;
    const isLargeJump =
      Math.abs(currentStep - prevStepRef.current) > 1 || needsCanvasRebuild;
    const needsFullRebuild = isNewTrace || isLargeJump;

    if (needsFullRebuild) {
      // Rebuild relation tree from scratch up to currentStep
      relation.reset();
      for (let i = 0; i <= currentStep; i++) {
        const step = executionTrace.steps[i];
        if (step) relation.applyStep(step, i);
      }

      builtTraceIdRef.current = traceId;

      if (needsCanvasRebuild) {
        markCanvasRebuildComplete();
      }
    } else {
      // Incremental: only process the new step
      const step = executionTrace.steps[currentStep];
      if (step) relation.applyStep(step, currentStep);
    }

    // ── Compute positions ──
    const tree = relation.getTree();
    position.updateFromRelation(tree, currentStep);
    const allPositions = position.getAllPositions();

    // ── Compute delta ──
    let stepDelta: PositionDelta | null = null;
    let targets: AnimationTarget[] = [];

    if (!needsFullRebuild && prevPositionsRef.current.size > 0) {
      stepDelta = position.getDelta();
      targets = animator.animateDelta(stepDelta, prevPositionsRef.current);
    }

    // ── Update camera ──
    camera.update(currentStep, allPositions, prevStepRef.current);

    // ── Store previous state ──
    prevPositionsRef.current = allPositions;
    prevStepRef.current = currentStep;

    return {
      positions: allPositions,
      delta: stepDelta,
      animationTargets: targets,
    };
  }, [
    executionTrace,
    currentStep,
    needsCanvasRebuild,
    markCanvasRebuildComplete,
  ]);

  // -----------------------------------------------------------------------
  // Camera transform (not memoised — call getTransform() each render)
  // -----------------------------------------------------------------------
  const cameraTransform = cameraRef.current.getTransform();
  const isCameraAnimating = cameraRef.current.isAnimating();

  // -----------------------------------------------------------------------
  // Camera controls
  // -----------------------------------------------------------------------
  const setZoom = useCallback(
    (scale: number) => cameraRef.current.setZoom(scale),
    [],
  );
  const pan = useCallback(
    (dx: number, dy: number) => cameraRef.current.pan(dx, dy),
    [],
  );
  const fitToScreen = useCallback(
    () => cameraRef.current.fitToScreen(),
    [],
  );
  const rebuild = useCallback(() => {
    builtTraceIdRef.current = null; // Force full rebuild on next render
    prevPositionsRef.current = new Map();
    prevStepRef.current = -1;
  }, []);

  return {
    positions,
    delta,
    animationTargets,
    cameraTransform,
    isCameraAnimating,
    setZoom,
    pan,
    fitToScreen,
    rebuild,
  };
}
