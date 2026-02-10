// frontend/src/components/canvas/elements/SmoothUpdateArrow.tsx
import React, { useRef, useEffect, memo } from 'react';
import { Group, Arrow, Circle } from 'react-konva';
import Konva from 'konva';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface SmoothUpdateArrowProps {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color?: string;
  label?: string;
  duration?: number;
  onComplete?: () => void;
}

// ============================================
// SMOOTH ANIMATED ARROW
// ============================================

export const SmoothUpdateArrow: React.FC<SmoothUpdateArrowProps> = memo(({
  id,
  fromX,
  fromY,
  toX,
  toY,
  color = '#F59E0B',
  label = '',
  duration = 0.6,
  onComplete
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const arrowRef = useRef<Konva.Arrow>(null);
  const pulseRef = useRef<Konva.Circle>(null);

  // ============================================
  // SMOOTH CURVE CALCULATION
  // ============================================
  const calculateCurvedPath = () => {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Control point for smooth bezier curve
    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2;
    
    // Curve offset perpendicular to the line
    const offset = Math.min(distance * 0.2, 50);
    const perpX = -dy / distance * offset;
    const perpY = dx / distance * offset;
    
    const controlX = midX + perpX;
    const controlY = midY + perpY;
    
    // Generate smooth bezier curve points
    const points: number[] = [];
    const steps = 20;
    
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.pow(1 - t, 2) * fromX + 
                2 * (1 - t) * t * controlX + 
                Math.pow(t, 2) * toX;
      const y = Math.pow(1 - t, 2) * fromY + 
                2 * (1 - t) * t * controlY + 
                Math.pow(t, 2) * toY;
      points.push(x, y);
    }
    
    return points;
  };

  const points = calculateCurvedPath();

  // ============================================
  // ENTRANCE ANIMATION
  // ============================================
  useEffect(() => {
    const group = groupRef.current;
    const arrow = arrowRef.current;
    const pulse = pulseRef.current;
    
    if (!group || !arrow || !pulse) return;

    // Start invisible
    group.opacity(0);
    arrow.dash([0, 1000]);
    
    // Animate entrance with dash effect
    const dashAnim = new Konva.Tween({
      node: arrow,
      dash: [1000, 0],
      duration: duration * 0.5,
      easing: Konva.Easings.EaseOut
    });

    const fadeInAnim = new Konva.Tween({
      node: group,
      opacity: 1,
      duration: duration * 0.3,
      easing: Konva.Easings.EaseInOut
    });

    // Pulse animation at destination
    const pulseAnim = new Konva.Tween({
      node: pulse,
      scaleX: 2,
      scaleY: 2,
      opacity: 0,
      duration: duration * 0.4,
      easing: Konva.Easings.EaseOut,
      onFinish: () => {
        // Fade out after animation
        const fadeOutAnim = new Konva.Tween({
          node: group,
          opacity: 0,
          duration: duration * 0.3,
          easing: Konva.Easings.EaseInOut,
          onFinish: () => {
            if (onComplete) onComplete();
          }
        });
        
        setTimeout(() => fadeOutAnim.play(), duration * 1000);
      }
    });

    fadeInAnim.play();
    setTimeout(() => {
      dashAnim.play();
      setTimeout(() => pulseAnim.play(), duration * 500);
    }, duration * 300);

    return () => {
      dashAnim.destroy();
      fadeInAnim.destroy();
      pulseAnim.destroy();
    };
  }, [duration, onComplete]);

  // ============================================
  // RENDER
  // ============================================
  return (
    <Group ref={groupRef} id={id}>
      {/* Smooth Curved Arrow */}
      <Arrow
        ref={arrowRef}
        points={points}
        stroke={color}
        strokeWidth={3}
        fill={color}
        pointerLength={12}
        pointerWidth={12}
        opacity={0.9}
        shadowColor={color}
        shadowBlur={8}
        shadowOpacity={0.6}
        lineCap="round"
        lineJoin="round"
        listening={false}
      />

      {/* Pulse Circle at Destination */}
      <Circle
        ref={pulseRef}
        x={toX}
        y={toY}
        radius={8}
        fill={color}
        opacity={1}
        listening={false}
      />
    </Group>
  );
});

SmoothUpdateArrow.displayName = 'SmoothUpdateArrow';

export default SmoothUpdateArrow;