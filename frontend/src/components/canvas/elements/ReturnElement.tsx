import React, { memo, useEffect, useMemo, useRef } from "react";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import Konva from "konva";
import gsap from "gsap";
import {
  SUB_BODY_MIN_H,
  SUB_H,
  SUB_HEADER_H,
  SUB_HINT_H,
  SUB_PAD,
  SUB_RADIUS,
  SUB_W,
} from "../../../theme/elementThemeSizing";
import { clampText, getCssVar, isDarkTheme } from "../utils/cssVars";
import { useThemeStore } from "../../../store/slices/themeSlice";


export interface ReturnElementProps {
  id: string;
  x: number;
  y: number;
  returnValue?: any;
  functionName: string;
  frameId: string;
  isNew?: boolean;
  stepNumber?: number;
  enterDelay?: number;
  isActive?: boolean;
}

const inferType = (val: any): string => {
  if (val === null || val === undefined) return "void";
  if (typeof val === "number") return "int";
  if (typeof val === "boolean") return "bool";
  if (typeof val === "string") return "string";
  return "value";
};

export const ReturnElement: React.FC<ReturnElementProps> = memo(
  ({
    id,
    x,
    y,
    returnValue,
    functionName,
    frameId,
    isNew = false,
    stepNumber,
    enterDelay = 0,
    isActive = false,
  }) => {
    const { theme } = useThemeStore();
    const dark = theme === 'dark';
    const groupRef = useRef<Konva.Group>(null);

    const outlineRef = useRef<Konva.Rect>(null);
    const beamRef = useRef<Konva.Rect>(null);
    const chipClipRef = useRef<Konva.Group>(null);
    const chipTextRef = useRef<Konva.Text>(null);
    const cursorRef = useRef<Konva.Rect>(null);


    const tokens = useMemo(() => {
      return {
        header: getCssVar("--ret-hdr", dark ? "#7F1D1D" : "#B91C1C"),
        body: getCssVar("--ret-body", dark ? "#150909" : "#FFF5F5"),
        border: getCssVar(
          "--ret-border",
          dark ? "rgba(248,113,113,0.4)" : "rgba(185,28,28,0.3)",
        ),
        glow: getCssVar(
          "--ret-glow",
          dark ? "rgba(248,113,113,0.12)" : "rgba(185,28,28,0.07)",
        ),
        accent: getCssVar("--ret-accent", dark ? "#F87171" : "#DC2626"),
        text: getCssVar("--ret-text", dark ? "#FECACA" : "#7F1D1D"),
        chipBg: getCssVar(
          "--ret-chip-bg",
          dark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.04)",
        ),
        chipBd: getCssVar(
          "--ret-chip-bd",
          dark ? "rgba(248,113,113,0.4)" : "rgba(185,28,28,0.3)",
        ),
        okBg: getCssVar("--ret-ok-bg", "rgba(34,197,94,0.1)"),
        okBd: getCssVar("--ret-ok-bd", "rgba(34,197,94,0.25)"),
        okTx: getCssVar("--ret-ok-tx", dark ? "#22C55E" : "#16A34A"),
        errBg: getCssVar("--ret-err-bg", "rgba(248,113,113,0.1)"),
        errBd: getCssVar("--ret-err-bd", "rgba(248,113,113,0.25)"),
        errTx: getCssVar("--ret-err-tx", dark ? "#F87171" : "#DC2626"),
        beam: getCssVar("--ret-beam", "rgba(248,113,113,0.06)"),
        sep: getCssVar(
          "--sep",
          dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
        ),
        badgeBg: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
        badgeText: dark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.45)",
      };
    }, [dark]);

    const hasValue = returnValue !== undefined && returnValue !== null;
    const displayValue = clampText(hasValue ? String(returnValue) : "void", 18);
    const displayType = inferType(returnValue);

    const isMain = functionName?.toLowerCase() === "main";
    const exitCode = isMain ? Number(returnValue ?? 0) : null;
    const exitIsOk = exitCode === 0;

    const hint = isMain
      ? `Returns to OS — exit ${Number.isFinite(exitCode) ? exitCode : 0}`
      : `Returns to ${frameId.split("-")[0] || "caller"}`;

    // Entrance: slide-in + fade
    useEffect(() => {
      const group = groupRef.current;
      if (!group) return;

      group.opacity(1);
      group.x(x);
      group.y(y);

      if (!isNew) return;

      group.opacity(0);
      group.x(x - 12);

      let tween: Konva.Tween | null = null;
      const play = () => {
        if (!group.getLayer()) return;
        tween = new Konva.Tween({
          node: group,
          opacity: 1,
          x,
          duration: 0.4,
          easing: Konva.Easings.EaseOut,
        });
        tween.play();
      };

      if (enterDelay > 0) {
        const t = setTimeout(play, enterDelay);
        return () => {
          clearTimeout(t);
          try {
            tween?.destroy();
          } catch {
            // ignore
          }
        };
      }

      play();
      return () => {
        try {
          tween?.destroy();
        } catch {
          // ignore
        }
      };
    }, [enterDelay, isNew, x, y]);

    // Active effects: pulse + scan beam (+ optional chip typewriter)
    useEffect(() => {
      const group = groupRef.current;
      const outline = outlineRef.current;
      const beam = beamRef.current;
      const chipClip = chipClipRef.current;
      const chipText = chipTextRef.current;
      const cursor = cursorRef.current;
      if (!group || !outline || !beam || !chipClip || !chipText || !cursor)
        return;
      const layer = group.getLayer();
      if (!layer) return;

      beam.visible(false);
      cursor.visible(false);
      chipClip.clipWidth(chipText.getTextWidth() + 6);

      const draw = () => layer.batchDraw();

      let ticker: (() => void) | null = null;
      const tl = gsap.timeline({ paused: true });

      if (isActive) {
        beam.visible(true);
        cursor.visible(true);

        tl.to(
          outline,
          {
            shadowBlur: 18,
            shadowOpacity: 0.95,
            duration: 1,
            yoyo: true,
            repeat: -1,
            ease: "sine.inOut",
          },
          0,
        );

        tl.fromTo(
          beam,
          { x: -SUB_W * 0.55, opacity: 0 },
          {
            x: SUB_W * 1.15,
            opacity: 1,
            duration: 2,
            repeat: -1,
            ease: "sine.inOut",
          },
          0,
        );

        // Typewriter for return chip text (subtle)
        const tw = Math.min(chipText.getTextWidth() + 6, 140);
        chipClip.clipWidth(0);
        cursor.opacity(1);
        const o = { w: 0 };
        tl.to(
          o,
          {
            w: tw,
            duration: 0.55,
            ease: "steps(8)",
            onUpdate: () => {
              chipClip.clipWidth(o.w);
              cursor.x(chipClip.x() + o.w);
              draw();
            },
          },
          0.08,
        );
        tl.to(
          cursor,
          {
            opacity: 0,
            duration: 0.42,
            repeat: -1,
            yoyo: true,
            ease: "steps(1)",
          },
          0.75,
        );

        ticker = () => draw();
        gsap.ticker.add(ticker);
        tl.play(0);
      } else {
        outline.shadowBlur(12);
        outline.shadowOpacity(0.75);
        beam.visible(false);
        cursor.visible(false);
        chipClip.clipWidth(chipText.getTextWidth() + 6);
        draw();
      }

      return () => {
        tl.kill();
        if (ticker) gsap.ticker.remove(ticker);
        beam.visible(false);
        cursor.visible(false);
        draw();
      };
    }, [displayValue, isActive]);

    const chipW = Math.min(Math.max(34, displayValue.length * 10 + 16), 140);

    return (
      <Group ref={groupRef} id={id} x={x} y={y}>
        <Rect
          ref={outlineRef}
          width={SUB_W}
          height={SUB_H}
          cornerRadius={SUB_RADIUS}
          fill="transparent"
          stroke={tokens.border}
          strokeWidth={1}
          shadowColor={tokens.glow}
          shadowBlur={12}
          shadowOpacity={0.75}
        />

        <Rect
          x={0}
          y={0}
          width={SUB_W}
          height={SUB_HEADER_H}
          fill={tokens.header}
          cornerRadius={[SUB_RADIUS, SUB_RADIUS, 0, 0]}
        />
        <Rect
          x={0}
          y={SUB_HEADER_H}
          width={SUB_W}
          height={SUB_BODY_MIN_H + SUB_HINT_H}
          fill={tokens.body}
          cornerRadius={[0, 0, SUB_RADIUS, SUB_RADIUS]}
        />

        <Line
          points={[
            0,
            SUB_HEADER_H + SUB_BODY_MIN_H,
            SUB_W,
            SUB_HEADER_H + SUB_BODY_MIN_H,
          ]}
          stroke={tokens.sep}
          strokeWidth={1}
        />

        <Rect
          ref={beamRef}
          x={-SUB_W * 0.55}
          y={0}
          width={SUB_W * 0.55}
          height={SUB_H}
          opacity={0}
          listening={false}
          fillLinearGradientStartPoint={{ x: 0, y: 0 }}
          fillLinearGradientEndPoint={{ x: SUB_W * 0.55, y: 0 }}
          fillLinearGradientColorStops={[
            0,
            "rgba(0,0,0,0)",
            0.5,
            tokens.beam,
            1,
            "rgba(0,0,0,0)",
          ]}
        />

        {/* Header content */}
        <Circle
          x={SUB_PAD}
          y={SUB_HEADER_H / 2}
          radius={3}
          fill={tokens.accent}
          opacity={0.9}
        />
        <Text
          text="RETURNS"
          x={SUB_PAD + 10}
          y={8}
          fontSize={10}
          fontStyle="bold"
          fill={tokens.accent}
          letterSpacing={1}
          fontFamily="'JetBrains Mono', monospace"
        />

        {typeof stepNumber === "number" && (
          <Group x={SUB_W - 44} y={6}>
            <Rect
              width={38}
              height={16}
              cornerRadius={3}
              fill={tokens.badgeBg}
            />
            <Text
              text={`#${stepNumber}`}
              x={6}
              y={4}
              fontSize={9}
              fontStyle="bold"
              fill={tokens.badgeText}
              fontFamily="'JetBrains Mono', monospace"
            />
          </Group>
        )}

        {/* Body */}
        <Text
          text="RETURN VALUE"
          x={SUB_PAD}
          y={SUB_HEADER_H + 8}
          fontSize={10}
          fontStyle="bold"
          fill={tokens.accent}
          opacity={0.78}
          fontFamily="'JetBrains Mono', monospace"
        />

        {/* Value chip + type */}
        <Group x={SUB_PAD} y={SUB_HEADER_H + 26}>
          <Rect
            x={0}
            y={-4}
            width={chipW}
            height={26}
            cornerRadius={7}
            fill={tokens.chipBg}
            stroke={tokens.chipBd}
            strokeWidth={1}
          />

          <Group
            ref={chipClipRef}
            x={8}
            y={0}
            clipX={0}
            clipY={0}
            clipWidth={chipW - 16}
            clipHeight={18}
          >
            <Text
              ref={chipTextRef}
              text={displayValue}
              x={0}
              y={0}
              fontSize={14}
              fontStyle="bold"
              fill={tokens.text}
              fontFamily="'JetBrains Mono', monospace"
            />
          </Group>
          <Rect
            ref={cursorRef}
            x={8}
            y={0}
            width={2}
            height={16}
            fill={tokens.text}
            opacity={0}
            listening={false}
          />

          <Text
            text={displayType}
            x={chipW + 10}
            y={2}
            fontSize={9}
            fontStyle="italic"
            fill="rgba(148,163,184,0.9)"
            fontFamily="'JetBrains Mono', monospace"
          />

          {isMain && (
            <Group x={chipW + 52} y={-1}>
              <Rect
                width={46}
                height={18}
                cornerRadius={5}
                fill={exitIsOk ? tokens.okBg : tokens.errBg}
                stroke={exitIsOk ? tokens.okBd : tokens.errBd}
                strokeWidth={1}
              />
              <Text
                text={`exit ${Number.isFinite(exitCode) ? exitCode : 0}`}
                x={6}
                y={4}
                fontSize={9}
                fontStyle="bold"
                fill={exitIsOk ? tokens.okTx : tokens.errTx}
                fontFamily="'JetBrains Mono', monospace"
              />
            </Group>
          )}
        </Group>

        {/* Hint row */}
        <Text
          text={`↩ ${hint}`}
          x={SUB_PAD}
          y={SUB_HEADER_H + SUB_BODY_MIN_H + 8}
          fontSize={10}
          fill={tokens.accent}
          opacity={0.78}
          fontFamily="'JetBrains Mono', monospace"
        />
      </Group>
    );
  },
);

ReturnElement.displayName = "ReturnElement";

export default ReturnElement;
