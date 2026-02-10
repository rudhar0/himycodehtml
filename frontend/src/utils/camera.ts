import { LayoutElement } from '../components/canvas/layout/LayoutEngine';

/**
 * Calculates the target stage position to focus on a given element.
 * This provides a "camera" position that centers the element in the viewport,
 * with slight offsets for a more natural feel.
 *
 * @param target The layout element to focus on.
 * @param canvasSize The dimensions of the visible canvas area.
 * @param zoom The current zoom level of the stage.
 * @returns The calculated {x, y} position for the stage.
 */
export function getFocusPosition(
  target: LayoutElement,
  canvasSize: { width: number; height: number },
  zoom: number
): { x: number; y: number } {
  // Target a point slightly left of the horizontal center (40% mark) to give more context on the right.
  const targetX = (canvasSize.width * 0.4) - (target.x + target.width / 2) * zoom;
  
  // Target a point slightly above the vertical center (60% mark) to account for top-to-bottom flow.
  const targetY = (canvasSize.height * 0.6) - (target.y + target.height / 2) * zoom;

  return { x: targetX, y: targetY };
}
