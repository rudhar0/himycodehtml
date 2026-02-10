import React from 'react';
import { Arrow } from 'react-konva';

export interface PointerArrowProps {
  id: string;
  points: number[];
  color?: string;
}

export const PointerArrow: React.FC<PointerArrowProps> = ({
  id,
  points,
  color = '#3b82f6',
}) => {
  return (
    <Arrow
      id={id}
      points={points}
      stroke={color}
      fill={color}
      strokeWidth={2}
      pointerLength={10}
      pointerWidth={10}
    />
  );
};