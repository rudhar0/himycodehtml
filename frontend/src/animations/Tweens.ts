// frontend/src/animations/Tweens.ts

import gsap from 'gsap';
import {
  VariableCreateAnimation,
  VariableUpdateAnimation,
  ArrayAccessAnimation,
  FunctionCallAnimation,
  FunctionReturnAnimation,
  LoopIterationAnimation,
  MemoryAllocationAnimation,
} from '../types/animation.types';

export const variableCreateTween = (animation: VariableCreateAnimation) => {
  const { target, duration } = animation;
  const tl = gsap.timeline();
  tl.fromTo(
    `#${target}`,
    { opacity: 0, scale: 0.8 },
    { opacity: 1, scale: 1, duration: duration / 1000 }
  ).to(`#${target} .border`, {
    borderColor: '#4ade80', // green-400
    duration: 0.2,
    yoyo: true,
    repeat: 1,
  });
  return tl;
};

export const variableUpdateTween = (animation: VariableUpdateAnimation) => {
  const { target, duration, from, to } = animation;
  const tl = gsap.timeline();

  // 1. Color flash
  tl.to(`#${target}`, {
    backgroundColor: '#facc15', // yellow-400
    duration: 0.2,
    yoyo: true,
    repeat: 1,
  });

  // 2. Old value -> New value transition (assuming there's an element for the value)
  const valueEl = document.querySelector(`#${target} .value`);
  if (valueEl) {
    // Hide old value, show new value
    tl.to(valueEl, {
        opacity: 0,
        duration: (duration / 1000) / 2,
        onComplete: () => {
            if (valueEl) valueEl.innerHTML = String(to);
        }
    }).to(valueEl, {
        opacity: 1,
        duration: (duration / 1000) / 2
    });
  }

  // 3. Show "from -> to" label (optional, requires a specific element)
  const updateLabel = document.querySelector(`#${target} .update-label`);
    if(updateLabel) {
        updateLabel.innerHTML = `${from} → ${to}`;
        tl.fromTo(updateLabel,
            { opacity: 0, y: 10 },
            { opacity: 1, y: 0, duration: 0.3 }
        ).to(updateLabel,
            { opacity: 0, y: -10, duration: 0.3, delay: 0.5 }
        );
    }


  return tl;
};

export const functionCallTween = (animation: FunctionCallAnimation) => {
    const { target, duration } = animation;
    const tl = gsap.timeline();
    // Assuming target is the ID of the new stack frame
    tl.from(`#${target}`, {
        y: '-100%',
        opacity: 0,
        duration: duration / 1000,
        ease: 'power2.out'
    });
    // You would also animate parameters appearing and an arrow
    return tl;
};

export const functionReturnTween = (animation: FunctionReturnAnimation) => {
    const { target, duration } = animation;
    const tl = gsap.timeline();
    // Assuming target is the ID of the stack frame to be removed
    tl.to(`#${target}`, {
        y: '-100%',
        opacity: 0,
        duration: duration / 1000,
        ease: 'power2.in'
    });
    // You would also animate a return value bubble
    return tl;
};

export const loopIterationTween = (animation: LoopIterationAnimation) => {
    const { target, iteration, totalIterations } = animation;
    const tl = gsap.timeline();

    const loopCounterBadge = document.querySelector(`#${target} .loop-badge`);
    if (loopCounterBadge) {
        loopCounterBadge.innerHTML = `Iteration ${iteration}/${totalIterations}`;
        tl.fromTo(loopCounterBadge, { opacity: 0 }, { opacity: 1, duration: 0.2, yoyo: true, repeat: 1, repeatDelay: 0.4 });
    }

    // Highlight variables changing inside the loop
    // This would likely be handled by subsequent 'update' animations within the same step sequence
    return tl;
};

export const memoryAllocationTween = (animation: MemoryAllocationAnimation) => {
    const { target, duration } = animation;
    const tl = gsap.timeline();
    // Heap block appears
    tl.from(`#${target}`, {
        opacity: 0,
        scale: 0.5,
        duration: duration / 1000
    });
    // Arrow from pointer to block would be a separate object to animate
    return tl;
};

export const arrayAccessTween = (animation: ArrayAccessAnimation) => {
    const { target, index } = animation;
    const tl = gsap.timeline();
    // Highlight specific cell
    const cellSelector = `#${target} .cell[data-index='${index}']`;
    tl.to(cellSelector, {
        backgroundColor: '#60a5fa', // blue-400
        duration: 0.2,
        yoyo: true,
        repeat: 1
    });

    // Show index number
    const indexLabel = document.querySelector(`${cellSelector} .index-label`);
    if(indexLabel) {
        tl.fromTo(indexLabel,
            { opacity: 0 },
            { opacity: 1, duration: 0.2, yoyo: true, repeat: 1, repeatDelay: 0.2 }
        );
    }
    return tl;
};
