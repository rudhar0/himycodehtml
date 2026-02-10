import React from 'react';
import { Group, Rect, Text } from 'react-konva';

export interface FunctionFrameProps {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
}

export const FunctionFrame: React.FC<FunctionFrameProps> = ({
  id,
  x,
  y,
  width,
  height,
  name,
}) => {
  return (
    <Group id={id} x={x} y={y}>
      <Rect
        width={width}
        height={height}
        fill="rgba(30, 41, 59, 0.5)" // slate-800/50
        stroke="#334155" // slate-700
        strokeWidth={2}
        dash={[10, 5]}
        cornerRadius={8}
      />
      <Text
        x={10}
        y={-20}
        text={`${name}()`}
        fontSize={14}
        fontStyle="bold"
        fill="#60a5fa" // blue-400
      />
    </Group>
  );
};