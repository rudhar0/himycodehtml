// frontend/src/components/canvas/elements/LoopElement.tsx
//
// LAYOUT NOTE — keep in sync with VisualizationCanvas.tsx getBodyOffsetY:
//   case "loop": return subtype === "iteration" ? 25 : BODY_START_Y;
//
// BODY_START_Y = HEADER_HEIGHT + 10  (exported so Canvas can import it)
//
// for-loop  header: 148px  →  body starts at 158
// while/dw  header: 100px  →  but we use 148 for all types so canvas stays simple

import React, { useRef, useEffect, useState, memo, useCallback } from 'react';
import { Group, Rect, Text, Line, Circle } from 'react-konva';
import Konva from 'konva';
import { resizeContainer } from '../utils/resizeContainer';

// ─────────────────────────────────────────────────────────────
// EXPORTED CONSTANT — import this in VisualizationCanvas.tsx
// and use it as: case "loop": return subtype === "iteration" ? 25 : LOOP_BODY_START_Y
// ─────────────────────────────────────────────────────────────
export const LOOP_BODY_START_Y = 158;  // HEADER_HEIGHT (148) + 10 gap

// ─────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────
export interface LoopElementProps {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;

  loopType: 'for' | 'while' | 'do-while';
  loopId: number;

  currentIteration?: number;
  totalIterations?: number;
  isActive?: boolean;
  isComplete?: boolean;

  initialization?: string;
  condition?: string;
  update?: string;

  conditionResult?: boolean;
  isConditionStep?: boolean;
  isUpdateStep?: boolean;
  // { varName: newValue }  OR  { varName: { old, new } }
  updateValues?: Record<string, any>;

  isNew?: boolean;
  stepNumber?: number;
  enterDelay?: number;
  children?: React.ReactNode;
  onSkip?: () => void;
}

// ─────────────────────────────────────────────────────────────
// LAYOUT
// ─────────────────────────────────────────────────────────────
const BOX_WIDTH      = 480;
const HEADER_HEIGHT  = 148;   // ← sync with LOOP_BODY_START_Y above
const PADDING        = 16;
const CR             = 10;
const CAPSULE_H      = 32;
const CAPSULE_R      = 8;

// Row positions (absolute y inside header)
const R_BADGE   = 10;  // badge + skip + counter  (ends ~36)
const R_INIT    = 46;  // init chip — for-loop only  (ends ~64)
const R_COND    = 68;  // CONDITION capsule  (ends 100)
const R_UPD     = 108; // UPDATE capsule — for-loop only  (ends 140)
const R_PROG    = 144; // progress bar  (ends 148)

const MONO = "'JetBrains Mono','SF Mono',monospace";
const SANS = "'Syne','SF Pro Display',system-ui";

// ─────────────────────────────────────────────────────────────
// PALETTE
// ─────────────────────────────────────────────────────────────
const P = {
  for:        { primary: '#F59E0B', light: '#FCD34D', bg: 'rgba(245,158,11,0.09)',  glow: 'rgba(245,158,11,0.55)'  },
  while:      { primary: '#8B5CF6', light: '#C084FC', bg: 'rgba(139,92,246,0.09)',  glow: 'rgba(139,92,246,0.55)' },
  'do-while': { primary: '#EC4899', light: '#F472B6', bg: 'rgba(236,72,153,0.09)',  glow: 'rgba(236,72,153,0.55)' },
  active:     { primary: '#10B981', light: '#6EE7B7', bg: 'rgba(16,185,129,0.09)',  glow: 'rgba(16,185,129,0.6)'  },
  complete:   { primary: '#64748B', light: '#94A3B8', bg: 'rgba(100,116,139,0.09)', glow: 'rgba(100,116,139,0.4)' },
} as const;

// Condition colours — clearly distinct from loop-type colours
const COND_TRUE_PRIMARY  = '#10D47C';
const COND_TRUE_BG       = 'rgba(16,212,124,0.14)';
const COND_TRUE_GLOW     = '#10D47C';

const COND_FALSE_PRIMARY = '#F0545A';
const COND_FALSE_BG      = 'rgba(240,84,90,0.14)';
const COND_FALSE_GLOW    = '#F0545A';

// Update colour — amber, different from green/red
const UPD_PRIMARY = '#F59E0B';
const UPD_BG      = 'rgba(245,158,11,0.14)';
const UPD_GLOW    = '#F59E0B';

const ICON: Record<string, string> = { for: '🔄', while: '🔁', 'do-while': '🔃' };

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────
interface Entry { name: string; oldVal: string; newVal: string; hasOld: boolean }
function parseUpdates(uv: Record<string, any>): Entry[] {
  return Object.entries(uv).map(([name, v]) => {
    if (v !== null && typeof v === 'object' && ('new' in v || 'old' in v)) {
      return { name, oldVal: String(v.old ?? ''), newVal: String(v.new ?? ''), hasOld: 'old' in v };
    }
    return { name, oldVal: '', newVal: String(v ?? ''), hasOld: false };
  });
}

// ─────────────────────────────────────────────────────────────
// ANIMATION HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * 3-pulse glow animation: brightens → dims → brightens → dims → fade.
 * Total duration ≈ 1.5 s — long enough for the user to read the result.
 */
function runPulseAnimation(
  rect: Konva.Rect,
  fillColor: string,
  strokeColor: string,
  glowColor: string,
) {
  if (!rect.getLayer()) return;

  // Immediately set colour (no animation for the fill itself)
  rect.fill(fillColor);
  rect.stroke(strokeColor);
  rect.shadowColor(glowColor);
  rect.getLayer()?.batchDraw();

  // Pulse 1 — fast ramp up
  rect.to({
    shadowBlur: 30, opacity: 1, duration: 0.35,
    onFinish: () => {
      if (!rect.getLayer()) return;
      // Pulse 1 — decay
      rect.to({
        shadowBlur: 8, opacity: 0.75, duration: 0.35,
        onFinish: () => {
          if (!rect.getLayer()) return;
          // Pulse 2 — ramp up again
          rect.to({
            shadowBlur: 24, opacity: 1, duration: 0.3,
            onFinish: () => {
              if (!rect.getLayer()) return;
              // Pulse 2 — slow decay, stays visible
              rect.to({ shadowBlur: 14, opacity: 0.9, duration: 0.5 });
            },
          });
        },
      });
    },
  });
}

/** Fade a rect back to its neutral idle appearance */
function fadeToNeutral(rect: Konva.Rect) {
  if (!rect.getLayer()) return;
  rect.to({
    shadowBlur: 0, opacity: 0.65, duration: 0.6,
    onFinish: () => {
      if (!rect.getLayer()) return;
      rect.fill('rgba(15,25,45,0.70)');
      rect.stroke('rgba(100,116,139,0.22)');
      rect.shadowColor('transparent');
      rect.getLayer()?.batchDraw();
    },
  });
}

// ─────────────────────────────────────────────────────────────
// COMPONENT
// ─────────────────────────────────────────────────────────────
export const LoopElement: React.FC<LoopElementProps> = memo(({
  id, x, y, width, height,
  loopType, loopId,
  currentIteration = 0, totalIterations,
  isActive = false, isComplete = false,
  initialization, condition, update,
  conditionResult, isConditionStep = false,
  isUpdateStep = false, updateValues = {},
  isNew = false, stepNumber, enterDelay = 0,
  children, onSkip,
}) => {

  const groupRef    = useRef<Konva.Group>(null);
  const glowRef     = useRef<Konva.Rect>(null);
  const progressRef = useRef<Konva.Rect>(null);
  const condBgRef   = useRef<Konva.Rect>(null);
  const updBgRef    = useRef<Konva.Rect>(null);
  const tweenRef    = useRef<Konva.Tween | null>(null);
  const mountRef    = useRef(true);

  const baseW = width  || BOX_WIDTH;
  const baseH = height || 240;
  const [autoSize, setAutoSize] = useState({ width: baseW, height: baseH });
  const totalWidth  = Math.max(baseW, autoSize.width);
  const totalHeight = Math.max(baseH, autoSize.height);
  const capsuleW    = totalWidth - PADDING * 2;

  const scheme = isComplete ? P.complete : isActive ? P.active : P[loopType];
  const border = scheme.primary;

  const pct      = totalIterations && totalIterations > 0 ? Math.min((currentIteration / totalIterations) * 100, 100) : 0;
  const entries  = parseUpdates(updateValues);
  const hasUpd   = isUpdateStep && entries.length > 0;

  // ── ENTRANCE ANIMATION ──────────────────────────────────────
  useEffect(() => {
    const g = groupRef.current;
    const gl = glowRef.current;
    if (!g) return;
    tweenRef.current?.destroy(); tweenRef.current = null;

    if (isNew && mountRef.current) {
      g.opacity(0); g.scaleX(0.01); g.scaleY(0.01);
      const oy = g.y(); g.y(oy + 30);
      const play = () => {
        if (!g.getLayer()) return;
        tweenRef.current = new Konva.Tween({
          node: g, opacity: 1, scaleX: 1, scaleY: 1, y: oy,
          duration: 0.5, easing: Konva.Easings.BackEaseOut,
          onFinish: () => {
            gl?.getLayer() && gl.to({ opacity: 0.7, duration: 0.3 });
            resizeContainer(g, { padding: 16, minWidth: baseW, minHeight: baseH });
            g.getLayer()?.batchDraw();
          },
        });
        tweenRef.current.play();
      };
      if (enterDelay > 0) {
        const t = setTimeout(play, enterDelay);
        return () => { clearTimeout(t); tweenRef.current?.destroy(); tweenRef.current = null; };
      }
      requestAnimationFrame(play);
    } else if (mountRef.current) {
      g.opacity(1); g.scaleX(1); g.scaleY(1);
      if (gl) gl.opacity(0.7);
      mountRef.current = false;
    }
    return () => { tweenRef.current?.destroy(); tweenRef.current = null; };
  }, [isNew, enterDelay, baseW, baseH]);

  // ── CARD GLOW ──────────────────────────────────────────────
  useEffect(() => {
    const gl = glowRef.current;
    if (!gl?.getLayer()) return;
    gl.to({ shadowBlur: isActive ? 30 : 16, opacity: isActive ? 0.9 : 0.7, duration: 0.25 });
  }, [isActive]);

  // ── CONDITION CAPSULE ANIMATION (1.5 s double-pulse) ────────
  // GREEN for true, RED for false — clearly distinct from loop colour
  useEffect(() => {
    const r = condBgRef.current;
    if (!r?.getLayer()) return;

    if (isConditionStep) {
      const fillCol  = conditionResult ? COND_TRUE_BG       : COND_FALSE_BG;
      const strkCol  = conditionResult ? COND_TRUE_PRIMARY   : COND_FALSE_PRIMARY;
      const glowCol  = conditionResult ? COND_TRUE_GLOW      : COND_FALSE_GLOW;
      runPulseAnimation(r, fillCol, strkCol, glowCol);
    } else {
      fadeToNeutral(r);
    }
  }, [isConditionStep, conditionResult]);

  // ── UPDATE CAPSULE ANIMATION (1.3 s amber pulse) ────────────
  // AMBER/ORANGE — different from both green and red
  useEffect(() => {
    const r = updBgRef.current;
    if (!r?.getLayer()) return;

    if (hasUpd) {
      runPulseAnimation(r, UPD_BG, UPD_PRIMARY, UPD_GLOW);
    } else {
      fadeToNeutral(r);
    }
  }, [hasUpd]);

  // ── PROGRESS BAR ──────────────────────────────────────────
  useEffect(() => {
    const pr = progressRef.current;
    if (!pr?.getLayer()) return;
    if (totalIterations && totalIterations > 0) {
      pr.to({ width: (pct / 100) * totalWidth, duration: 0.4, easing: Konva.Easings.EaseInOut });
    }
  }, [currentIteration, totalIterations, pct, totalWidth]);

  // ── AUTO-SIZE ─────────────────────────────────────────────
  const measure = useCallback(() => {
    const g = groupRef.current;
    if (!g?.getLayer() || g.scaleX() < 0.9 || g.opacity() < 1) return;
    const cb = g.findOne<Konva.Node>('.content-bounds');
    if (!cb) return;
    const b = cb.getClientRect({ relativeTo: g, skipTransform: true, skipShadow: true });
    setAutoSize(prev => {
      const nw = Math.max(baseW, Math.ceil(b.x + b.width)  + PADDING);
      const nh = Math.max(baseH, Math.ceil(b.y + b.height) + PADDING + 60);
      return prev.width === nw && prev.height === nh ? prev : { width: nw, height: nh };
    });
  }, [baseW, baseH]);

  useEffect(() => {
    setAutoSize(prev =>
      prev.width === baseW && prev.height === baseH ? prev : { width: baseW, height: baseH });
    const r = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(r);
  }, [baseW, baseH, measure, children, isConditionStep, conditionResult,
      isUpdateStep, updateValues, currentIteration, totalIterations, isActive, isComplete]);

  // ──────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────
  return (
    <Group ref={groupRef} id={id} x={x} y={y} name="auto-resize">

      {/* ── Outer glow halo ── */}
      <Rect
        ref={glowRef} name="glow-bg"
        x={-5} y={-5} width={totalWidth + 10} height={totalHeight + 10}
        fill="transparent" cornerRadius={CR + 3}
        shadowColor={isActive ? P.active.glow : scheme.glow}
        shadowBlur={16} shadowOpacity={0.7} opacity={0}
      />

      {/* ── Card shell ── */}
      <Rect
        name="main-bg"
        width={totalWidth} height={totalHeight}
        fill="rgba(10,16,30,0.97)"
        stroke={border} strokeWidth={isActive ? 2.5 : 1.5}
        cornerRadius={CR}
        shadowColor="rgba(0,0,0,0.45)" shadowBlur={14} shadowOffsetY={3}
      />

      <Group name="content-bounds">

        {/* ── Header tint ── */}
        <Rect
          width={totalWidth} height={HEADER_HEIGHT}
          fill={scheme.bg}
          cornerRadius={[CR, CR, 0, 0]}
        />

        {/* ── Left accent stripe ── */}
        <Rect
          x={0} y={0} width={5} height={HEADER_HEIGHT}
          fill={scheme.primary}
          cornerRadius={[CR, 0, 0, 0]}
          shadowColor={scheme.glow} shadowBlur={10}
        />

        {/* ══════════════════════════════════════════════════
            ROW 1 — badge + skip + counter
            ══════════════════════════════════════════════════ */}

        {/* Type badge */}
        <Group x={PADDING} y={R_BADGE}>
          <Rect width={124} height={28} fill={scheme.primary} cornerRadius={14} opacity={0.22} />
          <Text
            text={`${ICON[loopType] ?? '🔄'} ${loopType.toUpperCase()}`}
            x={10} y={6}
            fontSize={13} fontStyle="bold"
            fill={scheme.light} fontFamily={SANS}
          />
        </Group>

        {/* Active dot */}
        {isActive && (
          <Circle x={totalWidth - 16} y={R_BADGE + 14} radius={6}
            fill={P.active.primary} shadowColor={P.active.primary} shadowBlur={14} />
        )}

        {/* Skip */}
        {onSkip && (
          <Group
            x={totalWidth - (totalIterations !== undefined ? 202 : 112)} y={R_BADGE}
            onClick={e => { (e as any).cancelBubble = true; onSkip(); }}
            onMouseEnter={e => { const c = e.target.getStage()?.container(); if (c) c.style.cursor = 'pointer'; }}
            onMouseLeave={e => { const c = e.target.getStage()?.container(); if (c) c.style.cursor = 'default'; }}
          >
            <Rect width={84} height={28} fill="rgba(240,84,90,0.12)" stroke="rgba(240,84,90,0.45)" strokeWidth={1} cornerRadius={8} />
            <Text text="⏩ SKIP" x={12} y={6} fontSize={12} fontStyle="bold" fill={COND_FALSE_PRIMARY} fontFamily={SANS} />
          </Group>
        )}

        {/* Iteration counter */}
        {totalIterations !== undefined && (
          <Group x={totalWidth - 106} y={R_BADGE}>
            <Rect width={90} height={28} fill="rgba(15,28,52,0.85)" stroke={scheme.primary} strokeWidth={1.5} cornerRadius={14} />
            <Text
              text={`${currentIteration} / ${totalIterations}`}
              width={90} y={7}
              fontSize={11} fontStyle="bold"
              fill={scheme.light} align="center" fontFamily={MONO}
            />
          </Group>
        )}

        {/* ══════════════════════════════════════════════════
            FOR-LOOP ONLY — init chip above CONDITION capsule
            ══════════════════════════════════════════════════ */}
        {loopType === 'for' && initialization && (
          <Group x={PADDING} y={R_INIT}>
            <Rect
              width={Math.min(220, initialization.length * 7.5 + 28)} height={18}
              fill="rgba(12,22,40,0.75)" stroke="rgba(100,116,139,0.18)" strokeWidth={1} cornerRadius={5}
            />
            <Text text={`init  ${initialization}`} x={9} y={3}
              fontSize={10} fill="#4A6080" fontFamily={MONO} />
          </Group>
        )}

        {/* ══════════════════════════════════════════════════
            CONDITION CAPSULE — big, animates green / red
            ══════════════════════════════════════════════════ */}
        {condition && (
          <Group x={PADDING} y={R_COND}>

            {/* Animated background */}
            <Rect
              ref={condBgRef}
              width={capsuleW} height={CAPSULE_H}
              fill="rgba(15,25,45,0.70)"
              stroke="rgba(100,116,139,0.22)"
              strokeWidth={1.5}
              cornerRadius={CAPSULE_R}
              shadowColor="transparent" shadowBlur={0}
              opacity={0.65}
            />

            {/* Left coloured tag */}
            <Rect
              x={0} y={0} width={78} height={CAPSULE_H}
              fill={isConditionStep
                ? (conditionResult ? COND_TRUE_BG : COND_FALSE_BG)
                : 'rgba(255,255,255,0.04)'}
              cornerRadius={[CAPSULE_R, 0, 0, CAPSULE_R]}
            />
            <Text
              text={loopType === 'do-while' ? 'DO-WHILE' : loopType === 'while' ? 'WHILE' : 'CONDITION'}
              x={0} y={9} width={78}
              fontSize={9} fontStyle="bold"
              fill={isConditionStep
                ? (conditionResult ? COND_TRUE_PRIMARY : COND_FALSE_PRIMARY)
                : '#3D5070'}
              align="center" fontFamily={SANS} letterSpacing={0.5}
            />

            {/* Condition expression — large, readable */}
            <Text
              text={condition}
              x={88} y={8}
              width={capsuleW - 116} height={CAPSULE_H}
              fontSize={14} fontStyle="bold"
              fill={isConditionStep
                ? (conditionResult ? COND_TRUE_PRIMARY : COND_FALSE_PRIMARY)
                : '#A8BECC'}
              fontFamily={MONO}
              ellipsis wrap="none"
            />

            {/* Result dot */}
            {isConditionStep && conditionResult !== undefined && (
              <Circle
                x={capsuleW - 14} y={CAPSULE_H / 2}
                radius={7}
                fill={conditionResult ? COND_TRUE_PRIMARY : COND_FALSE_PRIMARY}
                shadowColor={conditionResult ? COND_TRUE_GLOW : COND_FALSE_GLOW}
                shadowBlur={14} shadowOpacity={1}
              />
            )}
          </Group>
        )}

        {/* ══════════════════════════════════════════════════
            UPDATE CAPSULE — for-loop, animates amber
            ══════════════════════════════════════════════════ */}
        {loopType === 'for' && update && (
          <Group x={PADDING} y={R_UPD}>

            {/* Animated background */}
            <Rect
              ref={updBgRef}
              width={capsuleW} height={CAPSULE_H}
              fill="rgba(15,25,45,0.70)"
              stroke="rgba(100,116,139,0.22)"
              strokeWidth={1.5}
              cornerRadius={CAPSULE_R}
              shadowColor="transparent" shadowBlur={0}
              opacity={0.65}
            />

            {/* Left coloured tag */}
            <Rect
              x={0} y={0} width={64} height={CAPSULE_H}
              fill={hasUpd ? UPD_BG : 'rgba(255,255,255,0.04)'}
              cornerRadius={[CAPSULE_R, 0, 0, CAPSULE_R]}
            />
            <Text
              text="UPDATE"
              x={0} y={9} width={64}
              fontSize={9} fontStyle="bold"
              fill={hasUpd ? UPD_PRIMARY : '#3D5070'}
              align="center" fontFamily={SANS} letterSpacing={0.5}
            />

            {/* Idle: show update expression */}
            {!hasUpd && (
              <Text
                text={update}
                x={74} y={8}
                fontSize={14} fontStyle="bold"
                fill="#5A7A9A" fontFamily={MONO}
              />
            )}

            {/* Active: show var chips */}
            {hasUpd && (
              <Group x={74} y={6}>
                {entries.map(({ name, oldVal, newVal, hasOld }, i) => {
                  const nW = Math.max(22, name.length   * 8 + 10);
                  const vW = Math.max(22, newVal.length * 8 + 10);
                  const oW = hasOld ? Math.max(22, oldVal.length * 8 + 10) : 0;
                  const aW = hasOld ? 18 : 0;
                  const chipW = nW + oW + aW + vW;
                  return (
                    <Group key={name} x={i * (chipW + 8)}>
                      {/* name */}
                      <Rect width={nW} height={20} fill="rgba(20,35,60,0.9)" stroke={`${UPD_PRIMARY}44`} strokeWidth={1} cornerRadius={[4,0,0,4]} />
                      <Text text={name} x={5} y={4} fontSize={10} fontStyle="bold" fill="#FCD34D" fontFamily={MONO} />
                      {/* old */}
                      {hasOld && <>
                        <Rect x={nW} width={oW} height={20} fill="rgba(240,84,90,0.12)" stroke="rgba(240,84,90,0.25)" strokeWidth={1} />
                        <Text text={oldVal} x={nW + 4} y={4} fontSize={10} fill="rgba(240,84,90,0.7)" fontFamily={MONO} />
                        <Text text="→" x={nW + oW + 3} y={4} fontSize={10} fill="#334155" fontFamily={MONO} />
                      </>}
                      {/* new */}
                      <Rect x={nW + oW + aW} width={vW} height={20} fill={UPD_BG} stroke={`${UPD_PRIMARY}55`} strokeWidth={1} cornerRadius={[0,4,4,0]} />
                      <Text text={newVal} x={nW + oW + aW + 4} y={4} fontSize={10} fontStyle="bold" fill={UPD_PRIMARY} fontFamily={MONO} />
                    </Group>
                  );
                })}
              </Group>
            )}
          </Group>
        )}

        {/* ── Progress bar ── */}
        {totalIterations !== undefined && totalIterations > 0 && (
          <Group y={R_PROG}>
            <Rect x={0} width={totalWidth} height={4} fill="rgba(255,255,255,0.03)" />
            <Rect ref={progressRef} x={0} width={0} height={4} fill={scheme.primary}
              shadowColor={scheme.primary} shadowBlur={6} shadowOpacity={0.5} />
          </Group>
        )}

        {/* ── Divider ── */}
        <Line points={[0, HEADER_HEIGHT, totalWidth, HEADER_HEIGHT]} stroke="#172030" strokeWidth={1.5} />

        {/* ══════════════════════════════════════════════════
            BODY — children start BELOW header
            y offset here must equal LOOP_BODY_START_Y - HEADER_HEIGHT = 10
            The parent Group is already offset by HEADER_HEIGHT in getBodyOffsetY
            ══════════════════════════════════════════════════ */}
        <Group y={HEADER_HEIGHT + 10}>
          {children}
        </Group>

      </Group>

      {/* ── Footer badges ── */}

      {isConditionStep && conditionResult !== undefined && (
        <Group x={PADDING} y={totalHeight - 28}>
          <Rect
            width={conditionResult ? 116 : 128} height={22}
            fill={conditionResult ? 'rgba(16,212,124,0.12)' : 'rgba(240,84,90,0.12)'}
            stroke={conditionResult ? `${COND_TRUE_PRIMARY}44` : `${COND_FALSE_PRIMARY}44`}
            strokeWidth={1.5} cornerRadius={11}
          />
          <Text
            text={conditionResult ? '✓ CONTINUE' : '✗ EXIT LOOP'}
            width={conditionResult ? 116 : 128} y={5}
            fontSize={10} fontStyle="bold"
            fill={conditionResult ? '#34D399' : '#FCA5A5'}
            align="center" fontFamily={SANS}
          />
        </Group>
      )}

      {isComplete && (
        <Group x={totalWidth - 80} y={totalHeight - 28}>
          <Rect width={66} height={22} fill="rgba(100,116,139,0.18)" stroke="#334155" strokeWidth={1} cornerRadius={11} />
          <Text text="🏁 DONE" width={66} y={5} fontSize={10} fontStyle="bold" fill="#94A3B8" align="center" fontFamily={SANS} />
        </Group>
      )}

      {stepNumber !== undefined && (
        <Text text={`#${stepNumber}`} x={totalWidth - 38} y={totalHeight - 16} fontSize={9} fill="#283850" fontFamily={MONO} />
      )}

    </Group>
  );
});

LoopElement.displayName = 'LoopElement';
export default LoopElement;