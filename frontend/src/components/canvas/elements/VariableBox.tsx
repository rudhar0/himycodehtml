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


export type VariableState =
  | "declared"
  | "initialized"
  | "updated"
  | "multiple-init"
  | "accessed"
  | "accessed_write";

interface VariableBoxProps {
  id: string;
  name: string;
  type: string;
  value: any;
  address: string;
  x: number;
  y: number;
  width: number;
  height: number;
  section: "global" | "stack" | "heap";
  isNew?: boolean;
  isUpdated?: boolean;
  previousValue?: any;
  expression?: string;
  onClick?: () => void;
  state?: VariableState;
  stepNumber?: number;
  enterDelay?: number;
  color?: string;
  explanation?: string;
  isActive?: boolean;
}

const normalizeTypeKey = (raw: string): string => {
  const t = String(raw ?? "").toLowerCase();
  if (t.includes("void")) return "void";
  if (t.includes("auto")) return "auto";
  if (t.includes("*") || t.includes("ptr") || t.includes("point")) return "ptr";
  if (t.includes("string") || t.includes("std::string")) return "str";
  if (t.includes("bool")) return "bool";
  if (t.includes("char")) return "char";
  if (t.includes("double")) return "dbl";
  if (t.includes("float")) return "float";
  if (t.includes("int") || t.includes("long") || t.includes("short"))
    return "int";
  return "auto";
};

const formatValue = (val: any): string => {
  if (val === null || val === undefined || val === "") return "—";
  if (typeof val === "string") return clampText(val, 18);
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return clampText(String(val), 18);
  return clampText(String(val), 18);
};

export const VariableBox: React.FC<VariableBoxProps> = ({
  id,
  name,
  type,
  value,
  address,
  x,
  y,
  isNew = false,
  isUpdated = false,
  previousValue,
  expression,
  onClick,
  state: varState = "initialized",
  stepNumber,
  enterDelay = 0,
  explanation,
  isActive = false,
  section,
}) => {
  const { theme } = useThemeStore();
  const dark = theme === 'dark';
  const groupRef = useRef<Konva.Group>(null);

  const outlineRef = useRef<Konva.Rect>(null);
  const beamRef = useRef<Konva.Rect>(null);
  const dotRef = useRef<Konva.Circle>(null);


  const typeKey = normalizeTypeKey(type);
  const chip = useMemo(() => {
    const clr = getCssVar(`--type-${typeKey}-clr`, "#94A3B8");
    const bg = getCssVar(`--type-${typeKey}-bg`, "rgba(148,163,184,0.12)");
    const bd = getCssVar(`--type-${typeKey}-bd`, "rgba(148,163,184,0.3)");
    return { clr, bg, bd };
  }, [dark, typeKey]);

  const tokens = useMemo(() => {
    return {
      header: chip.clr || getCssVar("--var-hdr", dark ? "#1A3FA0" : "#1D4ED8"),
      body: getCssVar("--var-body", dark ? "#0A1320" : "#EFF6FF"),
      border: getCssVar(
        "--var-border",
        dark ? "rgba(96,165,250,0.4)" : "rgba(37,99,235,0.3)",
      ),
      glow: getCssVar(
        "--var-glow",
        dark ? "rgba(96,165,250,0.12)" : "rgba(37,99,235,0.07)",
      ),
      accent: getCssVar("--var-accent", dark ? "#60A5FA" : "#2563EB"),
      text: getCssVar("--var-text", dark ? "#DBEAFE" : "#1E3A8A"),
      beam: getCssVar("--var-beam", "rgba(96,165,250,0.06)"),
      sep: getCssVar(
        "--sep",
        dark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)",
      ),
      badgeBg: dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
      badgeText: "#FFFFFF",
    };
  }, [dark, chip.clr]);

  const valueText =
    varState === "declared" ? "—" : formatValue(value ?? "");
  const prevText =
    previousValue === undefined || previousValue === null
      ? undefined
      : formatValue(previousValue);

  const stateLabel =
    varState === "declared"
      ? "DECLARED"
      : isUpdated || varState === "updated"
        ? "UPDATED"
        : "ASSIGNMENT";

  const hintText = useMemo(() => {
    const parts: string[] = [];

    if (
      prevText !== undefined &&
      prevText !== "—" &&
      formatValue(value) !== "—" &&
      prevText !== formatValue(value)
    ) {
      parts.push(`prev: ${clampText(prevText, 8)} → ${clampText(valueText, 8)}`);
    } else if (expression && expression.trim().length > 0) {
      parts.push(`expr: ${clampText(expression.trim(), 26)}`);
    } else if (explanation && explanation.trim().length > 0) {
      parts.push(clampText(explanation.trim(), 34));
    } else {
      parts.push(`${name} = ${valueText}`);
    }

    const addr = String(address || "").trim();
    if (addr.length > 0 && addr !== "0x0") {
      parts.push(`@${clampText(addr, 12)}`);
    }

    return clampText(parts.join(" · "), 46);
  }, [address, explanation, expression, name, prevText, valueText]);

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

  // Header dot breathe (always-on)
  useEffect(() => {
    const dot = dotRef.current;
    const group = groupRef.current;
    if (!dot || !group) return;
    const layer = group.getLayer();
    if (!layer) return;

    const t = gsap.to(dot, {
      opacity: 1,
      duration: 1.25,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut",
      onUpdate: () => layer.batchDraw(),
    });
    dot.opacity(0.4);

    return () => {
      t.kill();
    };
  }, []);

  // Active effects: pulse + scan beam
  useEffect(() => {
    const group = groupRef.current;
    const outline = outlineRef.current;
    const beam = beamRef.current;
    if (!group || !outline || !beam) return;
    const layer = group.getLayer();
    if (!layer) return;

    beam.visible(false);

    const draw = () => layer.batchDraw();
    let ticker: (() => void) | null = null;
    const tl = gsap.timeline({ paused: true });

    if (isActive) {
      beam.visible(true);
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

      ticker = () => draw();
      gsap.ticker.add(ticker);
      tl.play(0);
    } else {
      outline.shadowBlur(12);
      outline.shadowOpacity(0.75);
      beam.visible(false);
      draw();
    }

    return () => {
      tl.kill();
      if (ticker) gsap.ticker.remove(ticker);
      beam.visible(false);
      draw();
    };
  }, [isActive]);

  const chipW = Math.min(Math.max(46, valueText.length * 9 + 18), 164);
  const typeBadgeW = Math.min(Math.max(40, typeKey.length * 7 + 16), 80);

  const headerKind =
    section === "global" ? "GLOBAL" : section === "heap" ? "HEAP" : "VARIABLE";

  return (
    <Group
      ref={groupRef}
      id={id}
      x={x}
      y={y}
      onClick={onClick}
      listening={Boolean(onClick)}
    >
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
        ref={dotRef}
        x={SUB_PAD}
        y={SUB_HEADER_H / 2}
        radius={3}
        fill="#FFFFFF"
        opacity={0.8}
      />
      <Text
        text={headerKind}
        x={SUB_PAD + 10}
        y={8}
        fontSize={10}
        fontStyle="bold"
        fill="#FFFFFF"
        letterSpacing={1}
        fontFamily="'JetBrains Mono', monospace"
      />

      {typeof stepNumber === "number" && (
        <Group x={SUB_W - 44} y={6}>
          <Rect width={38} height={16} cornerRadius={3} fill={tokens.badgeBg} />
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
        text={stateLabel}
        x={SUB_PAD}
        y={SUB_HEADER_H + 8}
        fontSize={10}
        fontStyle="bold"
        fill={tokens.accent}
        opacity={0.78}
        fontFamily="'JetBrains Mono', monospace"
      />

      <Group x={SUB_PAD} y={SUB_HEADER_H + 26}>
        <Text
          text={clampText(name, 14)}
          x={0}
          y={2}
          fontSize={12}
          fontStyle="bold"
          fill={tokens.accent}
          fontFamily="'JetBrains Mono', monospace"
        />
        <Text
          text="="
          x={Math.min(120, Math.max(58, clampText(name, 14).length * 8 + 12))}
          y={2}
          fontSize={12}
          fill="rgba(148,163,184,0.9)"
          fontFamily="'JetBrains Mono', monospace"
        />

        <Group
          x={Math.min(140, Math.max(72, clampText(name, 14).length * 8 + 24))}
          y={-2}
        >
          <Rect
            width={chipW}
            height={22}
            cornerRadius={5}
            fill={chip.bg}
            stroke={chip.bd}
            strokeWidth={1}
          />
          <Text
            text={valueText}
            x={9}
            y={5}
            fontSize={12}
            fontStyle="bold"
            fill={chip.clr}
            fontFamily="'JetBrains Mono', monospace"
          />
        </Group>

        <Group x={SUB_W - SUB_PAD - typeBadgeW} y={-2}>
          <Rect
            width={typeBadgeW}
            height={22}
            cornerRadius={5}
            fill={chip.bg}
            stroke={chip.bd}
            strokeWidth={1}
            opacity={0.9}
          />
          <Text
            text={typeKey === "str" ? "string" : typeKey}
            x={8}
            y={6}
            fontSize={9}
            fontStyle="bold"
            fill={chip.clr}
            fontFamily="'JetBrains Mono', monospace"
          />
        </Group>
      </Group>

      {/* Hint row */}
      <Text
        text={`💡 ${hintText}`}
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

export default VariableBox;
