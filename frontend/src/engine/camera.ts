// src/engine/camera.ts
// ============================================================================
// CameraManager — Viewport & focus manager with smooth lerp transitions
//
// Replacement for utils/camera.ts + scattered Konva Tween logic in
// VisualizationCanvas.tsx.
//
// API:
//   update(step, positions)   — Auto-focus on active element
//   getTransform()            — Returns { x, y, scale }
//   focusElement(id, opts?)   — Explicitly focus an element
//   setViewport(w, h)         — Update viewport dimensions
//   setZoom(scale)            — Manual zoom
//   pan(dx, dy)               — Manual pan
// ============================================================================

import type { ElementPosition } from './position';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CameraTransform {
  x: number;
  y: number;
  scale: number;
}

export interface FocusOptions {
  duration?: number;
  easing?: 'linear' | 'ease-in-out' | 'ease-out';
  padding?: number;
}

// ---------------------------------------------------------------------------
// CameraManager
// ---------------------------------------------------------------------------

export class CameraManager {
  private viewportWidth: number = 1200;
  private viewportHeight: number = 800;

  private targetX: number = 0;
  private targetY: number = 0;
  private currentX: number = 0;
  private currentY: number = 0;
  private scale: number = 1;

  // Lerp factor (0..1) — higher = snappier
  private lerpFactor: number = 0.15;

  // Auto-focus tracking
  private lastFocusedElementId: string | null = null;

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Set the viewport dimensions (e.g. on container resize).
   */
  setViewport(width: number, height: number): void {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }

  /**
   * Auto-focus camera on the most relevant element for the current step.
   *
   * @param currentStep  Current step index
   * @param positions    All current element positions
   * @param prevStep     Previous step index (for direction)
   */
  update(
    currentStep: number,
    positions: Map<string, ElementPosition>,
    prevStep: number = -1,
  ): void {
    const movingForward = prevStep < currentStep;

    // Find best focus target:
    // 1. New elements at this step (prefer latest Y)
    // 2. Updated elements at this step
    let bestTarget: ElementPosition | null = null;
    let bestY = -Infinity;

    positions.forEach((pos) => {
      const isAtCurrentStep = pos.stepId === currentStep;
      if (!isAtCurrentStep) return;

      if (pos.y > bestY) {
        bestY = pos.y;
        bestTarget = pos;
      }
    });

    if (bestTarget && movingForward) {
      this.focusElement(bestTarget.id, { duration: 0.4 }, positions);
    }
  }

  /**
   * Focus the camera on a specific element.
   */
  focusElement(
    elementId: string,
    options?: FocusOptions,
    positions?: Map<string, ElementPosition>,
  ): void {
    const pos = positions?.get(elementId);
    if (!pos) return;

    const { x, y } = this.calculateFocusPosition(pos);
    this.targetX = x;
    this.targetY = y;
    this.lastFocusedElementId = elementId;

    // If no lerp delay requested, snap immediately
    if (!options?.duration) {
      this.currentX = this.targetX;
      this.currentY = this.targetY;
    }
  }

  /**
   * Get the current camera transform (post-lerp).
   * Call this once per frame or on re-render.
   */
  getTransform(): CameraTransform {
    // Lerp towards target
    this.currentX += (this.targetX - this.currentX) * this.lerpFactor;
    this.currentY += (this.targetY - this.currentY) * this.lerpFactor;

    // Snap when close enough (avoid infinite tiny updates)
    if (Math.abs(this.targetX - this.currentX) < 0.5) this.currentX = this.targetX;
    if (Math.abs(this.targetY - this.currentY) < 0.5) this.currentY = this.targetY;

    return {
      x: this.currentX,
      y: this.currentY,
      scale: this.scale,
    };
  }

  /**
   * Returns true if the camera is still animating towards target.
   */
  isAnimating(): boolean {
    return (
      Math.abs(this.targetX - this.currentX) > 0.5 ||
      Math.abs(this.targetY - this.currentY) > 0.5
    );
  }

  setZoom(scale: number): void {
    this.scale = Math.max(0.1, Math.min(scale, 5));
  }

  pan(dx: number, dy: number): void {
    this.targetX += dx;
    this.targetY += dy;
    this.currentX = this.targetX;
    this.currentY = this.targetY;
  }

  /**
   * Reset camera to origin.
   */
  fitToScreen(): void {
    this.targetX = 0;
    this.targetY = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.scale = 1;
  }

  // -----------------------------------------------------------------------
  // Static utility (backwards-compatible with old getFocusPosition)
  // -----------------------------------------------------------------------

  /**
   * Pure function to calculate focus position for an element,
   * centering it in the viewport.
   */
  calculateFocusPosition(
    element: { x: number; y: number; width: number; height: number },
    viewport?: { width: number; height: number },
    scale?: number,
  ): { x: number; y: number } {
    const vw = viewport?.width ?? this.viewportWidth;
    const vh = viewport?.height ?? this.viewportHeight;
    const s = scale ?? this.scale;

    const centerX = element.x + element.width / 2;
    const centerY = element.y + element.height / 2;

    return {
      x: vw / 2 - centerX * s,
      y: vh / 2 - centerY * s,
    };
  }
}
