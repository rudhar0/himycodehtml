// frontend/src/animations/SequenceManager.ts

import gsap from 'gsap';
import { Animation, AnimationSequence } from '../types/animation.types';
import {
    createVariableAnimation,
    createVariableUpdateAnimation,
    createArrayAccessAnimation,
    createFunctionCallAnimation,
    createFunctionReturnAnimation,
    createLoopIterationAnimation,
    createMemoryAllocationAnimation,
    createElementDestroyAnimation, // Import the new function
} from './Timelines';
import Konva from 'konva';

export class SequenceManager {
  private masterTimeline: gsap.core.Timeline;
  private stage: Konva.Stage;

  constructor(stage: Konva.Stage) {
    this.stage = stage;
    this.masterTimeline = gsap.timeline({ paused: true });
  }

  public createSequence(animations: AnimationSequence): gsap.core.Timeline {
    const sequenceTimeline = gsap.timeline();

    animations.forEach((anim) => {
      const animationTimeline = this.getAnimationTimeline(anim);
      if (animationTimeline) {
        // Add animations to play sequentially within the step
        sequenceTimeline.add(animationTimeline);
      }
    });

    return sequenceTimeline;
  }

  private getAnimationTimeline(animation: Animation): gsap.core.Timeline | null {
    // If konvaObject is already provided, use it (for new elements)
    let konvaObject = animation.konvaObject;
    
    // Otherwise, try to find it by ID
    if (!konvaObject) {
      console.log(`Attempting to find Konva object for ID: #${animation.target}`);
      konvaObject = this.stage.findOne(`#${animation.target}`);
      if (!konvaObject) {
          console.warn(`Konva object with ID ${animation.target} not found.`);
          return null;
      }
      console.log(`Found Konva object for ID: #${animation.target}`, konvaObject);
    }

    // Assign the konvaObject to the animation payload
    animation.konvaObject = konvaObject;

    switch (animation.type) {
      case 'variable_create':
        return createVariableAnimation(animation);
      case 'variable_update':
        return createVariableUpdateAnimation(animation);
      case 'array_access':
        return createArrayAccessAnimation(animation);
      case 'function_call':
        return createFunctionCallAnimation(animation);
      case 'function_return':
        return createFunctionReturnAnimation(animation);
      case 'loop_iteration':
        return createLoopIterationAnimation(animation);
      case 'memory_allocation':
        return createMemoryAllocationAnimation(animation);
      case 'element_destroy': // Handle the new animation type
        return createElementDestroyAnimation(animation);
      // Add other animation types here
      default:
        console.warn(`Unknown animation type: ${animation.type}`);
        return null;
    }
  }
}
