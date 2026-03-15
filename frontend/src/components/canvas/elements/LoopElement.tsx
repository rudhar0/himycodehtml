// frontend/src/components/canvas/elements/LoopElement.tsx
//
// getBodyOffsetY in VisualizationCanvas.tsx must return:
//   case "loop": return subtype === "iteration" ? 25 : LOOP_BODY_START_Y
// where LOOP_BODY_START_Y = HEADER_HEIGHT + 10 = 158

import React, { useRef, useEffect, useState, memo, useCallback } from 'react';
import { Group, Rect, Text, Line, Circle } from 'react-konva';
import Konva from 'konva';
import { resizeContainer } from '../utils/resizeContainer';

// ─────────────────────────────────────────────────────────────
// SYNC CONSTANT — import in VisualizationCanvas getBodyOffsetY
// case "loop": return subtype === "iteration" ? 25 : LOOP_BODY_START_Y
// ─────────────────────────────────────────────────────────────
export const LOOP_BODY_START_Y = 158;

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
  // { varName: newVal }  OR  { varName: { old, new } }
  updateValues?: Record<string, any>;

  // Always-live current values for loop vars (shown in init capsule)
  // Populated by LayoutEngine.data.loopVarCurrentValues
  loopVarCurrentValues?: Record<string, any>;

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
const HEADER_HEIGHT  = 148;
const PADDING        = 16;
const CR             = 10;
const CAPSULE_H      = 32;
const CAPSULE_R      = 8;

// Absolute Y positions inside header
const R_BADGE  = 10;   // row 1: type badge + skip + counter
const R_INIT   = 48;   // row 2: INIT capsule
const R_COND   = 86;   // row 3: CONDITION capsule
const R_UPD    = 118;  // row 4: UPDATE capsule  (for-loop only, fits under 148)
const R_PROG   = 144;  // progress bar

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

// Condition colours — always bright green / red, never the loop colour
const C_TRUE_FILL   = 'rgba(16,212,124,0.16)';
const C_TRUE_STROKE = '#10D47C';
const C_TRUE_GLOW   = '#10D47C';
const C_FALSE_FILL  = 'rgba(240,84,90,0.16)';
const C_FALSE_STROKE = '#F0545A';
const C_FALSE_GLOW  = '#F0545A';

// Update colour — amber
const U_FILL   = 'rgba(245,158,11,0.16)';
const U_STROKE = '#F59E0B';
const U_GLOW   = '#F59E0B';

// Neutral capsule defaults
const N_FILL   = 'rgba(14,22,40,0.70)';
const N_STROKE = 'rgba(100,116,139,0.22)';

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
// Use setAttr() for immediate colour changes — NOT the getter/setter methods.
// rect.fill('x') in Konva returns 'x' (getter) on some versions, use setAttr instead.
// ─────────────────────────────────────────────────────────────

function setCapsuleActive(
  rect: Konva.Rect,
  fillColor: string,
  strokeColor: string,
  glowColor: string,
) {
  if (!rect.getLayer()) return;
  rect.setAttr('fill',        fillColor);
  rect.setAttr('stroke',      strokeColor);
  rect.setAttr('shadowColor', glowColor);
  rect.getLayer()!.batchDraw();
}

function setCapsuleNeutral(rect: Konva.Rect) {
  if (!rect.getLayer()) return;
  rect.setAttr('fill',        N_FILL);
  rect.setAttr('stroke',      N_STROKE);
  rect.setAttr('shadowColor', 'transparent');
  rect.getLayer()!.batchDraw();
}

/**
 * Double-pulse glow: ramp up → dip → ramp up → slow hold
 * Total ≈ 1.5 s — long enough for the user to read the result.
 */
function runPulse(rect: Konva.Rect, glowColor: string) {
  if (!rect.getLayer()) return;
  rect.setAttr('shadowColor', glowColor);
  rect.getLayer()!.batchDraw();

  rect.to({
    shadowBlur: 32, opacity: 1, duration: 0.3,
    onFinish: () => {
      if (!rect.getLayer()) return;
      rect.to({
        shadowBlur: 8, opacity: 0.78, duration: 0.3,
        onFinish: () => {
          if (!rect.getLayer()) return;
          rect.to({
            shadowBlur: 26, opacity: 1, duration: 0.28,
            onFinish: () => {
              if (!rect.getLayer()) return;
              rect.to({ shadowBlur: 16, opacity: 0.92, duration: 0.6 });
            },
          });
        },
      });
    },
  });
}

function fadeOutCapsule(rect: Konva.Rect) {
  if (!rect.getLayer()) return;
  rect.to({
    shadowBlur: 0, opacity: 0.65, duration: 0.5,
    onFinish: () => setCapsuleNeutral(rect),
  });
}

/**
 * Enhanced condition pulse: dramatic color shift and longer duration
 */
function runConditionPulse(
  rect: Konva.Rect,
  fillColor: string,
  strokeColor: string,
  glowColor: string
) {
  if (!rect.getLayer()) return;
  
  rect.setAttr('fill', fillColor);
  rect.setAttr('stroke', strokeColor);
  rect.setAttr('shadowColor', glowColor);

  rect.to({
    shadowBlur: 45,
    opacity: 1,
    duration: 0.4,
    easing: Konva.Easings.EaseIn,
    onFinish: () => {
      if (!rect.getLayer()) return;
      rect.to({
        shadowBlur: 15,
        opacity: 0.85,
        duration: 0.4,
        onFinish: () => {
          if (!rect.getLayer()) return;
          rect.to({
            shadowBlur: 35,
            opacity: 1,
            duration: 0.4,
            onFinish: () => {
              if (!rect.getLayer()) return;
              rect.to({
                shadowBlur: 20,
                opacity: 0.95,
                duration: 0.8,
              });
            }
          });
        }
      });
    }
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
  loopVarCurrentValues = {},
  isNew = false, stepNumber, enterDelay = 0,
  children, onSkip,
}) => {
  if (isConditionStep) {
    console.log(`[LoopElement] Render ID=${id} step=${stepNumber} isConditionStep=${isConditionStep} res=${conditionResult}`);
  }

  const groupRef    = useRef<Konva.Group>(null);
  const glowRef     = useRef<Konva.Rect>(null);
  const progressRef = useRef<Konva.Rect>(null);

  // Capsule background refs
  const condBgRef = useRef<Konva.Rect>(null);
  const updBgRef  = useRef<Konva.Rect>(null);
  const initBgRef = useRef<Konva.Rect>(null);

  // Condition animation: dot + result text
  const condDotRef  = useRef<Konva.Circle>(null);
  const condTextRef = useRef<Konva.Text>(null);

  const tweenRef  = useRef<Konva.Tween | null>(null);
  const mountRef  = useRef(true);

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

  // Live init values to show in capsule
  const liveVarEntries = Object.entries(loopVarCurrentValues);
  const hasLiveVars    = liveVarEntries.length > 0;

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

  // ── CONDITION CAPSULE ANIMATION ─────────────────────────────
  // Uses setAttr to change colour instantly, then double-pulse glow.
  // Dot slides in from left. Result text fades in on the right.
  useEffect(() => {
    const bg   = condBgRef.current;
    const dot  = condDotRef.current;
    const txt  = condTextRef.current;
    
    if (isConditionStep) {
        console.log(`[LoopElement Effect] TRIGGER ID=${id} step=${stepNumber} isConditionStep=${isConditionStep} res=${conditionResult} bgFound=${!!bg}`);
    }
    
    if (!bg?.getLayer()) return;

    if (isConditionStep) {
      const fill   = conditionResult ? C_TRUE_FILL   : C_FALSE_FILL;
      const stroke = conditionResult ? C_TRUE_STROKE  : C_FALSE_STROKE;
      const glow   = conditionResult ? C_TRUE_GLOW    : C_FALSE_GLOW;

      // Scanning phase: neutral bright glow first
      bg.setAttr('shadowColor', '#FFFFFF');
      bg.setAttr('shadowBlur', 40);
      bg.getLayer()?.batchDraw();

      runConditionPulse(bg, fill, stroke, glow);

      // Animate dot sliding in from far left
      if (dot?.getLayer()) {
        dot.setAttr('fill', '#FFFFFF'); // Bright white scanning dot
        dot.setAttr('shadowColor', '#FFFFFF');
        dot.x(88); // Start at expression area
        dot.opacity(0);
        dot.to({
          x: capsuleW - 100,
          opacity: 1,
          duration: 0.6,
          easing: Konva.Easings.EaseInOut,
          onFinish: () => {
            if (!dot.getLayer()) return;
            dot.setAttr('fill', glow);
            dot.setAttr('shadowColor', glow);
            dot.to({ opacity: 0, duration: 0.4, delay: 0.8 });
          }
        });
      }

      // Fade in and bounce result text on right
      if (txt?.getLayer()) {
        txt.setAttr('text', conditionResult ? 'TRUE ✓' : 'FALSE ✗');
        txt.setAttr('fill', glow);
        txt.opacity(0);
        txt.scale({ x: 0.5, y: 0.5 });
        txt.to({
          opacity: 1,
          duration: 0.4,
          scaleX: 1.1,
          scaleY: 1.1,
          delay: 0.5,
          easing: Konva.Easings.BackEaseOut,
          onFinish: () => {
             if (txt.getLayer()) {
                txt.to({ scaleX: 1, scaleY: 1, duration: 0.2 });
             }
          }
        });
      }

    } else {
      fadeOutCapsule(bg);

      // Hide dot and text
      if (dot?.getLayer()) dot.to({ opacity: 0, duration: 0.3 });
      if (txt?.getLayer()) txt.to({ opacity: 0, duration: 0.3 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConditionStep, conditionResult, stepNumber]); // Trigger on stepNumber change to re-fire animations reliably

  // ── UPDATE CAPSULE ANIMATION ────────────────────────────────
  useEffect(() => {
    const bg = updBgRef.current;
    if (!bg?.getLayer()) return;

    if (hasUpd) {
      setCapsuleActive(bg, U_FILL, U_STROKE, U_GLOW);
      runPulse(bg, U_GLOW);
    } else {
      fadeOutCapsule(bg);
    }
  }, [hasUpd]);

  // ── INIT CAPSULE — live var update flash ────────────────────
  useEffect(() => {
    const bg = initBgRef.current;
    if (!bg?.getLayer()) return;

    if (hasLiveVars && currentIteration > 0) {
      // Briefly flash the init capsule in the loop colour to show the var updated
      setCapsuleActive(bg, `${scheme.primary}20`, scheme.primary, scheme.primary);
      bg.to({
        shadowBlur: 18, opacity: 1, duration: 0.25,
        onFinish: () => {
          if (!bg.getLayer()) return;
          bg.to({ shadowBlur: 6, opacity: 0.85, duration: 0.8 });
        },
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(loopVarCurrentValues), currentIteration]);

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
      isUpdateStep, updateValues, loopVarCurrentValues,
      currentIteration, totalIterations, isActive, isComplete]);

  // ──────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────
  return (
    <Group ref={groupRef} id={id} x={x} y={y} name="auto-resize">

      {/* Glow halo */}
      <Rect
        ref={glowRef} name="glow-bg"
        x={-5} y={-5} width={totalWidth + 10} height={totalHeight + 10}
        fill="transparent" cornerRadius={CR + 3}
        shadowColor={isActive ? P.active.glow : scheme.glow}
        shadowBlur={16} shadowOpacity={0.7} opacity={0}
      />

      {/* Card shell */}
      <Rect
        name="main-bg"
        width={totalWidth} height={totalHeight}
        fill="rgba(10,16,30,0.97)"
        stroke={border} strokeWidth={isActive ? 2.5 : 1.5}
        cornerRadius={CR}
        shadowColor="rgba(0,0,0,0.45)" shadowBlur={14} shadowOffsetY={3}
      />

      <Group name="content-bounds">

        {/* Header tint */}
        <Rect
          width={totalWidth} height={HEADER_HEIGHT}
          fill={scheme.bg} cornerRadius={[CR, CR, 0, 0]}
        />

        {/* Left accent stripe */}
        <Rect
          x={0} y={0} width={5} height={HEADER_HEIGHT}
          fill={scheme.primary}
          cornerRadius={[CR, 0, 0, 0]}
          shadowColor={scheme.glow} shadowBlur={10}
        />

        {/* ══ ROW 1 — badge + skip + counter ═══════════════════ */}

        <Group x={PADDING} y={R_BADGE}>
          <Rect width={124} height={28} fill={scheme.primary} cornerRadius={14} opacity={0.22} />
          <Text
            text={`${ICON[loopType] ?? '🔄'} ${loopType.toUpperCase()}`}
            x={10} y={6}
            fontSize={13} fontStyle="bold"
            fill={scheme.light} fontFamily={SANS}
          />
        </Group>

        {isActive && (
          <Circle x={totalWidth - 16} y={R_BADGE + 14} radius={6}
            fill={P.active.primary} shadowColor={P.active.primary} shadowBlur={14} />
        )}

        {onSkip && (
          <Group
            x={totalWidth - (totalIterations !== undefined ? 202 : 112)} y={R_BADGE}
            onClick={e => { (e as any).cancelBubble = true; onSkip(); }}
            onMouseEnter={e => { const c = e.target.getStage()?.container(); if (c) c.style.cursor = 'pointer'; }}
            onMouseLeave={e => { const c = e.target.getStage()?.container(); if (c) c.style.cursor = 'default'; }}
          >
            <Rect width={84} height={28} fill="rgba(240,84,90,0.12)" stroke="rgba(240,84,90,0.45)" strokeWidth={1} cornerRadius={8} />
            <Text text="⏩ SKIP" x={12} y={6} fontSize={12} fontStyle="bold" fill={C_FALSE_STROKE} fontFamily={SANS} />
          </Group>
        )}

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

        {/* ══ ROW 2 — INIT capsule (live values) ════════════════ */}
        <Group x={PADDING} y={R_INIT}>
          {/* Animated background */}
          <Rect
            ref={initBgRef}
            width={capsuleW} height={CAPSULE_H}
            fill={N_FILL} stroke={N_STROKE}
            strokeWidth={1.5} cornerRadius={CAPSULE_R}
            shadowColor="transparent" shadowBlur={0}
            opacity={0.7}
          />

          {/* Left tag */}
          <Rect
            x={0} y={0} width={50} height={CAPSULE_H}
            fill={`${scheme.primary}18`}
            cornerRadius={[CAPSULE_R, 0, 0, CAPSULE_R]}
          />
          <Text
            text="INIT"
            x={0} y={10} width={50}
            fontSize={9} fontStyle="bold"
            fill={scheme.light}
            align="center" fontFamily={SANS} letterSpacing={0.5}
          />

          {/* Static initialization expression */}
          {initialization && !hasLiveVars && (
            <Text
              text={initialization}
              x={60} y={9}
              fontSize={13} fontStyle="bold"
              fill="#6B8DAA" fontFamily={MONO}
            />
          )}

          {/* Live var value capsules */}
          {hasLiveVars && (() => {
            // Build chips with overflow guard — stop rendering when cumulative
            // x would exceed the capsule content area (leave 12 px right margin).
            // TAG_WIDTH = 60 (left tag) + 4 (gap before first chip)
            const TAG_WIDTH = 64;
            const MAX_X = capsuleW - 12;
            let cursorX = TAG_WIDTH;
            const visible: Array<{ name: string; val: any; ox: number; nW: number; vW: number }> = [];
            let overflow = 0;

            for (const [name, val] of liveVarEntries) {
              const nW = Math.max(24, name.length * 8.5 + 12);
              const vW = Math.max(28, String(val).length * 8.5 + 12);
              const chipW = nW + vW + 8; // 8 = gap between chips
              if (cursorX + chipW > MAX_X) { overflow++; continue; }
              visible.push({ name, val, ox: cursorX, nW, vW });
              cursorX += chipW;
            }

            return (
              <>
                {visible.map(({ name, val, ox, nW, vW }) => (
                  <Group key={name} x={ox}>
                    {/* var name */}
                    <Rect width={nW} height={22} fill="rgba(18,32,56,0.9)" stroke={`${scheme.primary}44`} strokeWidth={1} cornerRadius={[4,0,0,4]} />
                    <Text text={name} x={5} y={5} fontSize={10} fontStyle="bold" fill={scheme.light} fontFamily={MONO} />
                    {/* current value */}
                    <Rect x={nW} width={vW} height={22} fill={`${scheme.primary}20`} stroke={`${scheme.primary}55`} strokeWidth={1} cornerRadius={[0,4,4,0]} />
                    <Text text={String(val)} x={nW + 5} y={5} fontSize={10} fontStyle="bold" fill={scheme.light} fontFamily={MONO} />
                  </Group>
                ))}
                {overflow > 0 && (
                  <Group x={cursorX}>
                    <Rect width={32} height={22} fill="rgba(255,255,255,0.06)" stroke="rgba(100,116,139,0.25)" strokeWidth={1} cornerRadius={4} />
                    <Text text={`+${overflow}`} x={4} y={5} fontSize={9} fill="#64748B" fontFamily={MONO} />
                  </Group>
                )}
              </>
            );
          })()}
        </Group>

        {/* ══ ROW 3 — CONDITION capsule with sliding dot + result text ══ */}
        {condition !== undefined && (
          <Group x={PADDING} y={R_COND}>

            {/* Animated background */}
            <Rect
              ref={condBgRef}
              width={capsuleW} height={CAPSULE_H}
              fill={N_FILL} stroke={N_STROKE}
              strokeWidth={1.5} cornerRadius={CAPSULE_R}
              shadowColor="transparent" shadowBlur={0}
              opacity={0.65}
            />

            {/* Left tag */}
            <Rect
              x={0} y={0} width={78} height={CAPSULE_H}
              fill={isConditionStep
                ? (conditionResult ? 'rgba(16,212,124,0.18)' : 'rgba(240,84,90,0.18)')
                : 'rgba(255,255,255,0.04)'}
              cornerRadius={[CAPSULE_R, 0, 0, CAPSULE_R]}
            />
            <Text
              text={loopType === 'do-while' ? 'DO-WHILE' : loopType === 'while' ? 'WHILE' : 'CONDITION'}
              x={0} y={10} width={78}
              fontSize={9} fontStyle="bold"
              fill={isConditionStep
                ? (conditionResult ? C_TRUE_STROKE : C_FALSE_STROKE)
                : '#3D5070'}
              align="center" fontFamily={SANS} letterSpacing={0.5}
            />

            {/* Condition expression — big, readable */}
            <Text
              text={condition || '...'}
              x={88} y={8}
              width={capsuleW - 180}
              fontSize={14} fontStyle="bold"
              fill={isConditionStep
                ? (conditionResult ? C_TRUE_STROKE : C_FALSE_STROKE)
                : '#A8BECC'}
              fontFamily={MONO} ellipsis wrap="none"
            />

            {/* Result label — "TRUE ✓" or "FALSE ✗", fades in */}
            <Text
              ref={condTextRef}
              text=""
              x={capsuleW - 82} y={9}
              width={66}
              fontSize={11} fontStyle="bold"
              fill={conditionResult ? C_TRUE_STROKE : C_FALSE_STROKE}
              align="center" fontFamily={SANS}
              opacity={0}
            />

            {/* Sliding dot — starts off-screen left, slides to right */}
            <Circle
              ref={condDotRef}
              x={8} y={CAPSULE_H / 2}
              radius={6}
              fill={conditionResult ? C_TRUE_STROKE : C_FALSE_STROKE}
              shadowColor={conditionResult ? C_TRUE_GLOW : C_FALSE_GLOW}
              shadowBlur={10}
              opacity={0}
            />
          </Group>
        )}

        {/* ══ ROW 4 — UPDATE capsule (for-loop only) ════════════ */}
        {loopType === 'for' && update && (
          <Group x={PADDING} y={R_UPD}>

            <Rect
              ref={updBgRef}
              width={capsuleW} height={CAPSULE_H}
              fill={N_FILL} stroke={N_STROKE}
              strokeWidth={1.5} cornerRadius={CAPSULE_R}
              shadowColor="transparent" shadowBlur={0}
              opacity={0.65}
            />

            {/* Left tag */}
            <Rect
              x={0} y={0} width={64} height={CAPSULE_H}
              fill={hasUpd ? U_FILL : 'rgba(255,255,255,0.04)'}
              cornerRadius={[CAPSULE_R, 0, 0, CAPSULE_R]}
            />
            <Text
              text="UPDATE"
              x={0} y={10} width={64}
              fontSize={9} fontStyle="bold"
              fill={hasUpd ? U_STROKE : '#3D5070'}
              align="center" fontFamily={SANS} letterSpacing={0.5}
            />

            {/* Static expression when idle */}
            {!hasUpd && (
              <Text
                text={update}
                x={74} y={8}
                fontSize={14} fontStyle="bold"
                fill="#5A7A9A" fontFamily={MONO}
              />
            )}

            {/* Live chips when active */}
            {hasUpd && (() => {
              // Overflow guard — same logic as INIT capsule.
              // TAG_WIDTH = 64 (left tag) + 10 (gap to first chip)
              const TAG_WIDTH = 74;
              const MAX_X = capsuleW - 12;
              let cursorX = 0; // relative to the Group x={74} below
              const MAX_REL = MAX_X - TAG_WIDTH;
              const visible: Array<{ name: string; oldVal: string; newVal: string; hasOld: boolean; ox: number; nW: number; vW: number; oW: number; aW: number }> = [];
              let overflow = 0;

              for (const { name, oldVal, newVal, hasOld } of entries) {
                const nW = Math.max(22, name.length   * 8.5 + 10);
                const vW = Math.max(22, newVal.length * 8.5 + 10);
                const oW = hasOld ? Math.max(22, oldVal.length * 8.5 + 10) : 0;
                const aW = hasOld ? 18 : 0;
                const chipW = nW + oW + aW + vW + 8;
                if (cursorX + chipW > MAX_REL) { overflow++; continue; }
                visible.push({ name, oldVal, newVal, hasOld, ox: cursorX, nW, vW, oW, aW });
                cursorX += chipW;
              }

              return (
                <Group x={74} y={5}>
                  {visible.map(({ name, oldVal, newVal, hasOld, ox, nW, vW, oW, aW }) => (
                    <Group key={name} x={ox}>
                      <Rect width={nW} height={22} fill="rgba(20,35,60,0.9)" stroke={`${U_STROKE}44`} strokeWidth={1} cornerRadius={[4,0,0,4]} />
                      <Text text={name} x={5} y={4} fontSize={10} fontStyle="bold" fill="#FCD34D" fontFamily={MONO} />
                      {hasOld && <>
                        <Rect x={nW} width={oW} height={22} fill="rgba(240,84,90,0.12)" stroke="rgba(240,84,90,0.25)" strokeWidth={1} />
                        <Text text={oldVal} x={nW + 4} y={4} fontSize={10} fill="rgba(240,84,90,0.7)" fontFamily={MONO} />
                        <Text text="→" x={nW + oW + 3} y={4} fontSize={10} fill="#334155" fontFamily={MONO} />
                      </>}
                      <Rect x={nW + oW + aW} width={vW} height={22} fill={U_FILL} stroke={`${U_STROKE}55`} strokeWidth={1} cornerRadius={[0,4,4,0]} />
                      <Text text={newVal} x={nW + oW + aW + 4} y={4} fontSize={10} fontStyle="bold" fill={U_STROKE} fontFamily={MONO} />
                    </Group>
                  ))}
                  {overflow > 0 && (
                    <Group x={cursorX}>
                      <Rect width={32} height={22} fill="rgba(255,255,255,0.06)" stroke="rgba(100,116,139,0.25)" strokeWidth={1} cornerRadius={4} />
                      <Text text={`+${overflow}`} x={4} y={5} fontSize={9} fill="#64748B" fontFamily={MONO} />
                    </Group>
                  )}
                </Group>
              );
            })()}
          </Group>
        )}

        {/* Progress bar */}
        {totalIterations !== undefined && totalIterations > 0 && (
          <Group y={R_PROG}>
            <Rect x={0} width={totalWidth} height={4} fill="rgba(255,255,255,0.03)" />
            <Rect
              ref={progressRef}
              x={0} width={0} height={4}
              fill={scheme.primary}
              shadowColor={scheme.primary} shadowBlur={6} shadowOpacity={0.5}
            />
          </Group>
        )}

        {/* Divider */}
        <Line
          points={[0, HEADER_HEIGHT, totalWidth, HEADER_HEIGHT]}
          stroke="#172030" strokeWidth={1.5}
        />

        {/* Body — HEADER_HEIGHT + 10 gap */}
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
            stroke={conditionResult ? `${C_TRUE_STROKE}44` : `${C_FALSE_STROKE}44`}
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
        <Text
          text={`#${stepNumber}`}
          x={totalWidth - 38} y={totalHeight - 16}
          fontSize={9} fill="#283850" fontFamily={MONO}
        />
      )}

    </Group>
  );
});

LoopElement.displayName = 'LoopElement';
export default LoopElement;