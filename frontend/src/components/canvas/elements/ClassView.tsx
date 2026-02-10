import React, { useRef, useEffect } from 'react';
import { Group, Rect, Text } from 'react-konva';
import Konva from 'konva';

interface ClassViewProps {
  id: string;
  typeName: string;
  objectName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isNew?: boolean;
  children?: React.ReactNode;
}

const COLORS = {
  bg: '#1E293B',
  border: '#EC4899', // Pink border for classes
  borderLight: '#F472B6',
  text: { primary: '#F1F5F9', secondary: '#94A3B8' },
};

export const ClassView: React.FC<ClassViewProps> = ({
  id,
  typeName,
  objectName,
  x,
  y,
  width,
  height,
  isNew = false,
  children
}) => {
  const groupRef = useRef<Konva.Group>(null);

  useEffect(() => {
    const node = groupRef.current;
    if (!node) return;

    if (isNew) {
      console.log(`[ClassView] Animating new class: ${typeName}`);
      node.opacity(0);
      node.scaleY(0);
      
      const anim = new Konva.Tween({
        node,
        opacity: 1,
        scaleY: 1,
        duration: 0.4,
        easing: Konva.Easings.EaseOut,
      });
      anim.play();
    } else {
      node.opacity(1);
      node.scaleY(1);
    }
  }, [isNew, typeName]);

  const displayText = objectName ? `${typeName}: ${objectName}` : `class ${typeName}`;

  return (
    <Group ref={groupRef} id={id} x={x} y={y}>
      {/* Class Background */}
      <Rect
        width={width}
        height={height}
        fill={COLORS.bg}
        stroke={COLORS.border}
        strokeWidth={2}
        cornerRadius={8}
        shadowColor={COLORS.border}
        shadowBlur={10}
        shadowOpacity={0.3}
      />

      {/* Type Name Header */}
      <Rect
        width={width}
        height={30}
        fill={COLORS.border}
        fillOpacity={0.2}
        cornerRadius={[8, 8, 0, 0]}
      />
      
      <Text
        text={displayText}
        x={15}
        y={8}
        fontSize={16}
        fontStyle="bold"
        fill={COLORS.text.primary}
        fontFamily="monospace"
      />

      {/* Children Container */}
      <Group x={0} y={30}>
        {children}
      </Group>
    </Group>
  );
};

export default ClassView;