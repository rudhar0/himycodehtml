// frontend/src/components/canvas/elements/IterationElement.tsx
// REDESIGNED — iteration badge, var-state chips, current-iteration highlight

import React, { memo } from 'react';
import { Group, Rect, Text, Line } from 'react-konva';

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
interface IterationElementProps {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  iteration: number;
  // optional snapshot of loop-control vars at iteration start
  varSnapshot?: Record<string, string | number>;
  isCurrent?: boolean;   // true → green tint, "current" label
  children?: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────
const HEADER_H = 26;
const MONO     = "'JetBrains Mono','SF Mono',monospace";
const SANS     = "'Syne','SF Pro Display',system-ui";
const OK       = '#10D47C';

// ─────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────
export const IterationElement: React.FC<IterationElementProps> = memo(({
  id, x, y, width, height,
  iteration, varSnapshot = {}, isCurrent = false,
  children,
}) => {
  const borderCol = isCurrent ? `${OK}40` : 'rgba(30,45,66,0.9)';
  const headerBg  = isCurrent ? 'rgba(16,212,124,0.06)' : 'rgba(14,22,38,0.7)';
  const badgeBg   = isCurrent ? 'rgba(16,212,124,0.14)' : 'rgba(255,255,255,0.04)';
  const badgeBorder = isCurrent ? `${OK}55` : 'rgba(100,116,139,0.25)';
  const badgeText = isCurrent ? OK : '#4A6080';

  const varEntries = Object.entries(varSnapshot);

  return (
    <Group x={x} y={y}>
      {/* ── Outer border ── */}
      <Rect
        width={width} height={Math.max(HEADER_H + 10, height)}
        fill="rgba(8,14,26,0.45)"
        stroke={borderCol} strokeWidth={1}
        cornerRadius={8}
      />

      {/* ── Header strip ── */}
      <Rect
        width={width} height={HEADER_H}
        fill={headerBg}
        cornerRadius={[8, 8, 0, 0]}
      />

      {/* ── Iteration number badge ── */}
      <Group x={8} y={4}>
        <Rect
          width={22} height={18}
          fill={badgeBg} stroke={badgeBorder} strokeWidth={1} cornerRadius={5}
        />
        <Text
          text={String(iteration)}
          width={22} y={3}
          fontSize={9} fontStyle="bold"
          fill={badgeText} align="center" fontFamily={MONO}
        />
      </Group>

      {/* ── "iteration" or "current" label ── */}
      <Text
        text={isCurrent ? 'current' : 'iteration'}
        x={38} y={7}
        fontSize={9} fontStyle={isCurrent ? 'bold' : 'normal'}
        fill={isCurrent ? OK : '#3D5070'}
        fontFamily={SANS} letterSpacing={0.5}
      />

      {/* ── Var state chips (right-aligned) ── */}
      {varEntries.length > 0 && (
        <Group x={width - 8} y={5}>
          {varEntries.slice(0, 4).map(([k, v], i) => {
            const chipW = Math.max(36, (k.length + String(v).length) * 6.5 + 16);
            return (
              <Group key={k} x={-(chipW + 4) * (varEntries.length - i)}>
                <Rect
                  width={chipW} height={16}
                  fill="rgba(15,25,45,0.8)" stroke="rgba(100,116,139,0.18)" strokeWidth={1} cornerRadius={4}
                />
                <Text
                  text={`${k}=${v}`} x={5} y={3}
                  fontSize={8} fill="#5A7A9A" fontFamily={MONO}
                />
              </Group>
            );
          })}
        </Group>
      )}

      {/* ── Divider ── */}
      <Line
        points={[0, HEADER_H, width, HEADER_H]}
        stroke={isCurrent ? `${OK}20` : 'rgba(30,45,66,0.9)'}
        strokeWidth={1}
      />

      {/* ── Content ── */}
      <Group y={HEADER_H + 6}>
        {children}
      </Group>
    </Group>
  );
});

IterationElement.displayName = 'IterationElement';
export default IterationElement;