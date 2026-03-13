import React, { useRef, useEffect, useState } from 'react';
import { Group, Rect, Text, Circle } from 'react-konva';
import Konva from 'konva';

interface LoopCallerForParentProps {
  id: string;
  loopType: string;
  loopId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  isNew?: boolean;
  stepNumber?: number;
  onClick?: () => void;
  children?: React.ReactNode;
}

const COLORS = {
  bg: '#1e293b', 
  border: '#a855f7', // Purple border for loops
  text: '#e9d5ff', // Light purple text
  label: '#d8b4fe', // Lighter purple
};

export const LoopCallerForParent: React.FC<LoopCallerForParentProps> = ({
  id,
  loopType,
  loopId,
  x,
  y,
  width,
  height,
  isNew = false,
  stepNumber,
  onClick,
  children
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
        text="LOOP"
        x={15}
        y={10}
        fontSize={10}
        fontStyle="bold"
        fill={COLORS.label}
        fontFamily="'SF Mono', monospace"
        letterSpacing={1}
      />

      {/* Loop Info */}
      <Text
        text={`${loopType.toUpperCase()} (id: ${loopId})`}
        x={15}
        y={28}
        width={width - 40}
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
          y={-15}
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

      {/* Outside Body rendering */}
      {children && (
        <Group x={-x} y={-y}>
          {children}
        </Group>
      )}
    </Group>
  );
};

export default LoopCallerForParent;
