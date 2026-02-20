import React, { useRef, useEffect } from 'react';
import { Group, Rect, Text } from 'react-konva';
import Konva from 'konva';
import { resizeContainer } from '../utils/resizeContainer';

interface StructViewProps {
  id: string;
  typeName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isNew?: boolean;
  children?: React.ReactNode;
}

const COLORS = {
  bg: '#1E293B',
  border: '#22D3EE', // Cyan border for structs
  borderLight: '#67E8F9',
  text: { primary: '#F1F5F9', secondary: '#94A3B8' },
};

export const StructView: React.FC<StructViewProps> = ({
  id,
  typeName,
  x,
  y,
  width,
  height,
  isNew = false,
  children
}) => {
  const groupRef = useRef<Konva.Group>(null);
  const tweenRef = useRef<Konva.Tween | null>(null);

  useEffect(() => {
    const node = groupRef.current;
    if (!node) return;

    if (isNew) {
      console.log(`[StructView] Animating new struct: ${typeName}`);
      node.opacity(0);
      node.scaleY(0.01);
      
      if (tweenRef.current) {
        tweenRef.current.destroy();
        tweenRef.current = null;
      }

      const anim = new Konva.Tween({
        node,
        opacity: 1,
        scaleY: 1,
        duration: 0.4,
        easing: Konva.Easings.EaseOut,
        onFinish: () => {
          resizeContainer(node, { padding: 14, minWidth: width, minHeight: 60 });
          node.getLayer()?.batchDraw();
        },
      });
      tweenRef.current = anim;
      anim.play();
    } else {
      node.opacity(1);
      node.scaleY(1);
      requestAnimationFrame(() => {
        resizeContainer(node, { padding: 14, minWidth: width, minHeight: height });
        node.getLayer()?.batchDraw();
      });
    }

    return () => {
      if (tweenRef.current) {
        tweenRef.current.destroy();
        tweenRef.current = null;
      }
    };
  }, [isNew, typeName, width, height]);

  return (
    <Group ref={groupRef} id={id} x={x} y={y} name="auto-resize">
      {/* Struct Background */}
      <Rect
        name="main-bg"
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
      <Group name="content-bounds">
        <Rect
          width={width}
          height={30}
          fill={COLORS.border}
          fillOpacity={0.2}
          cornerRadius={[8, 8, 0, 0]}
        />
        
        <Text
          text={`struct ${typeName}`}
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
    </Group>
  );
};

export default StructView;
