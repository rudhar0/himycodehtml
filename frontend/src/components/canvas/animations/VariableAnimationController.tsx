// ============================================
// Variable Animation Controller
// Handles all variable animations: creation, update, deletion, access
// ============================================

import React, { useRef, useEffect } from 'react';
import Konva from 'konva';

export interface VariableAnimationConfig {
  type: 'appear' | 'disappear' | 'value_change' | 'access_read' | 'access_write';
  duration?: number;
  easing?: string;
  onComplete?: () => void;
}

export class VariableAnimationController {
  private static readonly DEFAULTS = {
    duration: 400,
    easing: Konva.Easings.BackEaseOut,
    accessDuration: 200,
    valueChangeDuration: 300
  };

  /**
   * Animate variable appearance (birth)
   */
  static animateAppear(
    node: Konva.Node,
    config: Partial<VariableAnimationConfig> = {}
  ): Promise<void> {
    return new Promise((resolve) => {
      const duration = config.duration || this.DEFAULTS.duration;
      const easing = config.easing || this.DEFAULTS.easing;

      // Set initial state
      node.opacity(0);
      node.scale({ x: 0.8, y: 0.8 });

      // Animate to final state
      node.to({
        opacity: 1,
        scaleX: 1,
        scaleY: 1,
        duration,
        easing,
        onFinish: () => {
          config.onComplete?.();
          resolve();
        }
      });
    });
  }

  /**
   * Animate variable disappearance (death)
   */
  static animateDisappear(
    node: Konva.Node,
    config: Partial<VariableAnimationConfig> = {}
  ): Promise<void> {
    return new Promise((resolve) => {
      const duration = config.duration || this.DEFAULTS.duration;
      const easing = Konva.Easings.EaseIn;

      node.to({
        opacity: 0,
        scaleX: 0.8,
        scaleY: 0.8,
        duration,
        easing,
        onFinish: () => {
          config.onComplete?.();
          resolve();
        }
      });
    });
  }

  /**
   * Animate value change with highlight effect
   */
  static animateValueChange(
    node: Konva.Node,
    oldValue: any,
    newValue: any,
    config: Partial<VariableAnimationConfig> = {}
  ): Promise<void> {
    return new Promise((resolve) => {
      const duration = this.DEFAULTS.valueChangeDuration;
      
      // Flash effect
      node.to({
        stroke: '#FCD34D',
        strokeWidth: 4,
        shadowColor: '#FCD34D',
        shadowBlur: 20,
        shadowOpacity: 0.8,
        duration: duration * 0.3,
        onFinish: () => {
          // Return to normal
          node.to({
            stroke: '#3B82F6',
            strokeWidth: 2,
            shadowColor: '#3B82F6',
            shadowBlur: 8,
            shadowOpacity: 0.4,
            duration: duration * 0.7,
            onFinish: () => {
              config.onComplete?.();
              resolve();
            }
          });
        }
      });
    });
  }

  /**
   * Animate variable access (read)
   */
  static animateAccessRead(
    node: Konva.Node,
    config: Partial<VariableAnimationConfig> = {}
  ): Promise<void> {
    return new Promise((resolve) => {
      const duration = this.DEFAULTS.accessDuration;

      node.to({
        stroke: '#10B981',
        strokeWidth: 3,
        shadowColor: '#10B981',
        shadowBlur: 12,
        shadowOpacity: 0.6,
        duration,
        onFinish: () => {
          // Return to normal
          node.to({
            stroke: '#3B82F6',
            strokeWidth: 2,
            shadowColor: '#3B82F6',
            shadowBlur: 8,
            shadowOpacity: 0.4,
            duration: duration * 0.5,
            onFinish: () => {
              config.onComplete?.();
              resolve();
            }
          });
        }
      });
    });
  }

  /**
   * Animate variable access (write)
   */
  static animateAccessWrite(
    node: Konva.Node,
    config: Partial<VariableAnimationConfig> = {}
  ): Promise<void> {
    return new Promise((resolve) => {
      const duration = this.DEFAULTS.accessDuration;

      node.to({
        stroke: '#F59E0B',
        strokeWidth: 3,
        shadowColor: '#F59E0B',
        shadowBlur: 12,
        shadowOpacity: 0.6,
        duration,
        onFinish: () => {
          // Return to normal
          node.to({
            stroke: '#3B82F6',
            strokeWidth: 2,
            shadowColor: '#3B82F6',
            shadowBlur: 8,
            shadowOpacity: 0.4,
            duration: duration * 0.5,
            onFinish: () => {
              config.onComplete?.();
              resolve();
            }
          });
        }
      });
    });
  }

  /**
   * Animate uninitialized variable becoming initialized
   */
  static animateInitialization(
    node: Konva.Node,
    config: Partial<VariableAnimationConfig> = {}
  ): Promise<void> {
    return new Promise((resolve) => {
      const duration = this.DEFAULTS.valueChangeDuration;

      // Pulse effect
      node.to({
        scaleX: 1.1,
        scaleY: 1.1,
        duration: duration * 0.3,
        onFinish: () => {
          node.to({
            scaleX: 1,
            scaleY: 1,
            duration: duration * 0.3,
            onFinish: () => {
              config.onComplete?.();
              resolve();
            }
          });
        }
      });
    });
  }

  /**
   * Chain multiple animations
   */
  static async animateChain(
    node: Konva.Node,
    animations: VariableAnimationConfig[]
  ): Promise<void> {
    for (const animation of animations) {
      switch (animation.type) {
        case 'appear':
          await this.animateAppear(node, animation);
          break;
        case 'disappear':
          await this.animateDisappear(node, animation);
          break;
        case 'value_change':
          await this.animateValueChange(node, null, null, animation);
          break;
        case 'access_read':
          await this.animateAccessRead(node, animation);
          break;
        case 'access_write':
          await this.animateAccessWrite(node, animation);
          break;
      }
    }
  }
}

// React Hook for variable animations
export const useVariableAnimation = (
  nodeRef: React.RefObject<Konva.Node>,
  animationType: VariableAnimationConfig['type'] | null,
  dependencies: any[] = []
) => {
  const previousAnimation = useRef<VariableAnimationConfig['type'] | null>(null);

  useEffect(() => {
    if (!nodeRef.current || !animationType) return;

    const node = nodeRef.current;

    // Only animate if animation type changed
    if (animationType !== previousAnimation.current) {
      previousAnimation.current = animationType;

      switch (animationType) {
        case 'appear':
          VariableAnimationController.animateAppear(node);
          break;
        case 'disappear':
          VariableAnimationController.animateDisappear(node);
          break;
        case 'value_change':
          VariableAnimationController.animateValueChange(node, null, null);
          break;
        case 'access_read':
          VariableAnimationController.animateAccessRead(node);
          break;
        case 'access_write':
          VariableAnimationController.animateAccessWrite(node);
          break;
      }
    }
  }, [animationType, ...dependencies]);
};
