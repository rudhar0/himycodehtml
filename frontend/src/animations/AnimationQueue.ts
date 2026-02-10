// frontend/src/animations/AnimationQueue.ts
/**
 * AnimationQueue - Pause-aware animation queue system
 * 
 * This queue properly handles:
 * - Pause/Resume without losing state
 * - Sequential animation playback
 * - Queue clearing
 * - Animation completion callbacks
 */

import gsap from 'gsap';
import { AnimationSequence } from '../types/animation.types';

export class AnimationQueue {
  private queue: gsap.core.Timeline[] = [];
  private isPlaying: boolean = false;
  private currentAnimation: gsap.core.Timeline | null = null;
  private pausePosition: number = 0; // Store pause position for resume

  /**
   * Add an animation sequence to the queue
   */
  public addSequence(timeline: gsap.core.Timeline): void {
    if (!timeline) {
      console.warn('[AnimationQueue] Attempted to add null timeline');
      return;
    }
    console.log('[AnimationQueue] Adding sequence to queue, queue length:', this.queue.length);
    console.log('[AnimationQueue] Timeline details:', {
      duration: timeline.duration(),
      children: timeline.getChildren().length,
      paused: timeline.paused()
    });
    this.queue.push(timeline);
    this.playNext();
  }

  /**
   * Play the next animation in the queue
   */
  private playNext = (): void => {
    // Don't start a new animation if already playing or queue is empty
    if (this.isPlaying) {
      console.log('[AnimationQueue] Already playing, skipping');
      return;
    }
    
    if (this.queue.length === 0) {
      console.log('[AnimationQueue] Queue empty, nothing to play');
      return;
    }

    console.log('[AnimationQueue] Playing next sequence, queue length:', this.queue.length);
    this.isPlaying = true;
    const nextSequence = this.queue.shift();

    if (nextSequence) {
      this.currentAnimation = nextSequence;
      
      // Resume from pause position if we were paused
      if (this.pausePosition > 0) {
        nextSequence.progress(this.pausePosition);
        this.pausePosition = 0;
      }

      // Set up completion callback
      nextSequence.eventCallback('onComplete', () => {
        console.log('[AnimationQueue] Sequence completed');
        this.isPlaying = false;
        this.currentAnimation = null;
        this.playNext(); // Play next in queue
      });

      // Start playing
      console.log('[AnimationQueue] Starting timeline playback');
      nextSequence.play();
    } else {
      console.warn('[AnimationQueue] Shift returned null');
      this.isPlaying = false;
    }
  };

  /**
   * Pause the current animation
   */
  public pause(): void {
    if (this.currentAnimation && this.isPlaying) {
      this.pausePosition = this.currentAnimation.progress();
      this.currentAnimation.pause();
      this.isPlaying = false;
      console.log('[AnimationQueue] Paused at progress:', this.pausePosition);
    }
  }

  /**
   * Resume the current animation
   */
  public resume(): void {
    if (this.currentAnimation && !this.isPlaying) {
      this.currentAnimation.play();
      this.isPlaying = true;
      console.log('[AnimationQueue] Resumed from progress:', this.pausePosition);
    } else if (this.queue.length > 0 && !this.isPlaying) {
      // If no current animation but queue has items, start playing
      this.playNext();
    }
  }

  /**
   * Clear the entire queue and stop current animation
   */
  public clear(): void {
    // Kill current animation
    if (this.currentAnimation) {
      this.currentAnimation.kill();
      this.currentAnimation = null;
    }

    // Kill all queued animations
    this.queue.forEach(timeline => timeline.kill());
    this.queue = [];
    this.isPlaying = false;
    this.pausePosition = 0;
    
    console.log('[AnimationQueue] Queue cleared');
  }

  /**
   * Check if queue is currently playing
   */
  public get isAnimating(): boolean {
    return this.isPlaying;
  }

  /**
   * Get queue length
   */
  public get length(): number {
    return this.queue.length;
  }

  /**
   * Wait for all animations to complete
   */
  public async waitForCompletion(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.isPlaying && this.queue.length === 0) {
        resolve();
        return;
      }

      const checkComplete = () => {
        if (!this.isPlaying && this.queue.length === 0) {
          resolve();
        } else {
          setTimeout(checkComplete, 50);
        }
      };

      checkComplete();
    });
  }
}

