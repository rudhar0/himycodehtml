import React, { useEffect, useMemo, useRef } from "react";
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


interface OutputElementProps {
  id: string;
  value: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isNew?: boolean;
  subtype?: "output_printf" | "output_cout" | "output_endl";
  explanation?: string;
  stepNumber?: number;
  enterDelay?: number;
  isActive?: boolean;
}

const outputLabelForSubtype = (
  subtype: OutputElementProps["subtype"],
): string => {
  if (subtype === "output_cout") return "cout";
  if (subtype === "output_endl") return "cout << endl";
  return "printf";
};

export const OutputElement: React.FC<OutputElementProps> = ({
  id,
  value,
  x,
  y,
  isNew = false,
  subtype = "output_printf",
  explanation,
  stepNumber,
  enterDelay = 0,
  isActive = false,
}) => {
  const { theme } = useThemeStore();
  const dark = theme === 'dark';
  const groupRef = useRef<Konva.Group>(null);

  const outlineRef = useRef<Konva.Rect>(null);
  const beamRef = useRef<Konva.Rect>(null);
  const valueClipRef = useRef<Konva.Group>(null);
  const valueTextRef = useRef<Konva.Text>(null);
  const cursorRef = useRef<Konva.Rect>(null);


  const tokens = useMemo(() => {
    return {
      header: getCssVar("--out-hdr", dark ? "#145228" : "#15803D"),
      body: getCssVar("--out-body", dark ? "#0A1B0E" : "#F0FDF4"),
      border: getCssVar(
        "--out-border",
        dark ? "rgba(34,197,94,0.4)" : "rgba(22,163,74,0.3)",
      ),
      glow: getCssVar(
        "--out-glow",
        dark ? "rgba(34,197,94,0.12)" : "rgba(22,163,74,0.07)",
      ),
      accent: getCssVar("--out-accent", dark ? "#22C55E" : "#16A34A"),
      text: getCssVar("--out-text", dark ? "#86EFAC" : "#14532D"),
      beam: getCssVar("--out-beam", "rgba(34,197,94,0.06)"),
      sep: getCssVar(
        "--sep",
        dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
      ),
      badgeBg: dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
      badgeText: dark ? "rgba(255,255,255,0.4)" : "rgba(0,0,0,0.45)",
    };
  }, [dark]);

  const label = outputLabelForSubtype(subtype);
  const hint = explanation ? `stdout → ${clampText(explanation, 42)}` : `stdout → ${clampText(value, 42)}`;
  const displayValue = clampText(value || "(empty)", 34);

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

  // Active effects: pulse + scan beam + typewriter
  useEffect(() => {
    const group = groupRef.current;
    const outline = outlineRef.current;
    const beam = beamRef.current;
    const valueClip = valueClipRef.current;
    const valueText = valueTextRef.current;
    const cursor = cursorRef.current;
    if (!group || !outline || !beam || !valueClip || !valueText || !cursor) return;
    const layer = group.getLayer();
    if (!layer) return;

    beam.visible(false);
    cursor.visible(false);
    valueClip.clipWidth(SUB_W - SUB_PAD * 2);

    const draw = () => layer.batchDraw();

    let ticker: (() => void) | null = null;
    const tl = gsap.timeline({ paused: true });

    if (isActive) {
      beam.visible(true);
      cursor.visible(true);

      // Pulse ring
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

      // Scan beam sweep
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

      // Typewriter: animate clip width + cursor blink
      const tw = Math.min(valueText.getTextWidth() + 4, SUB_W - SUB_PAD * 2);
      valueClip.clipWidth(0);
      cursor.opacity(1);
      cursor.x(SUB_PAD + tw);

      const o = { w: 0 };
      tl.to(
        o,
        {
          w: tw,
          duration: 0.7,
          ease: "steps(20)",
          onUpdate: () => {
            valueClip.clipWidth(o.w);
            cursor.x(SUB_PAD + o.w);
            draw();
          },
        },
        0.05,
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
        0.85,
      );

      ticker = () => draw();
      gsap.ticker.add(ticker);
      tl.play(0);
    } else {
      outline.shadowBlur(12);
      outline.shadowOpacity(0.75);
      beam.visible(false);
      cursor.visible(false);
      valueClip.clipWidth(SUB_W - SUB_PAD * 2);
      draw();
    }

    return () => {
      tl.kill();
      if (ticker) gsap.ticker.remove(ticker);
      beam.visible(false);
      cursor.visible(false);
      valueClip.clipWidth(SUB_W - SUB_PAD * 2);
      draw();
    };
  }, [isActive, displayValue]);

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
        text="OUTPUT"
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
        text={label.toUpperCase()}
        x={SUB_PAD}
        y={SUB_HEADER_H + 8}
        fontSize={10}
        fontStyle="bold"
        fill={tokens.accent}
        opacity={0.8}
        fontFamily="'JetBrains Mono', monospace"
      />

      <Group
        ref={valueClipRef}
        x={SUB_PAD}
        y={SUB_HEADER_H + 26}
        clipX={0}
        clipY={0}
        clipWidth={SUB_W - SUB_PAD * 2}
        clipHeight={18}
      >
        <Text
          ref={valueTextRef}
          text={displayValue}
          x={0}
          y={0}
          fontSize={13}
          fontStyle="bold"
          fill={tokens.text}
          fontFamily="'JetBrains Mono', monospace"
        />
      </Group>
      <Rect
        ref={cursorRef}
        x={SUB_PAD}
        y={SUB_HEADER_H + 26}
        width={2}
        height={16}
        fill={tokens.text}
        opacity={0}
        listening={false}
      />

      {/* Hint row */}
      <Text
        text={`💡 ${hint}`}
        x={SUB_PAD}
        y={SUB_HEADER_H + SUB_BODY_MIN_H + 8}
        fontSize={10}
        fill={tokens.accent}
        opacity={0.78}
        fontFamily="'JetBrains Mono', monospace"
      />
    </Group>
  );
};

export default OutputElement;
