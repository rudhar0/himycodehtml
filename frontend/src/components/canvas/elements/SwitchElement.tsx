import React, { memo } from 'react';
import { Group, Rect, Text, Line } from 'react-konva';

interface SwitchElementProps {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  expression: string;
  isNew?: boolean;
  children?: React.ReactNode;
}

export const SwitchElement: React.FC<SwitchElementProps> = memo(({
  id,
  x,
  y,
  width,
  height,
  expression,
  children
}) => {
  return (
    <Group x={x} y={y}>
      {/* Container Background */}
      <Rect
        width={width}
        height={height}
        stroke="#8B5CF6"
        strokeWidth={1}
        dash={[5, 5]}
        cornerRadius={5}
        fill="rgba(139, 92, 246, 0.05)"
      />
      
      {/* Header */}
      <Group>
        <Rect
          width={width}
          height={30}
          fill="rgba(139, 92, 246, 0.1)"
          cornerRadius={[5, 5, 0, 0]}
        />
        <Text
          text={`switch (${expression})`}
          x={10}
          y={8}
          fontFamily="'SF Mono', monospace"
          fontSize={12}
          fill="#8B5CF6"
          fontStyle="bold"
        />
      </Group>

      {/* Children (Cases) */}
      <Group y={35}>
        {children}
      </Group>
    </Group>
  );
});

export const CaseElement: React.FC<{
  id: string;
  width: number;
  height: number;
  label: string;
  isMatched: boolean;
  x: number;
  y: number;
  children?: React.ReactNode;
}> = memo(({ width, height, label, isMatched, x, y, children }) => {
  return (
    <Group x={x} y={y} opacity={isMatched ? 1 : 0.5}>
      {/* Case Header */}
      <Rect
        width={width}
        height={24}
        fill={isMatched ? "rgba(16, 185, 129, 0.1)" : "rgba(148, 163, 184, 0.1)"}
        stroke={isMatched ? "#10B981" : "#94A3B8"}
        strokeWidth={1}
        cornerRadius={4}
      />
      <Text
        text={label}
        x={8}
        y={6}
        fontSize={11}
        fontFamily="'SF Mono', monospace"
        fill={isMatched ? "#10B981" : "#94A3B8"}
      />
      
      {/* Case Body */}
      <Group y={28}>
        {children}
      </Group>
    </Group>
  );
});
