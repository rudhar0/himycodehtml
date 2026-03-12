// frontend/src/components/canvas/layout/FlowPlacementCoordinator.ts

import type { LayoutElement } from './LayoutEngine';

export class FlowPlacementCoordinator {

  // ─── State ───────────────────────────────────────────────



  // Stores call_site elements that need standalone rendering
  // These are removed from condition body hierarchy and registered here
  private standaloneCallSites: LayoutElement[] = [];

  // Maps frameId → the function frame element
  // Used for post-layout arrow correction
  private frameRegistry: Map<string, LayoutElement> = new Map();

  // Maps arrow id → arrow element
  // Used for post-layout arrow Y correction
  private arrowRegistry: Map<string, LayoutElement> = new Map();

  /**
   * Call this at the START of every calculateLayout() call.
   * Clears all state from the previous layout pass.
   */
  reset(): void {
    this.frameRegistry.clear();
    this.arrowRegistry.clear();
  }


  /**
   * Call this when a call_site element has been created and placed
   * by the existing LayoutEngine logic.
   *
   * This method:
   *   1. Registers the call_site for standalone rendering
   *   2. Returns the call_site's Y position (used as frame anchor)
   *
   * DO NOT remove call_site from layout.elements.
   * DO remove it from its parent.children (so it doesn't render twice).
   */
  registerCallSite(callSite: LayoutElement): number {
    return callSite.y;
  }


  /**
   * Call this to get the funcY for a new function frame.
   *
   * Rules:
   *   - Use triggerY (from registerCallSite) as primary anchor
   *   - Use global lastFrameBottom as collision floor
   *   - Use per-column columnFloor as secondary collision floor
   *   - Advance both floors after placement
   *
   * @param callDepth  The call depth of the frame (used for column tracking)
   * @param triggerY   The Y from registerCallSite (or null if no call_site)
   * @returns The funcY to use for the frame
   */
  computeFrameY(callDepth: number, triggerY: number | null): number {
    const OFFSET = 0;
    return triggerY !== null ? triggerY + OFFSET : 40;
  }


  /**
   * Call this after the function frame element is created.
   * Registers it and its arrow for post-layout correction.
   */
  registerFrame(frameId: string, frame: LayoutElement): void {
    this.frameRegistry.set(frameId, frame);
  }

  registerArrow(arrowId: string, arrow: LayoutElement): void {
    this.arrowRegistry.set(arrowId, arrow);
  }


  /**
   * Call this AFTER updateContainerHeights() has run.
   * At this point, all frame heights are finalized.
   * This method corrects arrow toY coordinates to match actual frame positions.
   *
   * This eliminates the arrow drift / flicker caused by estimated heights.
   */
  correctArrowCoordinates(): void {
    this.arrowRegistry.forEach((arrow, arrowId) => {
      // Arrow id format: "arrow-{parentFrameId}-to-{frameId}"
      const parts = arrowId.split('-to-');
      if (parts.length < 2) return;
      const frameId = parts[parts.length - 1];
      const frame = this.frameRegistry.get(frameId);
      if (!frame) return;

      // Update toY to actual frame Y + header midpoint
      if (arrow.data) {
        arrow.data.toY = frame.y + 30; // 30 = midpoint of frame header
        arrow.data.toX = frame.x;      // in case frame X also shifted
      }
    });
  }

}

// Export a singleton instance — same pattern as LayoutEngine (static class)
export const flowCoordinator = new FlowPlacementCoordinator();
