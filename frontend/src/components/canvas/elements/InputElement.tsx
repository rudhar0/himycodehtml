import React, { useRef, useEffect } from 'react';
import { Group, Rect, Text } from 'react-konva';
import Konva from 'konva';

interface InputElementProps {
  id: string;
  value?: string | number;
  prompt?: string;
  format?: string;
  varName?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isNew?: boolean;
  isWaiting?: boolean;
}

const COLORS = {
  bg: '#1E293B',
  border: '#F97316',
  borderLight: '#FB923C',
  waiting: '#FCD34D',
  text: { primary: '#F1F5F9', secondary: '#94A3B8' },
};

export const InputElement: React.FC<InputElementProps> = ({
  id,
  value,
  prompt,
  format,
  varName,
  x,
  y,
  width,
  height,
  isNew = false,
  isWaiting = false
}) => {
  const groupRef = useRef<Konva.Group>(null);

  useEffect(() => {
    const node = groupRef.current;
    if (!node) return;

    if (isNew) {
      console.log(`[InputElement] Animating new input: ${varName}`);
      node.opacity(0);
      const startX = x - 20;
      node.x(startX);
      
      const anim = new Konva.Tween({
        node,
        opacity: 1,
        x: x,
        duration: 0.4,
        easing: Konva.Easings.EaseOut,
      });
      anim.play();
    } else {
      node.opacity(1);
      node.x(x);
    }
  }, [isNew, x, varName]);

  const displayValue = value !== undefined ? String(value) : (isWaiting ? 'Waiting...' : '');
  const borderColor = isWaiting ? COLORS.waiting : COLORS.border;

  return (
    <Group ref={groupRef} id={id} x={x} y={y}>
      <Rect
        width={width}
        height={height}
        fill={COLORS.bg}
        stroke={borderColor}
        strokeWidth={2}
        cornerRadius={8}
        dash={isWaiting ? [5, 5] : []}
      />

      <Text
        text="Input:"
        x={12}
        y={8}
        fontSize={11}
        fill={COLORS.text.secondary}
        fontFamily="monospace"
      />

      {varName && (
        <Text
          text={`scanf("%s", &${varName});`}
          x={12}
          y={24}
          fontSize={12}
          fill={COLORS.text.primary}
          fontFamily="monospace"
        />
      )}

      {displayValue && (
        <Text
          text={`Value: ${displayValue}`}
          x={12}
          y={40}
          fontSize={14}
          fill={borderColor}
          fontFamily="monospace"
          fontStyle="bold"
        />
      )}

      {isWaiting && (
        <Text
          text="⏳ Waiting for input..."
          x={12}
          y={40}
          fontSize={12}
          fill={COLORS.waiting}
          fontFamily="monospace"
          fontStyle="italic"
        />
      )}
    </Group>
  );
};

export default InputElement;

