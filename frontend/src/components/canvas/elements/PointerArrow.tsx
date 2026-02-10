import React, { useRef, useEffect } from 'react';
import { Group, Line, Circle, Arrow, Text } from 'react-konva';
import Konva from 'konva';

interface PointerArrowProps {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  label?: string;
  isNew?: boolean;
}

const COLORS = {
  arrow: '#FCD34D',
  label: '#F1F5F9',
};

export const PointerArrow: React.FC<PointerArrowProps> = ({
  id,
  fromX,
  fromY,
  toX,
  toY,
  label,
  isNew = false
}) => {
  const groupRef = useRef<Konva.Group>(null);

  useEffect(() => {
    const node = groupRef.current;
    if (!node) return;

    if (isNew) {
      node.opacity(0);
      
      const anim = new Konva.Tween({
        node,
        opacity: 1,
        duration: 0.5,
        easing: Konva.Easings.EaseOut,
      });
      anim.play();
    }
  }, [isNew]);

  // Calculate arrow path
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);

  // Arrow points
  const arrowLength = 15;
  const arrowWidth = 8;
  const points = [
    fromX, fromY,
    toX - Math.cos(angle) * arrowLength, toY - Math.sin(angle) * arrowLength
  ];

  return (
    <Group ref={groupRef} id={id}>
      {/* Arrow Line */}
      <Arrow
        points={points}
        fill={COLORS.arrow}
        stroke={COLORS.arrow}
        strokeWidth={2}
        pointerLength={arrowLength}
        pointerWidth={arrowWidth}
      />

      {/* Label (if provided) */}
      {label && (
        <Group
          x={(fromX + toX) / 2}
          y={(fromY + toY) / 2 - 15}
        >
          <Circle
            radius={12}
            fill="#1E293B"
            stroke={COLORS.arrow}
            strokeWidth={1}
          />
          <Text
            text={label}
            fontSize={10}
            fill={COLORS.label}
            fontFamily="monospace"
            align="center"
            verticalAlign="middle"
            x={-6}
            y={-6}
          />
        </Group>
      )}
    </Group>
  );
};

export default PointerArrow;
