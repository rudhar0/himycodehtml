// frontend/src/animations/AnimationEngine.ts
import gsap from 'gsap';
import {
  VariableCreateAnimation,
  VariableUpdateAnimation,
  ElementDestroyAnimation,
  FunctionCallAnimation,
  LoopIterationAnimation,
} from '../types/animation.types';

type Animation =
  | VariableCreateAnimation
  | VariableUpdateAnimation
  | ElementDestroyAnimation
  | FunctionCallAnimation
  | LoopIterationAnimation;

class AnimationEngine {
  private static queue: gsap.core.Timeline[] = [];
  private static isPlaying: boolean = false;
  private static isPaused: boolean = false;
  private static currentTimeline: gsap.core.Timeline | null = null;

  /**
   * Create a GSAP timeline sequence from animation definitions
   */
  static createSequence(animations: Animation[]): gsap.core.Timeline {
    const timeline = gsap.timeline({ paused: true });

    animations.forEach((animation) => {
      switch (animation.type) {
        case 'variable_create':
          this.addVariableCreateAnimation(timeline, animation);
          break;
        case 'variable_update':
          this.addVariableUpdateAnimation(timeline, animation);
          break;
        case 'element_destroy':
          this.addElementDestroyAnimation(timeline, animation);
          break;
        case 'function_call':
          this.addFunctionCallAnimation(timeline, animation);
          break;
        case 'loop_iteration':
          this.addLoopIterationAnimation(timeline, animation);
          break;
        default:
          console.warn('[AnimationEngine] Unknown animation type:', (animation as any).type);
      }
    });

    return timeline;
  }

  /**
   * Add a timeline to the queue and start processing if not already playing
   */
  static addSequence(timeline: gsap.core.Timeline): void {
    console.log('[AnimationEngine] Adding sequence to queue. Current queue size:', this.queue.length);
    this.queue.push(timeline);
    
    if (!this.isPlaying && !this.isPaused) {
      this.processQueue();
    }
  }

  /**
   * Process the animation queue sequentially
   */
  private static async processQueue(): Promise<void> {
    if (this.isPlaying) {
      console.log('[AnimationEngine] Already processing queue');
      return;
    }

    this.isPlaying = true;
    console.log('[AnimationEngine] Starting queue processing. Queue size:', this.queue.length);

    while (this.queue.length > 0 && !this.isPaused) {
      const timeline = this.queue.shift();
      if (timeline) {
        this.currentTimeline = timeline;
        console.log('[AnimationEngine] Playing timeline...');
        
        await new Promise<void>((resolve) => {
          timeline.eventCallback('onComplete', () => {
            console.log('[AnimationEngine] Timeline completed');
            this.currentTimeline = null;
            resolve();
          });
          timeline.play();
        });
      }
    }

    this.isPlaying = false;
    console.log('[AnimationEngine] Queue processing complete');
  }

  /**
   * Pause animation processing
   */
  static pause(): void {
    this.isPaused = true;
    if (this.currentTimeline) {
      this.currentTimeline.pause();
    }
    console.log('[AnimationEngine] Paused');
  }

  /**
   * Resume animation processing
   */
  static resume(): void {
    this.isPaused = false;
    if (this.currentTimeline) {
      this.currentTimeline.resume();
    }
    if (!this.isPlaying && this.queue.length > 0) {
      this.processQueue();
    }
    console.log('[AnimationEngine] Resumed');
  }

  /**
   * Clear all queued animations
   */
  static clear(): void {
    this.queue = [];
    if (this.currentTimeline) {
      this.currentTimeline.kill();
      this.currentTimeline = null;
    }
    this.isPlaying = false;
    this.isPaused = false;
    console.log('[AnimationEngine] Cleared all animations');
  }

  /**
   * Skip current animation and move to next
   */
  static skipCurrent(): void {
    if (this.currentTimeline) {
      this.currentTimeline.progress(1);
    }
  }

  /**
   * Get queue status
   */
  static getStatus(): { isPlaying: boolean; isPaused: boolean; queueSize: number } {
    return {
      isPlaying: this.isPlaying,
      isPaused: this.isPaused,
      queueSize: this.queue.length,
    };
  }

  // ==================== Animation Builders ====================

  private static addVariableCreateAnimation(
    timeline: gsap.core.Timeline,
    animation: VariableCreateAnimation
  ): void {
    const { konvaObject, duration = 500 } = animation;

    if (!konvaObject) {
      console.warn('[AnimationEngine] No konvaObject for variable_create animation');
      return;
    }

    // Fade in and scale up
    timeline.to(
      konvaObject,
      {
        opacity: 1,
        scaleX: 1,
        scaleY: 1,
        duration: duration / 1000,
        ease: 'back.out(1.7)',
      },
      0
    );
  }

  private static addVariableUpdateAnimation(
    timeline: gsap.core.Timeline,
    animation: VariableUpdateAnimation
  ): void {
    const { konvaContainer, backgroundRect, valueTextNode, duration = 600 } = animation;

    if (!konvaContainer || !backgroundRect || !valueTextNode) {
      console.warn('[AnimationEngine] Missing objects for variable_update animation');
      return;
    }

    // Pulse background
    timeline.to(
      backgroundRect,
      {
        strokeWidth: 4,
        duration: 0.15,
        yoyo: true,
        repeat: 1,
      },
      0
    );

    // Slight scale pulse
    timeline.to(
      konvaContainer,
      {
        scaleX: 1.05,
        scaleY: 1.05,
        duration: 0.15,
        yoyo: true,
        repeat: 1,
        ease: 'power2.inOut',
      },
      0
    );
  }

  private static addElementDestroyAnimation(
    timeline: gsap.core.Timeline,
    animation: ElementDestroyAnimation
  ): void {
    const { konvaObject, duration = 500 } = animation;

    if (!konvaObject) {
      console.warn('[AnimationEngine] No konvaObject for element_destroy animation');
      return;
    }

    // Fade out and scale down
    timeline.to(
      konvaObject,
      {
        opacity: 0,
        scaleX: 0.8,
        scaleY: 0.8,
        duration: duration / 1000,
        ease: 'power2.in',
        onComplete: () => {
          konvaObject.destroy();
        },
      },
      0
    );
  }

  private static addFunctionCallAnimation(
    timeline: gsap.core.Timeline,
    animation: FunctionCallAnimation
  ): void {
    const { konvaObject, duration = 300 } = animation;

    if (!konvaObject) {
      console.warn('[AnimationEngine] No konvaObject for function_call animation');
      return;
    }

    // Slide in from top
    const startY = konvaObject.y() - 20;
    konvaObject.y(startY);
    konvaObject.opacity(0);

    timeline.to(
      konvaObject,
      {
        y: konvaObject.y() + 20,
        opacity: 1,
        duration: duration / 1000,
        ease: 'power2.out',
      },
      0
    );
  }

  private static addLoopIterationAnimation(
    timeline: gsap.core.Timeline,
    animation: LoopIterationAnimation
  ): void {
    const { konvaObject, duration = 300 } = animation;

    if (!konvaObject) {
      console.warn('[AnimationEngine] No konvaObject for loop_iteration animation');
      return;
    }

    // Flash animation
    timeline.to(
      konvaObject,
      {
        opacity: 0.5,
        duration: (duration / 1000) / 2,
        yoyo: true,
        repeat: 1,
        ease: 'power2.inOut',
      },
      0
    );
  }
}

export default AnimationEngine;