import React, { useRef, useEffect, useState } from 'react';
import { Group, Rect, Text, Circle } from 'react-konva';
import Konva from 'konva';

interface ConditionCallerForParentProps {
  id: string;
  condition: string;
  conditionResult?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  isNew?: boolean;
  stepNumber?: number;
  onClick?: () => void;
}

const COLORS = {
  bg: '#1e293b', // slightly slate dark
  border: '#f59e0b', // amber border for conditions
  text: '#fcd34d', // amber text
  label: '#fbbf24', // lighter amber
};

export const ConditionCallerForParent: React.FC<ConditionCallerForParentProps> = ({
  id,
  condition,
  conditionResult,
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

  const resultLabel = conditionResult === true ? 'TRUE' : (conditionResult === false ? 'FALSE' : '?');
  const resultColor = conditionResult === true ? '#22c55e' : (conditionResult === false ? '#ef4444' : '#94a3b8');

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
        text="EVAL"
        x={15}
        y={10}
        fontSize={10}
        fontStyle="bold"
        fill={COLORS.label}
        fontFamily="'SF Mono', monospace"
        letterSpacing={1}
      />

      {/* Condition Expression */}
      <Text
        text={condition}
        x={15}
        y={28}
        width={width - 80}
        fontSize={16}
        fontStyle="bold"
        fill={COLORS.text}
        fontFamily="'SF Mono', monospace"
        ellipsis={true}
      />

      {/* Result Indicator */}
      <Rect
        x={width - 65}
        y={10}
        width={50}
        height={30}
        fill="rgba(15,23,42,0.6)"
        stroke={resultColor}
        strokeWidth={2}
        cornerRadius={6}
      />
      <Text
        text={resultLabel}
        x={width - 65}
        y={20}
        width={50}
        align="center"
        fontSize={12}
        fontStyle="bold"
        fill={resultColor}
        fontFamily="'SF Mono', monospace"
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
    </Group>
  );
};

export default ConditionCallerForParent;
