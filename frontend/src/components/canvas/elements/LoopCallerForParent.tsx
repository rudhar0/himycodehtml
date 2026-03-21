// frontend/src/components/canvas/elements/LoopCallerForParent.tsx
// FIXED — uses own internal height (not the 50px from LayoutEngine),
//         larger readable fonts, reads condition/iter from data props

import React, { useRef, useEffect, useState } from 'react';
import { Group, Rect, Text, Circle, Line } from 'react-konva';
import Konva from 'konva';
import { useThemeStore } from '../../../store/slices/themeSlice';


// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
interface LoopCallerForParentProps {
  id: string;
  loopType: string;
  loopId: number;

  // passed from VisualizationCanvas via element.data
  condition?:        string;
  totalIterations?:  number;
  currentIteration?: number;
  isActive?:         boolean;
  isComplete?:       boolean;

  x: number;
  y: number;
  width: number;
  height: number;   // from LayoutEngine (50) — used for layout only, NOT for visual height
  isNew?: boolean;
  stepNumber?: number;
  onClick?: () => void;
  children?: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────
// CONSTANTS — visual height is self-contained, layout height is ignored for drawing
// ─────────────────────────────────────────────────────────────
const CALLER_H  = 90;   // actual rendered height regardless of layout prop
const CR        = 10;
const MONO      = "'JetBrains Mono','SF Mono',monospace";
const SANS      = "'Syne','SF Pro Display',system-ui";
const ACTIVE_C  = '#10D47C';
const DONE_C    = '#64748B';

// ─────────────────────────────────────────────────────────────
// PALETTE
// ─────────────────────────────────────────────────────────────
const PALETTE: Record<string, { primary: string; light: string; bg: string; glow: string; dim: string }> = {
  for: {
    primary: '#F59E0B', light: '#FCD34D',
    bg: 'rgba(245,158,11,0.09)', glow: 'rgba(245,158,11,0.5)', dim: 'rgba(245,158,11,0.28)',
  },
  while: {
    primary: '#8B5CF6', light: '#C084FC',
    bg: 'rgba(139,92,246,0.09)', glow: 'rgba(139,92,246,0.5)', dim: 'rgba(139,92,246,0.28)',
  },
  'do-while': {
    primary: '#EC4899', light: '#F472B6',
    bg: 'rgba(236,72,153,0.09)', glow: 'rgba(236,72,153,0.5)', dim: 'rgba(236,72,153,0.28)',
  },
  default: {
    primary: '#8B5CF6', light: '#C084FC',
    bg: 'rgba(139,92,246,0.09)', glow: 'rgba(139,92,246,0.5)', dim: 'rgba(139,92,246,0.28)',
  },
};
const ICON: Record<string, string> = { for: '🔄', while: '🔁', 'do-while': '🔃' };

// ─────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────
export const LoopCallerForParent: React.FC<LoopCallerForParentProps> = ({
  id, loopType, loopId,
  condition, totalIterations, currentIteration = 0,
  isActive = false, isComplete = false,
  x, y, width,
  // height prop intentionally unused for rendering — we use CALLER_H
  isNew = false, stepNumber,
  onClick, children,
}) => {
  const { theme } = useThemeStore();
  const dark = theme === 'dark';
  const groupRef = useRef<Konva.Group>(null);

  const [isHovered, setIsHovered] = useState(false);

  const scheme = isComplete
    ? { primary: DONE_C, light: '#94A3B8', bg: 'rgba(100,116,139,0.08)', glow: 'rgba(100,116,139,0.35)', dim: 'rgba(100,116,139,0.18)' }
    : isActive
      ? { primary: ACTIVE_C, light: '#6EE7B7', bg: 'rgba(16,212,124,0.08)', glow: 'rgba(16,212,124,0.5)', dim: 'rgba(16,212,124,0.22)' }
      : (PALETTE[loopType] ?? PALETTE.default);

  // ── ENTRANCE ANIMATION ──────────────────────────────────────
  useEffect(() => {
    const g = groupRef.current;
    if (!g || !isNew) return;
    g.opacity(0); g.scaleX(0.82); g.scaleY(0.82);
    new Konva.Tween({
      node: g, opacity: 1, scaleX: 1, scaleY: 1,
      duration: 0.45, easing: Konva.Easings.BackEaseOut,
    }).play();
  }, [isNew]);

  // Progress bar
  const pct = totalIterations && totalIterations > 0
    ? Math.min((currentIteration / totalIterations) * 100, 100) : 0;
  const progressW = (pct / 100) * (width - 8);

  // Row Y positions inside the card
  const ROW1_Y = 10;   // icon + type + id pill
  const ROW2_Y = 38;   // condition
  const ROW3_Y = 60;   // iters row

  return (
    <Group
      ref={groupRef} id={id} x={x} y={y}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick} onTap={onClick}
    >
      {/* ── Glow halo ── */}
      <Rect
        x={-3} y={-3} width={width + 6} height={CALLER_H + 6}
        fill="transparent" cornerRadius={CR + 2}
        shadowColor={isHovered || isActive ? scheme.glow : 'rgba(0,0,0,0.3)'}
        shadowBlur={isHovered ? 22 : isActive ? 18 : 8}
        shadowOpacity={0.9}
      />

      {/* ── Card body ── */}
      <Rect
        width={width} height={CALLER_H}
        fill={dark ? "rgba(11,18,32,0.97)" : "rgba(255,255,255,0.97)"}
        stroke={isHovered ? scheme.primary : scheme.dim}
        strokeWidth={isHovered ? 2 : 1.5}
        cornerRadius={CR}
      />


      {/* ── Tinted header area ── */}
      <Rect
        width={width} height={50}
        fill={scheme.bg}
        cornerRadius={[CR, CR, 0, 0]}
      />

      {/* ── Left accent stripe ── */}
      <Rect
        x={0} y={0} width={4} height={CALLER_H}
        fill={scheme.primary}
        cornerRadius={[CR, 0, 0, CR]}
        shadowColor={scheme.glow} shadowBlur={8}
      />

      {/* ══ ROW 1 — icon + type + id badge ══════════════════════ */}
      {/* Icon */}
      <Text text={ICON[loopType] ?? '🔄'} x={13} y={ROW1_Y} fontSize={18} />

      {/* Type label */}
      <Text
        text={loopType.toUpperCase()}
        x={36} y={ROW1_Y + 2}
        fontSize={15} fontStyle="bold"
        fill={scheme.light} fontFamily={SANS}
      />

      {/* Loop-id pill */}
      <Group x={width - 46} y={ROW1_Y + 1}>
        <Rect width={34} height={20} fill="rgba(20,32,54,0.85)" stroke={scheme.dim} strokeWidth={1} cornerRadius={10} />
        <Text text={`#${loopId}`} width={34} y={3} fontSize={10} fill={scheme.light} align="center" fontFamily={MONO} />
      </Group>

      {/* ── Divider ── */}
      <Line points={[6, 34, width - 6, 34]} stroke="rgba(30,48,72,0.9)" strokeWidth={1} />

      {/* ══ ROW 2 — condition ════════════════════════════════════ */}
      {condition ? (
        <Group x={12} y={ROW2_Y}>
          {/* "cond" tag */}
          <Rect width={38} height={18} fill="rgba(15,25,45,0.8)" stroke="rgba(100,116,139,0.2)" strokeWidth={1} cornerRadius={4} />
          <Text text="cond" x={5} y={3} fontSize={9} fontStyle="bold" fill="#3D5070" fontFamily={SANS} />
          {/* Expression */}
          <Text
            text={condition}
            x={44} y={2}
            width={width - 64} height={18}
            fontSize={12} fontStyle="bold"
            fill="#A8BECC" fontFamily={MONO}
            ellipsis wrap="none"
          />
        </Group>
      ) : (
        <Text
          text="no condition"
          x={13} y={ROW2_Y + 2}
          fontSize={11} fill="#3D5070" fontFamily={MONO}
        />
      )}

      {/* ══ ROW 3 — iters ════════════════════════════════════════ */}
      <Group x={12} y={ROW3_Y}>
        {/* "iters" tag */}
        <Rect width={38} height={18} fill="rgba(15,25,45,0.8)" stroke="rgba(100,116,139,0.2)" strokeWidth={1} cornerRadius={4} />
        <Text text="iters" x={4} y={3} fontSize={9} fontStyle="bold" fill="#3D5070" fontFamily={SANS} />

        {totalIterations !== undefined ? (
          <Text
            text={`${currentIteration} / ${totalIterations}`}
            x={44} y={2}
            fontSize={12} fontStyle="bold"
            fill={scheme.light} fontFamily={MONO}
          />
        ) : (
          <Text text="dynamic" x={44} y={2} fontSize={12} fill="#4A6080" fontFamily={MONO} />
        )}

        {/* Active dot */}
        {isActive && (
          <Circle
            x={width - 20} y={9}
            radius={5}
            fill={ACTIVE_C} shadowColor={ACTIVE_C} shadowBlur={10}
          />
        )}

        {/* Complete badge */}
        {isComplete && (
          <Group x={width - 54} y={0}>
            <Rect width={40} height={18} fill="rgba(100,116,139,0.15)" stroke="#334155" strokeWidth={1} cornerRadius={9} />
            <Text text="DONE" width={40} y={3} fontSize={9} fontStyle="bold" fill="#64748B" align="center" fontFamily={SANS} />
          </Group>
        )}
      </Group>

      {/* ── Progress bar ── */}
      {totalIterations !== undefined && totalIterations > 0 && (
        <Group x={4} y={CALLER_H - 5}>
          <Rect width={width - 8} height={3} fill="rgba(255,255,255,0.04)" cornerRadius={2} />
          <Rect width={progressW} height={3} fill={scheme.primary} cornerRadius={2}
            shadowColor={scheme.primary} shadowBlur={5} shadowOpacity={0.5} />
        </Group>
      )}

      {/* ── Step number ── */}
      {stepNumber !== undefined && (
        <Text text={`#${stepNumber}`} x={width - 32} y={CALLER_H - 14} fontSize={9} fill="#283850" fontFamily={MONO} />
      )}

      {/* ── Connector dot (right edge, vertically centred) ── */}
      <Circle
        x={width + 3} y={CALLER_H / 2}
        radius={5}
        fill={scheme.primary}
        shadowColor={scheme.glow} shadowBlur={8}
      />

      {/* Pass-through children */}
      {children && <Group x={-x} y={-y}>{children}</Group>}
    </Group>
  );
};

export default LoopCallerForParent;