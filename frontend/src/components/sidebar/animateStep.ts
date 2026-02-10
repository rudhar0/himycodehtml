import Konva from 'konva';
import { VisualElement } from './RenderRegistry'; // Import VisualElement

/**
 * Triggers transient animations when a step changes.
 * e.g., highlighting a variable that was just updated.
 */
export const animateStepChange = (stage: Konva.Stage, elements: VisualElement[]) => {
  if (!stage || !elements || elements.length === 0) return;

  elements.forEach(el => {
    // Find the Konva node by its ID
    const node = stage.findOne(`#${el.id}`);
    
    if (node) {
      // Apply a subtle scale animation to indicate an update
      const tween = new Konva.Tween({
        node: node,
        scaleX: 1.05, // Scale up slightly
        scaleY: 1.05,
        duration: 0.1, // Quick animation
        easing: Konva.Easings.EaseOut,
        onFinish: () => {
          // Scale back to original size
          new Konva.Tween({
            node: node,
            scaleX: 1,
            scaleY: 1,
            duration: 0.1,
            easing: Konva.Easings.EaseIn,
          }).play();
        }
      });
      tween.play();
    }
  });
};