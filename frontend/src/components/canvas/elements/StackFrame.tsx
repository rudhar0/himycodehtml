import React, { useRef, useEffect } from 'react';
import { Group, Rect, Text } from 'react-konva';
import Konva from 'konva';

interface StackFrameProps {
  id: string;
  functionName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isNew?: boolean;
  children?: React.ReactNode;
}

const COLORS = {
  bg: '#1E293B',
  border: '#A855F7',
  borderLight: '#C084FC',
  text: { primary: '#F1F5F9', secondary: '#94A3B8' },
};

export const StackFrame: React.FC<StackFrameProps> = ({
  id,
  functionName,
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
      console.log(`[StackFrame] Animating new frame: ${functionName}`);
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
      // Ensure final state
      node.opacity(1);
      node.scaleY(1);
    }
  }, [isNew, functionName]);

  return (
    <Group ref={groupRef} id={id} x={x} y={y}>
      {/* Frame Background */}
      <Rect
        width={width}
        height={Math.max(height, 80)} // Ensure minimum height and respect passed height
        fill={COLORS.bg}
        stroke={COLORS.border}
        strokeWidth={2}
        cornerRadius={8}
        shadowColor={COLORS.border}
        shadowBlur={10}
        shadowOpacity={0.3}
      />

      {/* Function Name Header */}
      <Rect
        width={width}
        height={40}
        fill={COLORS.border}
        fillOpacity={0.2}
        cornerRadius={[8, 8, 0, 0]}
      />
      
      <Text
        text={functionName}
        x={20}
        y={12}
        fontSize={18}
        fontStyle="bold"
        fill={COLORS.text.primary}
        fontFamily="monospace"
      />

      {/* Children Container */}
      <Group x={0} y={40}>
        {children}
      </Group>
    </Group>
  );
};

export default StackFrame;
