import React, { useRef, useEffect } from 'react';
import { Group, Rect, Text } from 'react-konva';
import Konva from 'konva';

interface InputElementProps {
  id: string;
  value?: string | number;
  prompt?: string;
  format?: string;
  varName?: string;
  /** Per-variable assignment values from merged input_assign step */
  assignments?: Record<string, any>;
  /** returnNote from merged input step, e.g. "returned 1 → stored in a" */
  returnNote?: string;
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
  assignKey: '#94A3B8',
  assignVal: '#38BDF8',
  returnNote: '#A78BFA',
  text: { primary: '#F1F5F9', secondary: '#94A3B8' },
};

export const InputElement: React.FC<InputElementProps> = ({
  id,
  value,
  prompt,
  format,
  varName,
  assignments,
  returnNote,
  x,
  y,
  width,
  height,
  isNew = false,
  isWaiting = false,
}) => {
  const groupRef = useRef<Konva.Group>(null);

  useEffect(() => {
    const node = groupRef.current;
    if (!node) return;

    if (isNew) {
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

  const borderColor = isWaiting ? COLORS.waiting : COLORS.border;

  // Build the scanf display string: prefer format/prompt, fall back to varName
  const scanfDisplay = format
    ? `scanf("${format}")`
    : prompt
    ? `scanf("${prompt}")`
    : varName
    ? `scanf("%s", &${varName})`
    : 'scanf(...)';

  // Flatten assignments dict into sortable entries
  const assignmentEntries = assignments
    ? Object.entries(assignments).filter(([, v]) => v !== undefined && v !== null)
    : [];

  // Fall back: show value + varName as single assignment if no assignments dict
  const hasAssignments = assignmentEntries.length > 0;
  const fallbackValue =
    !hasAssignments && value !== undefined ? String(value) : null;

  let cursorY = 8;

  return (
    <Group ref={groupRef} id={id} x={x} y={y}>
      {/* Background */}
      <Rect
        width={width}
        height={height}
        fill={COLORS.bg}
        stroke={borderColor}
        strokeWidth={2}
        cornerRadius={8}
        dash={isWaiting ? [5, 5] : []}
      />

      {/* Header label */}
      <Text
        text="📥 INPUT"
        x={12}
        y={cursorY}
        fontSize={11}
        fill={COLORS.text.secondary}
        fontFamily="monospace"
      />

      {/* scanf call */}
      <Text
        text={scanfDisplay}
        x={12}
        y={(cursorY += 16)}
        fontSize={12}
        fill={COLORS.text.primary}
        fontFamily="monospace"
      />

      {/* Assignment values (from merged input_assign step) */}
      {hasAssignments &&
        assignmentEntries.map(([varKey, varVal], idx) => (
          <Text
            key={varKey}
            text={`${varKey} = ${varVal}`}
            x={12}
            y={(cursorY = 8 + 16 + 18 + idx * 18)}
            fontSize={12}
            fill={COLORS.assignVal}
            fontFamily="monospace"
            fontStyle="bold"
          />
        ))}

      {/* Fallback single value (e.g. when value provided but no assignments dict) */}
      {!hasAssignments && fallbackValue && (
        <Text
          text={varName ? `${varName} = ${fallbackValue}` : `Value: ${fallbackValue}`}
          x={12}
          y={8 + 16 + 18}
          fontSize={12}
          fill={COLORS.assignVal}
          fontFamily="monospace"
          fontStyle="bold"
        />
      )}

      {/* Return note (e.g. "returned 1 → stored in a") */}
      {returnNote && (
        <Text
          text={returnNote}
          x={12}
          y={height - 16}
          fontSize={10}
          fill={COLORS.returnNote}
          fontFamily="monospace"
          fontStyle="italic"
          width={width - 24}
          ellipsis
        />
      )}

      {/* Waiting indicator */}
      {isWaiting && (
        <Text
          text="⏳ Waiting for input..."
          x={12}
          y={8 + 16 + 18}
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
