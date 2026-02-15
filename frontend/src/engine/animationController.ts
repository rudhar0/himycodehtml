// src/engine/animationController.ts
// ============================================================================
// AnimationController — Delta-based animation helper
//
// Compares previous and new positions, and only triggers animations for
// changed elements. Works WITH the existing GSAP Timelines.ts animation
// functions — does NOT replace them.
//
// API:
//   animateDelta(delta, stage)  — Animate only changed elements
// ============================================================================

import type { PositionDelta, ElementPosition } from './position';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AnimationTarget {
  id: string;
  kind: 'enter' | 'update' | 'exit';
  fromX?: number;
  fromY?: number;
  toX: number;
  toY: number;
  width: number;
  height: number;
  data: Record<string, any>;
}

// ---------------------------------------------------------------------------
// AnimationController
// ---------------------------------------------------------------------------

export class AnimationController {
  private inFlightAnimations: Set<string> = new Set();

  /**
   * Convert a PositionDelta into animation targets.
   *
   * @param delta               The diff from PositionManager.getDelta()
   * @param previousPositions   For exit/move animations
   * @returns Array of targets to animate
   */
  animateDelta(
    delta: PositionDelta,
    previousPositions?: Map<string, ElementPosition>,
  ): AnimationTarget[] {
    const targets: AnimationTarget[] = [];

    // 1. New elements → enter animation
    delta.added.forEach((pos, id) => {
      targets.push({
        id,
        kind: 'enter',
        toX: pos.x,
        toY: pos.y,
        width: pos.width,
        height: pos.height,
        data: pos.data,
      });
    });

    // 2. Updated elements → update animation (move/resize/data change)
    delta.updated.forEach((pos, id) => {
      const prev = previousPositions?.get(id);
      targets.push({
        id,
        kind: 'update',
        fromX: prev?.x ?? pos.x,
        fromY: prev?.y ?? pos.y,
        toX: pos.x,
        toY: pos.y,
        width: pos.width,
        height: pos.height,
        data: pos.data,
      });
    });

    // 3. Removed elements → exit animation
    delta.removed.forEach((id) => {
      const prev = previousPositions?.get(id);
      if (prev) {
        targets.push({
          id,
          kind: 'exit',
          toX: prev.x,
          toY: prev.y - 20, // Slide up on exit
          width: prev.width,
          height: prev.height,
          data: prev.data,
        });
      }
    });

    return targets;
  }

  /**
   * Track in-flight animations to prevent overlapping.
   */
  markAnimating(id: string): void {
    this.inFlightAnimations.add(id);
  }

  markComplete(id: string): void {
    this.inFlightAnimations.delete(id);
  }

  isAnimating(id: string): boolean {
    return this.inFlightAnimations.has(id);
  }

  clearAll(): void {
    this.inFlightAnimations.clear();
  }
}
