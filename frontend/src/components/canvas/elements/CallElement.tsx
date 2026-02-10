// frontend/src/components/canvas/elements/CallElement.tsx
// COMPLETE FILE - REPLACE ENTIRELY

import React, { useRef, useEffect, useState } from 'react';
import { Group, Rect, Text, Circle } from 'react-konva';
import Konva from 'konva';

interface CallElementProps {
  id: string;
  functionName: string;
  args?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isNew?: boolean;
  stepNumber?: number;
  onClick?: () => void;
}

const COLORS = {
  bg: '#312E81',
  border: '#6366F1',
  text: '#E0E7FF',
  label: '#818CF8',
};

export const CallElement: React.FC<CallElementProps> = ({
  id,
  functionName,
  args = "()",
  x,
  y,
  width,
  height,
  isNew = false,
  stepNumber,
  onClick
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const [isHovered, setIsHovered] = useState(false);

  const CORNER_RADIUS = 12;

  useEffect(() => {
    const node = groupRef.current;
    if (!node) return;

    if (isNew) {
      node.opacity(0);
      node.scaleX(0.8);
      node.scaleY(0.8);
      
      new Konva.Tween({
        node,
        opacity: 1,
        scaleX: 1,
        scaleY: 1,
        duration: 0.5,
        easing: Konva.Easings.BackEaseOut,
      }).play();
    }
  }, [isNew]);

  return (
    <Group
      ref={groupRef}
      id={id}
      x={x}
      y={y}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
      onTap={onClick}
    >
      {/* Background */}
      <Rect
        width={width}
        height={height}
        fill={COLORS.bg}
        stroke={COLORS.border}
        strokeWidth={isHovered ? 3 : 2}
        cornerRadius={CORNER_RADIUS}
        shadowColor={COLORS.border}
        shadowBlur={isHovered ? 15 : 5}
        shadowOpacity={0.6}
      />

      {/* Label */}
      <Text
        text="CALL"
        x={15}
        y={10}
        fontSize={10}
        fontStyle="bold"
        fill={COLORS.label}
        fontFamily="'SF Mono', monospace"
        letterSpacing={1}
      />

      {/* Function Signature */}
      <Text
        text={`${functionName}${args}`}
        x={15}
        y={28}
        width={width - 30}
        fontSize={16}
        fontStyle="bold"
        fill={COLORS.text}
        fontFamily="'SF Mono', monospace"
        ellipsis={true}
      />

      {/* Step Number */}
      {stepNumber !== undefined && (
        <Text
          text={`#${stepNumber}`}
          x={width - 40}
          y={10}
          fontSize={10}
          fill={COLORS.label}
          fontFamily="'SF Mono', monospace"
          align="right"
        />
      )}

      {/* Connector Dot */}
      <Circle
        x={width}
        y={height / 2}
        radius={5}
        fill={COLORS.border}
        shadowColor={COLORS.border}
        shadowBlur={8}
        shadowOpacity={0.6}
      />
    </Group>
  );
};

export default CallElement;