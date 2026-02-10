import React from 'react';
import { Group, Rect, Text } from 'react-konva';

export interface VariableBoxProps {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  name: string;
  value: string | number;
  type?: string;
  color?: string;
  address?: string;
  isAlive?: boolean;
}

export const VariableBox: React.FC<VariableBoxProps> = ({
  id,
  x,
  y,
  width = 120,
  height = 60,
  name,
  value,
  type,
  color = '#1e293b',
  address,
  isAlive = true,
}) => {
  return (
    <Group id={id} x={x} y={y} opacity={isAlive ? 1 : 0.5} listening={false}>
      <Rect
        name="box-bg"
        width={width}
        height={height}
        fill={color}
        stroke="#475569"
        strokeWidth={2}
        cornerRadius={6}
        shadowColor="black"
        shadowBlur={5}
        shadowOpacity={0.2}
        shadowForStrokeEnabled={false}
      />
      <Text
        x={10}
        y={10}
        text={name}
        fontSize={12}
        fontStyle="bold"
        fill="#94a3b8"
        width={Math.max(0, width - 20)}
        ellipsis={true}
        perfectDrawEnabled={false}
      />
      <Text
        x={10}
        y={30}
        text={String(value)}
        fontSize={16}
        fontFamily="monospace"
        fill="#f8fafc"
        width={Math.max(0, width - 20)}
        ellipsis={true}
        perfectDrawEnabled={false}
        name="variable-value" // Added name prop
      />
      {address && (
        <Text
          x={10}
          y={height - 15}
          text={address}
          fontSize={10}
          fontFamily="monospace"
          fill="#64748b"
          width={Math.max(0, type ? width - 50 : width - 20)}
          ellipsis={true}
          perfectDrawEnabled={false}
        />
      )}
      {type && (
        <Text
          x={10}
          y={height - 15}
          text={type}
          fontSize={10}
          fill="#64748b"
          align="right"
          width={Math.max(0, width - 20)}
          perfectDrawEnabled={false}
        />
      )}
    </Group>
  );
};