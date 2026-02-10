import React from 'react';
import { Group, Rect, Text } from 'react-konva';

interface AstNodeProps {
  node: any;
  x: number;
  y: number;
  activeNode: any;
  currentStep: any;
}

const AstNode: React.FC<AstNodeProps> = ({ node, x, y, activeNode }) => {
  if (!node) return null;

  const isActive = activeNode && activeNode.id === node.id;

  return (
    <Group x={x} y={y}>
      <Rect
        width={120}
        height={60}
        fill={isActive ? '#3b82f6' : '#1e293b'}
        stroke={isActive ? '#60a5fa' : '#475569'}
        strokeWidth={2}
        cornerRadius={8}
      />
      <Text
        text={node.type || 'Node'}
        fill="#f8fafc"
        fontSize={14}
        width={120}
        align="center"
        y={22}
      />
    </Group>
  );
};

export default AstNode;