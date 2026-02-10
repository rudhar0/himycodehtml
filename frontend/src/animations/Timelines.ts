import gsap from 'gsap';
import {
  VariableCreateAnimation,
  VariableUpdateAnimation,
  ArrayAccessAnimation,
  FunctionCallAnimation,
  FunctionReturnAnimation,
  LoopIterationAnimation,
  MemoryAllocationAnimation,
  ElementDestroyAnimation, // Import new animation type
} from '../types/animation.types';
import Konva from 'konva';

// Helper function to get layer and redraw during GSAP animations
const getLayerAndRedraw = (konvaObject: Konva.Node): Konva.Layer | null => {
  const layer = konvaObject.getLayer();
  if (layer) {
    layer.batchDraw();
  }
  return layer;
};

export const createVariableAnimation = (animation: VariableCreateAnimation) => {
  const { konvaObject, duration } = animation;
  console.log('[Timelines] createVariableAnimation - konvaObject:', konvaObject, 'duration:', duration);
  
  if (!konvaObject) {
    console.warn('[Timelines] No konvaObject provided for variable animation');
    return gsap.timeline(); // Return empty timeline
  }
  
  const tl = gsap.timeline();
  
  if (konvaObject instanceof Konva.Group) {
    console.log('[Timelines] Animating Konva.Group:', konvaObject.id());
    
    // GSAP can animate Konva objects directly
    // Get the layer for redrawing
    const layer = konvaObject.getLayer();
    
    // Use GSAP ticker to continuously redraw during animation
    const ticker = gsap.ticker.add(() => {
      if (layer) {
        layer.batchDraw();
      }
    });
    
    tl.fromTo(
      konvaObject,
      { 
        opacity: 0, 
        scaleX: 0.8, 
        scaleY: 0.8 
      },
      { 
        opacity: 1, 
        scaleX: 1, 
        scaleY: 1, 
        duration: duration / 1000,
        ease: 'power2.out',
        onComplete: () => {
          // Remove ticker when animation completes
          gsap.ticker.remove(ticker);
          // Final redraw
          if (layer) {
            layer.batchDraw();
          }
        }
      }
    );
    
    const rect = konvaObject.findOne<Konva.Rect>('Rect');
    if (rect) {
      tl.to(rect, {
        stroke: '#4ade80', // green-400
        duration: 0.2,
        yoyo: true,
        repeat: 1,
      }, "<0.1"); // Start slightly before the main animation ends
    }
    
    console.log('[Timelines] Variable animation timeline created, duration:', duration / 1000);
  } else {
    console.warn('[Timelines] konvaObject is not a Konva.Group:', konvaObject);
  }
  
  return tl;
};

export const createVariableUpdateAnimation = (animation: VariableUpdateAnimation) => {
    const { konvaContainer, valueTextNode, backgroundRect, duration, from, to } = animation;
    console.log('[Timelines] createVariableUpdateAnimation - konvaContainer:', konvaContainer, 'valueTextNode:', valueTextNode, 'backgroundRect:', backgroundRect);
    const tl = gsap.timeline();
    
    // Get layer for redrawing
    const layer = konvaContainer?.getLayer();
    
    // Use GSAP ticker to continuously redraw during animation
    const ticker = layer ? gsap.ticker.add(() => {
      layer.batchDraw();
    }) : null;
  
    // 1. Color flash on the background rectangle
    if (backgroundRect) {
      tl.to(backgroundRect, {
        fill: '#facc15', // yellow-400
        duration: 0.2,
        yoyo: true,
        repeat: 1,
      });
    }
  
    // 2. Old value -> New value transition on the value text node
    if (valueTextNode instanceof Konva.Text) {
      tl.to(valueTextNode, {
          opacity: 0,
          duration: (duration / 1000) / 2,
          onComplete: () => {
            valueTextNode.text(String(to));
          }
      }).to(valueTextNode, {
          opacity: 1,
          duration: (duration / 1000) / 2,
          onComplete: () => {
            // Remove ticker when animation completes
            if (ticker) {
              gsap.ticker.remove(ticker);
            }
            // Final redraw
            if (layer) {
              layer.batchDraw();
            }
          }
      });
    } else {
      // If no valueTextNode, remove ticker at end
      tl.call(() => {
        if (ticker) {
          gsap.ticker.remove(ticker);
        }
        if (layer) {
          layer.batchDraw();
        }
      });
    }
  
    return tl;
  };

export const createFunctionCallAnimation = (animation: FunctionCallAnimation) => {
    const { konvaObject, duration } = animation;
    console.log('createFunctionCallAnimation - konvaObject:', konvaObject);
    const tl = gsap.timeline();
    if (konvaObject) {
        tl.from(konvaObject, {
            y: '-=100',
            opacity: 0,
            duration: duration / 1000,
            ease: 'power2.out'
        });
    }
    return tl;
};

export const createFunctionReturnAnimation = (animation: FunctionReturnAnimation) => {
    const { konvaObject, duration } = animation;
    console.log('createFunctionReturnAnimation - konvaObject:', konvaObject);
    const tl = gsap.timeline();
    if (konvaObject) {
        tl.to(konvaObject, {
            y: '-=100',
            opacity: 0,
            duration: duration / 1000,
            ease: 'power2.in'
        });
    }
    return tl;
};

export const createLoopIterationAnimation = (animation: LoopIterationAnimation) => {
    const { konvaObject, iteration, totalIterations } = animation;
    console.log('createLoopIterationAnimation - konvaObject:', konvaObject);
    const tl = gsap.timeline();

    if (konvaObject instanceof Konva.Text) {
        konvaObject.text(`Iteration ${iteration}/${totalIterations}`);
        tl.fromTo(konvaObject, { opacity: 0 }, { opacity: 1, duration: 0.2, yoyo: true, repeat: 1, repeatDelay: 0.4 });
    }

    return tl;
};

export const createMemoryAllocationAnimation = (animation: MemoryAllocationAnimation) => {
    const { konvaObject, duration } = animation;
    console.log('createMemoryAllocationAnimation - konvaObject:', konvaObject);
    const tl = gsap.timeline();
    if (konvaObject) {
        tl.from(konvaObject, {
            opacity: 0,
            scaleX: 0.5,
            scaleY: 0.5,
            duration: duration / 1000
        });
    }
    return tl;
};

export const createArrayAccessAnimation = (animation: ArrayAccessAnimation) => {
    const { konvaObject, index } = animation;
    console.log('createArrayAccessAnimation - konvaObject:', konvaObject);
    const tl = gsap.timeline();
    if (konvaObject instanceof Konva.Rect) {
        tl.to(konvaObject, {
            fill: '#60a5fa', // blue-400
            duration: 0.2,
            yoyo: true,
            repeat: 1
        });
    }
    return tl;
};

export const createElementDestroyAnimation = (animation: ElementDestroyAnimation) => {
    const { konvaObject, duration } = animation;
    console.log('createElementDestroyAnimation - konvaObject:', konvaObject);
    const tl = gsap.timeline();
    if (konvaObject) {
        tl.to(konvaObject, {
            opacity: 0,
            duration: duration / 1000,
            onComplete: () => {
                konvaObject.destroy();
            }
        });
    }
    return tl;
};
