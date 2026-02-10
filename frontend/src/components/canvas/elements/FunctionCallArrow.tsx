// frontend/src/components/canvas/elements/FunctionCallArrow.tsx
// COMPLETE - Curved arrow component

import React, { useRef, useEffect, memo } from 'react';
import { Group, Arrow, Rect, Text } from 'react-konva';
import Konva from 'konva';

export interface FunctionCallArrowProps {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  label?: string;
  isActive?: boolean;
  isRecursive?: boolean;
  isNew?: boolean;
}

const COLORS = {
  normal: '#8B5CF6',
  recursive: '#F59E0B',
  active: '#10B981'
};

export const FunctionCallArrow: React.FC<FunctionCallArrowProps> = memo(({
  id,
  fromX,
  fromY,
  toX,
  toY,
  label,
  isActive = false,
  isRecursive = false,
  isNew = false
}) => {
  const arrowRef = useRef<Konva.Arrow>(null);

  const calculateCurvedPoints = (): number[] => {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    const curvature = isRecursive ? 0.5 : 0.25;
    const perpX = -dy / distance;
    const perpY = dx / distance;
    
    const controlX = (fromX + toX) / 2 + perpX * distance * curvature;
    const controlY = (fromY + toY) / 2 + perpY * distance * curvature;

    const points: number[] = [];
    const steps = 25;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = (1 - t) * (1 - t) * fromX + 2 * (1 - t) * t * controlX + t * t * toX;
      const y = (1 - t) * (1 - t) * fromY + 2 * (1 - t) * t * controlY + t * t * toY;
      points.push(x, y);
    }

    return points;
  };

  const points = calculateCurvedPoints();
  const color = isActive ? COLORS.active : (isRecursive ? COLORS.recursive : COLORS.normal);

  useEffect(() => {
    const arrow = arrowRef.current;
    if (!arrow || !isNew) return;

    arrow.opacity(0);
    arrow.strokeWidth(0);

    new Konva.Tween({
      node: arrow,
      opacity: isActive ? 0.95 : 0.75,
      strokeWidth: isActive ? 3 : 2,
      duration: 0.5,
      easing: Konva.Easings.EaseInOut
    }).play();
  }, [isNew, isActive]);

  useEffect(() => {
    const arrow = arrowRef.current;
    if (!arrow) return;

    arrow.to({
      opacity: isActive ? 0.95 : 0.75,
      strokeWidth: isActive ? 3 : 2,
      duration: 0.3
    });
  }, [isActive]);

  const labelX = (fromX + toX) / 2;
  const labelY = (fromY + toY) / 2;

  return (
    <Group id={id}>
      <Arrow
        ref={arrowRef}
        points={points}
        stroke={color}
        strokeWidth={isActive ? 3 : 2}
        fill={color}
        pointerLength={isActive ? 16 : 13}
        pointerWidth={isActive ? 16 : 13}
        opacity={isActive ? 0.95 : 0.75}
        shadowColor={color}
        shadowBlur={isActive ? 14 : 8}
        shadowOpacity={0.6}
        dash={isRecursive ? [8, 5] : undefined}
        tension={0.5}
      />

      {label && (
        <Group>
          <Rect
            x={labelX - 50}
            y={labelY - 12}
            width={100}
            height={24}
            fill="rgba(30, 41, 59, 0.95)"
            stroke={color}
            strokeWidth={1}
            cornerRadius={12}
            shadowColor="rgba(0, 0, 0, 0.3)"
            shadowBlur={8}
            shadowOffsetY={2}
          />
          <Text
            text={label}
            x={labelX - 50}
            y={labelY - 6}
            width={100}
            fontSize={10}
            fontStyle="bold"
            fill="#F1F5F9"
            align="center"
            fontFamily="'SF Mono', monospace"
          />
        </Group>
      )}
    </Group>
  );
});

FunctionCallArrow.displayName = 'FunctionCallArrow';

export default FunctionCallArrow;