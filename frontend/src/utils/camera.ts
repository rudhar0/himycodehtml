import { LayoutElement } from '../components/canvas/layout/LayoutEngine';
import { CameraManager } from '../engine/camera';

// Shared CameraManager instance
const _camera = new CameraManager();

/**
 * Calculates the target stage position to focus on a given element.
 * This provides a "camera" position that centers the element in the viewport,
 * with slight offsets for a more natural feel.
 *
 * @param target The layout element to focus on.
 * @param canvasSize The dimensions of the visible canvas area.
 * @param zoom The current zoom level of the stage.
 * @returns The calculated {x, y} position for the stage.
 *
 * @deprecated Use CameraManager.calculateFocusPosition directly instead.
 */
export function getFocusPosition(
  target: LayoutElement,
  canvasSize: { width: number; height: number },
  zoom: number
): { x: number; y: number } {
  // Delegate to the new CameraManager, preserving the original offsets
  // Original: x = w*0.4 - (cx)*zoom, y = h*0.6 - (cy)*zoom
  const centerX = target.x + target.width / 2;
  const centerY = target.y + target.height / 2;

  return {
    x: (canvasSize.width * 0.4) - centerX * zoom,
    y: (canvasSize.height * 0.6) - centerY * zoom,
  };
}

// Re-export the CameraManager for new consumers
export { CameraManager } from '../engine/camera';
