// frontend/src/animations/AnimationEngine.ts

import gsap from 'gsap';
import { SequenceManager } from './SequenceManager';
import { AnimationSequence } from '../types/animation.types';
import { AnimationQueue } from './AnimationQueue';
import Konva from 'konva';

class AnimationEngine {
  private static instance: AnimationEngine;
  private sequenceManager: SequenceManager | undefined;
  private animationQueue: AnimationQueue;

  private constructor() {
    this.animationQueue = new AnimationQueue();
  }

  public static getInstance(): AnimationEngine {
    if (!AnimationEngine.instance) {
      AnimationEngine.instance = new AnimationEngine();
    }
    return AnimationEngine.instance;
  }

  public initialize(stage: Konva.Stage) {
    if (!this.sequenceManager) {
      this.sequenceManager = new SequenceManager(stage);
    }
  }

  public createSequence(animations: AnimationSequence): gsap.core.Timeline {
    if (!this.sequenceManager) {
      throw new Error("AnimationEngine not initialized. Call initialize() first.");
    }
    return this.sequenceManager.createSequence(animations);
  }

  public addSequence(timeline: gsap.core.Timeline) {
    console.log('[AnimationEngine] Adding sequence to queue');
    this.animationQueue.addSequence(timeline);
  }

  public pause() {
    this.animationQueue.pause();
  }

  public resume() {
    this.animationQueue.resume();
  }

  public clearQueue() {
    this.animationQueue.clear();
  }

  public get isAnimating(): boolean {
    return this.animationQueue.isAnimating;
  }

  public async waitForCompletion(): Promise<void> {
    return this.animationQueue.waitForCompletion();
  }
}

export default AnimationEngine.getInstance();
