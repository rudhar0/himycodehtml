import React, { useRef, useEffect } from 'react';
import { Arrow, Group } from 'react-konva';
import Konva from 'konva';

// ============================================
// TYPE DEFINITIONS
// ============================================

export interface ArrayReferenceProps {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  variableName: string;
  arrayName: string;
  isNew?: boolean;
}

// ============================================
// ARRAY REFERENCE COMPONENT
// ============================================

export const ArrayReference: React.FC<ArrayReferenceProps> = ({
  id,
  fromX,
  fromY,
  toX,
  toY,
  variableName,
  arrayName,
  isNew = false
}) => {
  const arrowRef = useRef<Konva.Arrow>(null);

  // ============================================
  // CALCULATE ARROW POINTS
  // ============================================
  const calculatePoints = () => {
    // Add some curve to the arrow for visual appeal
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Control point for bezier curve
    const midX = (fromX + toX) / 2;
    const midY = (fromY + toY) / 2;
    
    // Simple straight line for now (can be enhanced with bezier curves)
    return [fromX, fromY, toX, toY];
  };

  const points = calculatePoints();

  // ============================================
  // ANIMATION: ENTRANCE
  // ============================================
  useEffect(() => {
    const arrow = arrowRef.current;
    if (!arrow || !isNew) return;

    arrow.opacity(0);
    arrow.strokeWidth(0);

    const anim = new Konva.Tween({
      node: arrow,
      opacity: 0.8,
      strokeWidth: 2,
      duration: 0.5,
      easing: Konva.Easings.EaseInOut
    });
    anim.play();
  }, [isNew]);

  // ============================================
  // RENDER
  // ============================================
  return (
    <Arrow
      ref={arrowRef}
      id={id}
      points={points}
      stroke="#10B981"
      strokeWidth={2}
      fill="#10B981"
      pointerLength={12}
      pointerWidth={12}
      dash={[8, 4]}
      opacity={0.8}
      shadowColor="rgba(16, 185, 129, 0.4)"
      shadowBlur={8}
    />
  );
};

export default ArrayReference;