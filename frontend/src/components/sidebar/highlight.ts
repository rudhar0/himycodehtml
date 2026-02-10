import Konva from 'konva';

/**
 * Highlights a node by pulsing its stroke color.
 * @param stage The Konva stage instance
 * @param nodeId The ID of the node to highlight
 * @param color The highlight color (default: yellow)
 */
export const highlightNode = (
  stage: Konva.Stage, 
  nodeId: string, 
  color: string = '#fbbf24'
) => {
  const node = stage.findOne(`#${nodeId}`);
  
  if (node) {
    // If it's a Group (like VariableBox), try to find the background Rect
    const targetShape = node.getType() === 'Group' 
      ? (node as Konva.Group).findOne('.box-bg') || node 
      : node;

    const tween = new Konva.Tween({
      node: targetShape,
      stroke: color,
      strokeWidth: 4,
      duration: 0.3,
      easing: Konva.Easings.EaseInOut,
      onFinish: () => {
        // Auto-reverse to original state
        tween.reverse();
      },
    });

    tween.play();
  }
};