import React, { useRef, useEffect } from 'react';
import { Group, Rect, Text } from 'react-konva';
import Konva from 'konva';

interface HeapBlockProps {
  id: string;
  address: string;
  size: number;
  type: string;
  values: any[];
  x: number;
  y: number;
  width: number;
  height: number;
  isNew?: boolean;
  isFreed?: boolean;
}

const COLORS = {
  bg: '#0F172A',
  border: '#10B981',
  borderLight: '#34D399',
  freed: '#64748B',
  text: { primary: '#F1F5F9', secondary: '#94A3B8' },
};

export const HeapBlock: React.FC<HeapBlockProps> = ({
  id,
  address,
  size,
  type,
  values,
  x,
  y,
  width,
  height,
  isNew = false,
  isFreed = false
}) => {
  const groupRef = useRef<Konva.Group>(null);

  useEffect(() => {
    const node = groupRef.current;
    if (!node) return;

    if (isNew) {
      node.opacity(0);
      node.scaleX(0.9);
      node.scaleY(0.9);
      
      const anim = new Konva.Tween({
        node,
        opacity: 1,
        scaleX: 1,
        scaleY: 1,
        duration: 0.4,
        easing: Konva.Easings.EaseOut,
      });
      anim.play();
    }

    if (isFreed) {
      const anim = new Konva.Tween({
        node,
        opacity: 0.5,
        duration: 0.3,
      });
      anim.play();
    }
  }, [isNew, isFreed]);

  return (
    <Group ref={groupRef} id={id} x={x} y={y}>
      <Rect
        width={width}
        height={height}
        fill={isFreed ? COLORS.freed : COLORS.bg}
        stroke={isFreed ? COLORS.freed : COLORS.border}
        strokeWidth={2}
        cornerRadius={6}
        dash={isFreed ? [5, 5] : []}
      />

      <Text
        text={address}
        x={8}
        y={8}
        fontSize={11}
        fill={COLORS.text.secondary}
        fontFamily="monospace"
      />

      <Text
        text={`${type} [${size}]`}
        x={8}
        y={24}
        fontSize={12}
        fill={COLORS.text.primary}
        fontFamily="monospace"
      />

      {values.length > 0 && (
        <Text
          text={values.map(v => String(v)).join(', ')}
          x={8}
          y={40}
          fontSize={11}
          fill={COLORS.text.secondary}
          fontFamily="monospace"
        />
      )}
    </Group>
  );
};

export default HeapBlock;
